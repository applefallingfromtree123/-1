/* =========================================================================
 * F1 THE GAME - AI driver
 * 레이싱 라인 추종 + 코너 속도 예측 브레이킹 + 배틀/추월 + 피트 전략
 * ========================================================================= */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function cornerSpeed(k, mu, aero) {
    k = Math.abs(k);
    var df = 0.0055 * (aero || 1);
    var d = k - mu * df;
    if (d <= 0.00002) return 120;
    return Math.min(120, Math.sqrt(16.19 * mu / d));
  }

  function AIDriver(car, track, skill) {
    this.car = car;
    this.track = track;
    this.skill = skill;                 // 0.85 ~ 1.0
    this.mode = 'race';                 // race | pitIn | pitStop | pitOut
    this.pitPtr = 0;
    this.offset = 0;                    // 목표 횡방향 오프셋(추월용)
    this.targetOffset = 0;
    this.wantPit = false;
    this.pitLap = 99;
    this.nextCompound = 'medium';
    this.stuck = 0;
    this.offTime = 0;
    this.recover = 0;
    this.recoverTries = 0;
    this.noise = Math.random() * 6.28;
    this.mistake = 0;
    this.boxIdx = 0;
    this.reaction = 0;
  }

  /* 컴파운드별 대략적인 수명(랩). 실측 기준: 소프트 7 · 미디엄 10 · 하드 15 */
  var STINT = { soft: 7, medium: 10, hard: 15 };

  AIDriver.prototype.planStrategy = function (totalLaps, startCompound) {
    // 시작 타이어가 버틸 수 있는 범위 안에서 피트 랩을 잡는다
    var cap = Math.min(totalLaps - 1, STINT[startCompound] || 10);
    var mid = Math.round(totalLaps * (0.40 + Math.random() * 0.24));
    this.pitLap = clamp(Math.min(mid, cap), 1, Math.max(1, totalLaps - 1));

    // 남은 거리를 한 번에 끝낼 수 있는 가장 빠른 컴파운드
    var remain = totalLaps - this.pitLap;
    var pick = remain <= STINT.soft - 1 ? 'soft'
             : (remain <= STINT.medium - 1 ? 'medium' : 'hard');
    if (pick === startCompound) {
      // 2개 컴파운드를 쓰도록 (실제 F1 규정과 같은 맥락)
      pick = startCompound === 'soft' ? 'medium'
           : (startCompound === 'hard' ? 'medium' : (remain <= 5 ? 'soft' : 'hard'));
    }
    this.nextCompound = pick;
  };

  AIDriver.prototype.update = function (dt, race) {
    var car = this.car, track = this.track, n = track.n;
    if (car.retired) { car.throttle = 0; car.brake = 1; car.steer = 0; return; }

    var mu = race.grip * this.skill * car.tyreGrip() * car.pace;
    var df = 0.0055 * car.aero * car.speed * car.speed;
    var brakeDecel = 0.86 * mu * (9.81 * 1.55 + df * 1.05);

    // ---- 피트 판단 ------------------------------------------------------
    if (!this.wantPit && car.pitStops < 1 && race.mode !== 'practice') {
      if (car.lap >= this.pitLap || car.tyreWear > 0.80) this.wantPit = true;
    }

    // ---- 모드 전환 -------------------------------------------------------
    var pit = track.pit;
    if (this.mode === 'race' && this.wantPit && !car.finished) {
      var dEntry = ((pit.entryIdx - car.trackIdx) % n + n) % n;
      if (dEntry < 6) {
        this.mode = 'pitIn';
        this.pitPtr = 0;
        car.pitState = 'in';
        this.boxIdx = pit.boxIdx[race.teamIndex(car.team)];
      }
    }

    if (this.mode === 'race') this.driveLine(dt, race, mu, brakeDecel);
    else this.drivePit(dt, race, mu);

    // ---- 스턱 / 오프트랙 복구 ---------------------------------------------
    if (!car.onTrack && this.mode === 'race') this.offTime += dt; else this.offTime = 0;
    if (car.speed < 3 && this.mode !== 'pitStop') this.stuck += dt; else this.stuck = 0;

    // (1) 후진 탈출 중
    if (this.recover > 0) {
      this.recover -= dt;
      car.reverse = true;
      car.throttle = 1; car.brake = 0; car.steer = 0;
      car.ers = false; car.drs = false;
      if (this.recover <= 0) { car.reverse = false; this.stuck = 0; }
      return;
    }
    car.reverse = false;

    // (2) 코스 밖에서 멈춰 있으면 후진으로 빼본다 (최대 2회)
    if (this.stuck > 1.3 && this.recoverTries < 2 &&
        this.mode === 'race' && Math.abs(car.lat || 0) > track.half) {
      this.recover = 2.2;
      this.recoverTries++;
      this.stuck = 0;
      return;
    }

    // (3) 그래도 안 되면 마샬이 트랙 위로 되돌려 준다
    if (this.stuck > 3.0 || this.offTime > 6) {
      var i = car.trackIdx;
      var tgt = this.mode === 'race' ? track.race[i]
              : pit.pts[Math.min(this.pitPtr, pit.pts.length - 1)];
      car.heading = Math.atan2(track.T[i][1], track.T[i][0]);
      car.x = tgt[0]; car.y = tgt[1];
      car.vx = Math.cos(car.heading) * 12; car.vy = Math.sin(car.heading) * 12;
      car.spinTimer = 0;
      car.reverse = false;
      this.stuck = 0;
      this.offTime = 0;
      this.recoverTries = 0;
    }
    if (car.onTrack && car.speed > 20) this.recoverTries = 0;
  };

  AIDriver.prototype.driveLine = function (dt, race, mu, brakeDecel) {
    var car = this.car, track = this.track, n = track.n, sp = track.spacing;
    var i = car.trackIdx;

    // ---- 앞차 감지 / 추월 라인 --------------------------------------------
    this.targetOffset = 0;
    var ahead = race.carAhead(car, Math.max(45, car.speed * 1.0));
    if (ahead) {
      var gap = ahead.dist;
      var closing = car.speed - ahead.car.speed;
      if (gap < Math.max(34, car.speed * 0.6) && (closing > -1.5 || gap < 12)) {
        // 트랙 폭 안에서 반대편으로
        var theirLat = ahead.lat;
        var room = track.half - 2.2;
        var side = theirLat > 0 ? -1 : 1;
        var aggr = car.driver.agg * this.skill;
        this.targetOffset = side * Math.min(room, 3.2 + aggr * 3.0);
        if (gap < 9 && closing > 3) car.brake = Math.max(car.brake, 0.15);
      }
    }
    // 블루 플래그: 랩 차이 나는 차는 비켜준다
    if (race.mode === 'race' && ahead === null) {
      var behind = race.carBehind(car, 25);
      if (behind && behind.car.lap > car.lap) this.targetOffset = (track.lat[i] > 0 ? -1 : 1) * (track.half - 2.5);
    }
    this.offset += (this.targetOffset - this.offset) * Math.min(1, dt * 2.2);

    // ---- 목표 지점 ---------------------------------------------------------
    var offTrack = !car.onTrack;
    var look = offTrack ? (5 + car.speed * 0.22) : (6 + car.speed * 0.40);
    var steps = Math.max(2, Math.round(look / sp));
    var ti = (i + steps) % n;
    var base = offTrack ? track.pts[ti] : track.race[ti];
    var N = track.N[ti];
    var tx = base[0] + N[0] * (offTrack ? 0 : this.offset);
    var ty = base[1] + N[1] * (offTrack ? 0 : this.offset);

    // 살짝의 노이즈(사람다운 흔들림)
    this.noise += dt * 1.6;
    var wob = offTrack ? 0 : Math.sin(this.noise) * (1 - this.skill) * 9;
    tx += N[0] * wob; ty += N[1] * wob;

    // ---- 조향 (pure pursuit: 필요한 곡률만큼만 꺾는다) ------------------------
    car.steer = pursue(car, tx, ty);

    // ---- 목표 속도 -----------------------------------------------------------
    var vmax = 120;
    var horizon = Math.round((28 + car.speed * car.speed / (2 * brakeDecel)) / sp) + 6;
    for (var j = 1; j <= horizon; j++) {
      var idx = (i + j) % n;
      var vc = cornerSpeed(track.raceK[idx], mu, car.aero);
      var dist = j * sp;
      var allow = Math.sqrt(vc * vc + 2 * brakeDecel * dist);
      if (allow < vmax) vmax = allow;
    }
    vmax *= (0.90 + this.skill * 0.07) * (track.half < 6 ? 0.955 : 1);
    if (offTrack) vmax = Math.min(vmax, 24);   // 복귀 우선

    // 앞차 추종 — 같은 라인에 있으면 속도에 맞춘 안전 간격을 유지한다.
    // (14m 에서야 반응하면 250km/h 에서는 0.2초라 이미 늦다)
    if (ahead && Math.abs(ahead.lat - (car.lat || 0)) < 3.2) {
      var gapNeed = 7 + car.speed * 0.28;
      if (ahead.dist < gapNeed * 2.3) {
        vmax = Math.min(vmax, ahead.car.speed + (ahead.dist - gapNeed) * 1.35);
      }
    }

    var diff = vmax - car.speed;
    if (diff > 0.6) { car.throttle = clamp(diff * 0.5, 0, 1); car.brake = 0; }
    else if (diff < -0.4) { car.throttle = 0; car.brake = clamp(-diff * 0.32, 0, 1); }
    else { car.throttle = 0.55; car.brake = 0; }

    // 실수: 드물게 브레이킹 포인트를 놓친다
    if (this.mistake > 0) {
      this.mistake -= dt;
      car.brake *= 0.35;
    } else if (Math.random() < dt * (1 - this.skill) * 0.55) {
      this.mistake = 0.35 + Math.random() * 0.4;
    }

    // ERS / DRS
    car.ers = car.ersCharge > 0.22 && car.throttle > 0.8 &&
              (car.drsAllowed || car.speed > 45) && car.driver.agg > 0.6;
    car.drs = car.drsAllowed && car.throttle > 0.8;
  };

  AIDriver.prototype.drivePit = function (dt, race, mu) {
    var car = this.car, pit = this.track.pit;
    var pts = pit.pts, m = pts.length;

    // 진행 포인터 전진
    while (this.pitPtr < m - 1) {
      var p = pts[this.pitPtr];
      var q = pts[this.pitPtr + 1];
      var dx = car.x - p[0], dy = car.y - p[1];
      var ex = q[0] - p[0], ey = q[1] - p[1];
      if (dx * ex + dy * ey > ex * ex + ey * ey) this.pitPtr++;
      else break;
    }

    var look = Math.max(2, Math.round((4 + car.speed * 0.5) / this.track.spacing));
    var ti = Math.min(m - 1, this.pitPtr + look);
    var t = pts[ti];
    car.steer = pursue(car, t[0], t[1]);

    var limit = pit.limit;
    var vmax = limit;

    // 피트레인 대기열 — 앞차를 들이받지 않도록 간격을 둔다
    var qAhead = null;
    for (var ci = 0; ci < race.cars.length; ci++) {
      var other = race.cars[ci];
      if (other === car || other.retired) continue;
      if (!other.inPitLane && other.pitState === 'none') continue;
      var ddx = other.x - car.x, ddy = other.y - car.y;
      var dsq = ddx * ddx + ddy * ddy;
      if (dsq > 900) continue;                              // 30m 밖
      if (ddx * Math.cos(car.heading) + ddy * Math.sin(car.heading) < 1) continue;
      var dd = Math.sqrt(dsq);
      if (!qAhead || dd < qAhead.d) qAhead = { car: other, d: dd };
    }
    if (qAhead) vmax = Math.min(vmax, Math.max(0, qAhead.car.speed + (qAhead.d - 8) * 0.8));

    if (this.mode === 'pitIn') {
      var box = pts[this.boxIdx];
      var dBox = Math.hypot(box[0] - car.x, box[1] - car.y);
      var passed = this.pitPtr >= this.boxIdx;
      vmax = Math.min(limit, Math.sqrt(Math.max(0, 2 * 4.0 * Math.max(0, dBox - 1.0))));
      if ((dBox < 2.4 && car.speed < 4) || (passed && car.speed < 6)) {
        this.mode = 'pitStop';
        car.pitState = 'stopped';
        car.pitTimer = race.pitStopDuration(car);
        car.x = box[0]; car.y = box[1];
        car.vx = 0; car.vy = 0; car.speed = 0;
      }
    } else if (this.mode === 'pitStop') {
      vmax = 0;
      car.pitTimer -= dt;
      if (car.pitTimer <= 0) {
        car.changeTyre(this.nextCompound);
        if (race.mode === 'practice') car.fuel = race.fuelLoad;
        car.damage *= 0.35;
        car.pitStops++;
        this.mode = 'pitOut';
        car.pitState = 'out';
        this.wantPit = false;
      }
    } else if (this.mode === 'pitOut') {
      vmax = limit;
      if (this.pitPtr >= m - 3) {
        this.mode = 'race';
        car.pitState = 'none';
        this.offset = 0;
      }
    }

    var diff = vmax - car.speed;
    if (vmax <= 0.05) { car.throttle = 0; car.brake = 1; }
    else if (diff > 0.3) { car.throttle = clamp(diff * 0.6, 0, 1); car.brake = 0; }
    else { car.throttle = 0; car.brake = clamp(-diff * 0.4, 0, 1); }
    car.ers = false; car.drs = false;
  };

  /** 목표점을 지나는 원호의 곡률로부터 조향 입력을 역산한다 */
  function pursue(car, tx, ty) {
    var dx = tx - car.x, dy = ty - car.y;
    var L = Math.max(4, Math.hypot(dx, dy));
    var alpha = wrapAngle(Math.atan2(dy, dx) - car.heading);
    var kappa = 2 * Math.sin(alpha) / L;
    var steerAngle = Math.atan(kappa * 3.6);
    var steerMax = 0.52 - 0.34 * clamp(car.speed / 78, 0, 1);
    return clamp(steerAngle / Math.max(steerMax, 0.06), -1, 1);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  global.AIDriver = AIDriver;
  global.AIUtil = { cornerSpeed: cornerSpeed, wrapAngle: wrapAngle };
})(typeof window !== 'undefined' ? window : globalThis);
