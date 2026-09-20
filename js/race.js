/* =========================================================================
 * F1 THE GAME - Race session
 * 그리드 구성, 랩/섹터 계측, 노면 판정, 충돌, 피트스탑, 순위/플래그
 * ========================================================================= */
(function (global) {
  'use strict';

  var F1 = global.F1DATA;
  var Geo = global.Geometry;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 배리어에 이 이상의 법선 속도로 박으면 즉시 리타이어 (m/s).
     스쳐 지나가는 접촉은 살아남고, 제대로 꽂히면 끝난다. */
  var CRASH_OUT = 17;

  function Race(opts) {
    this.spec = opts.spec;
    this.track = Geo.getTrack(opts.spec);
    this.mode = opts.mode;                       // 'race' | 'practice'
    this.totalLaps = opts.laps;
    this.difficulty = opts.difficulty;
    this.mandatoryPit = !!opts.mandatoryPit;
    this.grip = opts.spec.grip;
    this.aeroDrag = opts.spec.id === 'monza' ? 0.86 : (opts.spec.id === 'monaco' ? 1.22 : 1.0);
    this.aero = opts.spec.id === 'monza' ? 0.78 : (opts.spec.id === 'monaco' ? 1.25 : 1.0);

    this.cars = [];
    this.ai = [];
    this.player = null;
    this.time = 0;
    this.state = this.mode === 'practice' ? 'green' : 'lights';
    this.lightTimer = 0;
    this.lights = 0;
    this.finishTimer = 0;
    this.events = [];
    this.fastestLap = { time: 0, car: null };
    this.playerNextCompound = opts.playerNextCompound || 'hard';
    this.pitBoxHint = false;
    this.fuelLoad = this.mode === 'practice' ? 60 : Math.min(110, Math.max(12, this.totalLaps * 3.2 + 4));

    // 메인 인덱스 -> 피트레인 배열 인덱스
    var n = this.track.n;
    this.pitMap = new Int32Array(n).fill(-1);
    for (var i = 0; i < this.track.pit.idx.length; i++) this.pitMap[this.track.pit.idx[i]] = i;

    this.buildField(opts);
  }

  Race.prototype.teamIndex = function (team) {
    for (var i = 0; i < F1.TEAMS.length; i++) if (F1.TEAMS[i].id === team.id) return i;
    return 0;
  };

  Race.prototype.buildField = function (opts) {
    var grid = opts.grid;                         // [{team, driver, isPlayer, compound}]
    var track = this.track;
    for (var i = 0; i < grid.length; i++) {
      var e = grid[i];
      var car = new global.Car({
        id: i, team: e.team, driver: e.driver, isPlayer: e.isPlayer,
        tyre: e.compound || 'medium',
        fuel: this.fuelLoad,
        aero: this.aero,
        pace: e.isPlayer ? 1.0 : e.team.pace * (0.985 + this.difficulty.ai * 0.02)
      });
      var g = track.grid[Math.min(i, track.grid.length - 1)];
      car.reset(g.x, g.y, g.heading);
      car.trackIdx = g.idx;
      car.lastIdx = g.idx;
      car.gridPos = i + 1;
      car.lap = -1;
      car.progress = -(track.length - track.S[g.idx]);
      if (this.mode === 'practice') {
        // 연습 주행은 피트 출구 직후, 본선 위에서 출발
        var pi = (track.pit.exitIdx + 6) % track.n;
        var pp = track.pts[pi];
        car.reset(pp[0], pp[1], Math.atan2(track.T[pi][1], track.T[pi][0]));
        car.trackIdx = pi; car.lastIdx = pi;
        car.lap = 0;
        car.progress = track.S[pi];
      }
      this.cars.push(car);
      if (e.isPlayer) this.player = car;
      else {
        var skill = clamp(e.driver.skill * this.difficulty.ai + 0.02, 0.6, 1.0);
        var ai = new global.AIDriver(car, track, skill);
        ai.planStrategy(this.totalLaps, car.tyre.id);
        this.ai.push(ai);
      }
    }
    if (this.mode !== 'practice') { this.lightTimer = 3.2; }
  };

  /* ------------------------------------------------------------------ */
  Race.prototype.pitOffsetAt = function (idx) {
    var k = this.pitMap[idx];
    if (k < 0) return null;
    return this.track.pit.off[k];
  };

  Race.prototype.surfaceFor = function (car) {
    var track = this.track;
    var idx = Geo.nearestIndex(track, car.x, car.y, car.trackIdx);
    car.trackIdx = idx;
    var lat = Geo.lateralOffset(track, idx, car.x, car.y);
    car.lat = lat;

    var pitOff = this.pitOffsetAt(idx);
    var inPit = false;
    if (pitOff !== null && Math.abs(pitOff) > 4) {
      inPit = Math.abs(lat - pitOff) < track.pit.width / 2 + 1.2;
    }
    car.inPitLane = inPit;

    var a = Math.abs(lat), half = track.half, surface;
    if (inPit) surface = 'track';
    else if (a < half - 0.6) surface = 'track';
    else if (a < half + 1.4) surface = 'kerb';
    else surface = 'grass';
    car.onTrack = surface !== 'grass';

    // 벽/배리어
    var limit = half + this.spec.runoff;
    if (!inPit && a > limit) {
      var N = track.N[idx];
      var side = Math.sign(lat);
      var push = (a - limit) * side;
      car.x -= N[0] * push; car.y -= N[1] * push;
      var vn = car.vx * N[0] + car.vy * N[1];
      // 벽 쪽으로 파고드는 순간에만 충격을 준다 (튕겨 나오는 중에는 무시)
      if (vn * side > 0) {
        var impact = Math.abs(vn);
        car.vx -= N[0] * vn * 1.35; car.vy -= N[1] * vn * 1.35;
        car.vx *= 0.62; car.vy *= 0.62;
        if (this.sfxHook && impact > 8) this.sfxHook(impact);

        if (impact >= CRASH_OUT) {
          // 배리어에 강하게 꽂히면 그 자리에서 레이스 종료
          car.damage = 1;
          car.vx *= 0.15; car.vy *= 0.15;
          car.spinTimer = Math.max(car.spinTimer, 1.4);
          if (this.mode === 'practice') {
            this.crashFlash = 1;
          } else {
            this.retire(car, '크래시 — 리타이어');
            this.crashFlash = 1;
          }
        } else {
          var sev = Math.min(0.3, Math.max(0, impact - 5) * 0.010);
          car.damage = clamp(car.damage + sev, 0, 1);
          if (impact > 13) car.spinTimer = Math.max(car.spinTimer, 0.5);
          if (car.damage >= 1 && this.mode !== 'practice') this.retire(car, '차체 손상 — 리타이어');
        }
      } else {
        car.vx -= N[0] * vn * 0.15; car.vy -= N[1] * vn * 0.15;
      }
    }
    return surface;
  };

  Race.prototype.retire = function (car, reason) {
    if (car.retired) return;
    car.retired = true;
    car.throttle = 0;
    this.pushEvent((car.isPlayer ? '● ' : '') + car.driver.code + ' ' + reason);
  };

  Race.prototype.pushEvent = function (text) {
    this.events.unshift({ t: this.time, text: text });
    if (this.events.length > 6) this.events.pop();
  };

  Race.prototype.pitStopDuration = function (car) {
    var base = 2.25 + (1 - car.team.pace) * 6.0;
    return base + Math.random() * 0.55;
  };

  /* ------------------------------------------------------------------ */
  Race.prototype.update = function (dt, input) {
    var i;
    if (this.state === 'lights') {
      this.lightTimer -= dt;
      var stage = Math.floor((3.2 - this.lightTimer) / 0.62);
      this.lights = clamp(stage, 0, 5);
      if (this.lightTimer <= -0.4 - Math.random() * 0.0) {
        this.state = 'green';
        this.time = 0;
        for (i = 0; i < this.cars.length; i++) this.cars[i].lapStart = 0;
        this.pushEvent('라이트 아웃! 레이스 시작');
      }
    }

    var running = this.state === 'green' || this.state === 'finishing';
    if (running) this.time += dt;

    // ---- 입력 / AI -------------------------------------------------------
    var p = this.player;
    if (p && !p.retired) {
      if (this.state === 'lights') { p.throttle = 0; p.brake = 1; p.steer = 0; }
      else this.applyInput(p, input, dt);
    }
    for (i = 0; i < this.ai.length; i++) {
      var a = this.ai[i];
      if (this.state === 'lights') { a.car.throttle = 0; a.car.brake = 1; a.car.steer = 0; }
      else a.update(dt, this);
    }

    // ---- 물리 -------------------------------------------------------------
    for (i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      if (car.finished && !car.isPlayer) { car.throttle *= 0.9; car.brake = 0.25; }
      var surface = this.surfaceFor(car);
      var pitLimit = car.inPitLane ? this.track.pit.limit : null;
      car.step(dt, {
        grip: this.grip, surface: surface, pitLimit: pitLimit, aeroDrag: this.aeroDrag
      });
      if (running) this.lapLogic(car, dt);
    }

    this.collisions();
    this.updateOrder();
    this.updateDRS();
    if (p) this.playerPit(dt);

    if (this.state === 'finishing') {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0) this.state = 'over';
    }
    if (this.state === 'green' && this.mode !== 'practice') {
      var active = 0;
      for (i = 0; i < this.cars.length; i++) if (!this.cars[i].retired && !this.cars[i].finished) active++;
      if (active === 0) this.state = 'over';
    }
  };

  Race.prototype.applyInput = function (car, input, dt) {
    if (car.pitState === 'stopped') { car.throttle = 0; car.brake = 1; car.steer = 0; return; }
    var steerSpeed = 3.4, ret = 5.0;
    var want = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (want !== 0) car.steer = clamp(car.steer + want * steerSpeed * dt, -1, 1);
    else car.steer -= clamp(car.steer, -ret * dt, ret * dt);
    // ---- 전진 / 후진 기어 전환 ----
    // 거의 멈춘 상태에서 브레이크를 계속 누르고 있으면 후진으로 들어간다.
    var vl = car.longSpeed();
    if (car.reverse) {
      if (input.up && vl > -0.6) { car.reverse = false; car.reverseHold = 0; }
    } else if (input.down && !input.up && vl < 0.6) {
      car.reverseHold += dt;
      if (car.reverseHold > 0.35) { car.reverse = true; car.reverseHold = 0; }
    } else {
      car.reverseHold = 0;
    }

    if (car.reverse) {
      car.throttle = input.down ? 1 : 0;
      car.brake = (input.up || input.space) ? 1 : 0;
    } else {
      car.throttle = input.up ? 1 : 0;
      car.brake = (input.down || input.space) ? 1 : 0;
    }
    car.ers = !!input.shift && car.ersCharge > 0 && !car.reverse;
    car.drs = !!car.drsAllowed && !car.reverse && (car.throttle > 0.5);
  };

  /* ---- 랩/섹터 계측 ---------------------------------------------------- */
  Race.prototype.lapLogic = function (car, dt) {
    var n = this.track.n, idx = car.trackIdx, prev = car.lastIdx;
    if (idx === prev) { this.updateProgress(car); return; }

    var forward = ((idx - prev) % n + n) % n;
    var back = n - forward;
    if (forward < back) {
      var s1 = Math.floor(n / 3), s2 = Math.floor(n * 2 / 3), half = Math.floor(n / 2);
      // 랩의 절반을 지나야만 결승선 통과가 유효하다 (라인 위 흔들림 방지)
      if (prev < half && idx >= half) car.halfPassed = true;
      if (prev > n * 0.66 && idx < n * 0.34) {
        if (car.lap < 0) {
          car.lap = 0;
          car.lapStart = this.time;      // 스타트 라인 통과 = 계측 시작
        } else if (car.halfPassed) {
          this.onLapComplete(car);
        }
        car.halfPassed = false;
      }
      if (prev < s1 && idx >= s1) this.onSector(car, 0);
      if (prev < s2 && idx >= s2) this.onSector(car, 1);
    }
    car.lastIdx = idx;
    this.updateProgress(car);
  };

  Race.prototype.updateProgress = function (car) {
    car.progress = car.lap * this.track.length + this.track.S[car.trackIdx];
  };

  Race.prototype.onSector = function (car, s) {
    var t = this.time - car.lapStart;
    car.sectorTimes[s] = t - (s === 0 ? 0 : car.sectorTimes[s - 1]);
    if (!car.bestSectors[s] || car.sectorTimes[s] < car.bestSectors[s]) car.bestSectors[s] = car.sectorTimes[s];
  };

  Race.prototype.onLapComplete = function (car) {
    var lapTime = this.time - car.lapStart;
    car.lapStart = this.time;
    car.lap++;
    car.halfPassed = false;

    if (car.lap > 0 && lapTime > 5) {
      car.lastLap = lapTime;
      car.lapTimes.push(lapTime);
      if (!car.bestLap || lapTime < car.bestLap) car.bestLap = lapTime;
      if (!this.fastestLap.time || lapTime < this.fastestLap.time) {
        this.fastestLap = { time: lapTime, car: car };
        if (this.mode !== 'practice') this.pushEvent('패스티스트 랩 ' + car.driver.code + ' ' + fmt(lapTime));
      }
    }

    if (this.mode !== 'practice' && car.lap >= this.totalLaps && !car.finished) {
      car.finished = true;
      car.finishTime = this.time;
      if (this.mandatoryPit && car.pitStops === 0) {
        car.penalty = 30;                       // 의무 피트스탑 미이행
        car.finishTime += 30;
        this.pushEvent(car.driver.code + ' 피트스탑 미이행 +30초');
      }
      car.totalTime = car.finishTime;
      if (this.finishedCount() === 1) this.pushEvent('체커드 플래그 — ' + car.driver.code);
      if (this.state === 'green') {
        // 플레이어가 결승선을 통과하면 레이스 종료. 관전 모드(플레이어 없음)는 선두 기준.
        if (car.isPlayer) { this.state = 'finishing'; this.finishTimer = 2.8; }
        else if (!this.player && this.finishedCount() === 1) { this.state = 'finishing'; this.finishTimer = 14; }
      }
    }
  };

  Race.prototype.finishedCount = function () {
    var c = 0;
    for (var i = 0; i < this.cars.length; i++) if (this.cars[i].finished) c++;
    return c;
  };

  /* ---- 플레이어 피트스탑 ------------------------------------------------ */
  Race.prototype.playerPit = function (dt) {
    var car = this.player, track = this.track;
    if (car.retired) return;
    var boxI = track.pit.boxIdx[this.teamIndex(car.team)];
    var box = track.pit.pts[boxI];
    this.playerBox = box;
    var dBox = Math.hypot(box[0] - car.x, box[1] - car.y);
    this.pitBoxHint = car.inPitLane && car.pitState !== 'out';

    if (car.pitState === 'none' && car.inPitLane) {
      car.pitState = 'in';
      this.pushEvent('피트레인 진입 — 리미터 작동');
    }
    if (car.pitState === 'in') {
      if (dBox < 3.2 && car.speed < 2.6) {
        car.pitState = 'stopped';
        car.pitTimer = this.pitStopDuration(car);
        car.vx = 0; car.vy = 0; car.speed = 0;
        car.x = box[0]; car.y = box[1];
      } else if (!car.inPitLane) {
        car.pitState = 'none';
      }
    } else if (car.pitState === 'stopped') {
      car.pitTimer -= dt;
      car.vx = 0; car.vy = 0; car.speed = 0;
      if (car.pitTimer <= 0) {
        car.changeTyre(this.playerNextCompound);
        if (this.mode === 'practice') car.fuel = this.fuelLoad;
        car.damage *= 0.35;
        car.pitStops++;
        car.pitState = 'out';
        this.pushEvent('타이어 교체 — ' + car.tyre.label);
      }
    } else if (car.pitState === 'out') {
      if (!car.inPitLane) car.pitState = 'none';
    }
  };

  /* ---- 충돌 ------------------------------------------------------------ */
  Race.prototype.collisions = function () {
    var cars = this.cars, m = cars.length;
    for (var i = 0; i < m; i++) {
      var A = cars[i];
      if (A.pitState === 'stopped') continue;
      for (var j = i + 1; j < m; j++) {
        var B = cars[j];
        if (B.pitState === 'stopped') continue;
        var dx = B.x - A.x, dy = B.y - A.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > 60) continue;
        // 앞/뒤 2원 근사
        for (var a = -1; a <= 1; a += 2) {
          for (var b = -1; b <= 1; b += 2) {
            var ax = A.x + Math.cos(A.heading) * 1.45 * a, ay = A.y + Math.sin(A.heading) * 1.45 * a;
            var bx = B.x + Math.cos(B.heading) * 1.45 * b, by = B.y + Math.sin(B.heading) * 1.45 * b;
            var ddx = bx - ax, ddy = by - ay;
            var d = Math.hypot(ddx, ddy);
            var minD = 2.5;
            if (d < minD && d > 0.01) {
              var nx = ddx / d, ny = ddy / d;
              var push = (minD - d) * 0.5;
              A.x -= nx * push; A.y -= ny * push;
              B.x += nx * push; B.y += ny * push;
              var rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
              if (rel < 0) {
                var imp = -rel * 0.55;
                A.vx -= nx * imp; A.vy -= ny * imp;
                B.vx += nx * imp; B.vy += ny * imp;
                var sev = Math.min(0.07, Math.max(0, Math.abs(rel) - 4) * 0.0025);
                A.damage = clamp(A.damage + sev, 0, 1);
                B.damage = clamp(B.damage + sev, 0, 1);
                if (Math.abs(rel) > 16) {
                  A.spinTimer = Math.max(A.spinTimer, 0.45);
                  B.spinTimer = Math.max(B.spinTimer, 0.45);
                }
              }
            }
          }
        }
      }
    }
  };

  /* ---- 순위 / 간격 ------------------------------------------------------ */
  Race.prototype.updateOrder = function () {
    var list = this.cars.slice();
    list.sort(function (a, b) {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return b.progress - a.progress;
    });
    for (var i = 0; i < list.length; i++) list[i].position = i + 1;
    this.order = list;

    for (i = 1; i < list.length; i++) {
      var ahead = list[i - 1], cur = list[i];
      var d = ahead.progress - cur.progress;
      var v = Math.max(cur.speed, 12);
      cur.gapAhead = d / v;
    }
    if (list.length) list[0].gapAhead = 99;   // 선두는 DRS 대상 아님
  };

  Race.prototype.updateDRS = function () {
    var track = this.track, n = track.n;
    for (var i = 0; i < this.cars.length; i++) {
      var car = this.cars[i];
      car.drsAllowed = false;
      if (car.inPitLane || car.lap < 1 || this.mode === 'practice') {
        if (this.mode !== 'practice') continue;
      }
      for (var z = 0; z < track.drs.length; z++) {
        var zn = track.drs[z];
        var inZone = zn.start <= zn.end
          ? (car.trackIdx >= zn.start && car.trackIdx <= zn.end)
          : (car.trackIdx >= zn.start || car.trackIdx <= zn.end);
        if (inZone && (this.mode === 'practice' || car.gapAhead < 1.0)) {
          if (!car.inPitLane) car.drsAllowed = true;
        }
      }
    }
  };

  /* ---- 앞/뒤 차 --------------------------------------------------------- */
  Race.prototype.carAhead = function (car, maxDist) {
    var best = null, bestD = maxDist;
    for (var i = 0; i < this.cars.length; i++) {
      var o = this.cars[i];
      if (o === car || o.retired) continue;
      var dx = o.x - car.x, dy = o.y - car.y;
      var d = Math.hypot(dx, dy);
      if (d > bestD) continue;
      var fx = Math.cos(car.heading), fy = Math.sin(car.heading);
      if (dx * fx + dy * fy < 1) continue;
      bestD = d;
      best = { car: o, dist: d, lat: o.lat };
    }
    return best;
  };

  Race.prototype.carBehind = function (car, maxDist) {
    var best = null, bestD = maxDist;
    for (var i = 0; i < this.cars.length; i++) {
      var o = this.cars[i];
      if (o === car || o.retired) continue;
      var dx = o.x - car.x, dy = o.y - car.y;
      var d = Math.hypot(dx, dy);
      if (d > bestD) continue;
      var fx = Math.cos(car.heading), fy = Math.sin(car.heading);
      if (dx * fx + dy * fy > -1) continue;
      bestD = d; best = { car: o, dist: d };
    }
    return best;
  };

  Race.prototype.results = function () {
    return this.order.slice();
  };

  function fmt(t) {
    if (!t || t <= 0) return '--:--.---';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }

  global.Race = Race;
  global.fmtTime = fmt;
})(typeof window !== 'undefined' ? window : globalThis);
