/* =========================================================================
 * F1 THE GAME - Car physics
 * 탑다운 아케이드 물리: 접지력 한계, 다운포스, 타이어 마모, 연료, ERS, DRS
 * ========================================================================= */
(function (global) {
  'use strict';

  var G = 9.81;
  var GEAR_TOP = [62, 98, 133, 168, 203, 242, 285, 345]; // km/h, 기어별 상한
  var REVERSE_MAX = 8.4;        // 후진 최대 속도 (약 30 km/h)
  var TYRES = global.F1DATA.TYRES;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function Car(cfg) {
    this.team = cfg.team;
    this.driver = cfg.driver;
    this.isPlayer = !!cfg.isPlayer;
    this.id = cfg.id;

    this.x = 0; this.y = 0; this.heading = 0; this.lat = 0;
    this.vx = 0; this.vy = 0;          // 월드 좌표 속도
    this.yawRate = 0;
    this.speed = 0;

    this.throttle = 0; this.brake = 0; this.steer = 0;
    this.ers = false; this.ersCharge = 1;
    this.reverse = false;        // 후진 기어
    this.reverseHold = 0;        // 후진 진입 래치
    this.drs = false; this.drsAllowed = false;

    this.tyre = TYRES[cfg.tyre || 'medium'];
    this.tyreWear = 0;
    this.tyreTemp = 0.35;              // 0 차가움 ~ 1 최적
    this.usedCompounds = [this.tyre.id];
    this.fuel = cfg.fuel || 40;
    this.damage = 0;

    this.mass = 798;
    this.aero = cfg.aero || 1;         // 트랙별 다운포스 세팅
    this.pace = cfg.pace || 1;

    // 레이스 상태
    this.lap = 0;
    this.halfPassed = false;
    this.trackIdx = 0;
    this.lastIdx = 0;
    this.progress = 0;                 // 총 주행 거리(m)
    this.position = 1;
    this.lapStart = 0;
    this.lastLap = 0;
    this.bestLap = 0;
    this.lapTimes = [];
    this.sector = 0;
    this.sectorTimes = [0, 0, 0];
    this.bestSectors = [0, 0, 0];
    this.pitState = 'none';
    this.pitTimer = 0;
    this.pitStops = 0;
    this.penalty = 0;          // 누적 시간 페널티(초)
    this.warnings = 0;         // 트랙 한계 경고
    this.lapValid = true;      // 현재 랩 유효 여부
    this.lastLapValid = true;
    this.offTrackTimer = 0;
    this.offTrackCounted = false;
    this.pitWallSide = 0;      // 피트 월 기준 어느 쪽에 있는가
    this.incidentCool = 0;     // 추돌 페널티 쿨다운
    this.incidents = 0;
    this.pitRequested = false;
    this.inPitLane = false;
    this.onTrack = true;
    this.offTrackTime = 0;
    this.retired = false;
    this.finished = false;
    this.finishTime = 0;
    this.totalTime = 0;
    this.gapAhead = 99;
    this.spinTimer = 0;
    this.slip = 0;
    this.lastCollision = 0;
  }

  Car.prototype.reset = function (x, y, heading) {
    this.x = x; this.y = y; this.heading = heading;
    this.vx = 0; this.vy = 0; this.speed = 0; this.yawRate = 0;
    this.spinTimer = 0;
    this.reverse = false; this.reverseHold = 0;
  };

  Car.prototype.gearInfo = function () {
    if (this.reverse && this.longSpeed() < -0.2) {
      var rf = clamp(-this.longSpeed() / REVERSE_MAX, 0, 1);
      return { gear: 'R', rpm: 4200 + 6200 * rf, frac: rf };
    }
    var kmh = this.speed * 3.6, g = 0;
    while (g < GEAR_TOP.length - 1 && kmh > GEAR_TOP[g]) g++;
    var lo = g === 0 ? 0 : GEAR_TOP[g - 1];
    var hi = GEAR_TOP[g];
    var f = clamp((kmh - lo) / Math.max(1, hi - lo), 0, 1);
    return { gear: g + 1, rpm: 4200 + 8300 * f, frac: f };
  };

  /** 현재 타이어 상태가 만드는 그립 배수 */
  /** 차체 전방 기준 부호 있는 속도 (후진이면 음수) */
  Car.prototype.longSpeed = function () {
    return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading);
  };

  Car.prototype.tyreGrip = function () {
    var life = clamp(1 - this.tyreWear, 0, 1);
    var sm = life * life * (3 - 2 * life);
    var base = 0.845 + 0.155 * sm;
    if (life < 0.12) base *= 0.74 + 0.26 * (life / 0.12);   // 그립 절벽
    var temp = 0.88 + 0.12 * clamp(this.tyreTemp, 0, 1);
    return this.tyre.grip * base * temp;
  };

  /**
   * 한 스텝 적분.
   * env: { grip, surface('track'|'kerb'|'grass'|'pit'), pitLimit(nullable), aeroDrag }
   */
  Car.prototype.step = function (dt, env) {
    var self = this;
    var surface = env.surface;
    var surfMu = surface === 'grass' ? 0.52 : (surface === 'kerb' ? 0.88 : 1.0);
    var mu = env.grip * surfMu * this.tyreGrip() * this.pace * (1 - this.damage * 0.22);

    // --- 스핀(컨트롤 상실) 처리 -----------------------------------------
    if (this.spinTimer > 0) {
      this.spinTimer -= dt;
      this.throttle = 0;
      this.brake = 0.55;
    }

    var fwdX = Math.cos(this.heading), fwdY = Math.sin(this.heading);
    var rgtX = -fwdY, rgtY = fwdX;
    var vLong = this.vx * fwdX + this.vy * fwdY;
    var vLat = this.vx * rgtX + this.vy * rgtY;
    var v = Math.hypot(this.vx, this.vy);

    // --- 다운포스가 포함된 접지 한계 -------------------------------------
    var downforce = 0.0055 * v * v * this.aero;
    var maxLat = mu * (G * 1.65 + downforce);
    var maxAccGrip = mu * (G * 1.10 + downforce * 0.45);

    // --- 조향 ------------------------------------------------------------
    var steerMax = 0.52 - 0.34 * clamp(v / 78, 0, 1);
    var steerAngle = this.steer * steerMax;
    var wheelbase = 3.6;
    var desiredYaw = (vLong * Math.tan(steerAngle)) / wheelbase;
    var yawLimit = maxLat / Math.max(Math.abs(vLong), 4.5);
    var understeer = Math.abs(desiredYaw) / Math.max(yawLimit, 1e-4);
    var yaw = clamp(desiredYaw, -yawLimit, yawLimit);
    this.slip = clamp(understeer - 1, 0, 2);
    if (this.spinTimer > 0) yaw = this.yawRate * 0.97;
    this.yawRate = yaw;
    this.heading += yaw * dt;

    // --- 엔진 / 브레이크 --------------------------------------------------
    var powerKW = 580 * this.pace;
    if (this.ers && this.ersCharge > 0) powerKW *= 1.085;
    if (this.fuel <= 0) powerKW *= 0.35;
    var massTotal = this.mass + this.fuel;
    // 후진은 출력이 크게 제한된다 (실제 F1 후진 기어도 마찬가지)
    var dir = this.reverse ? -1 : 1;
    var engCap = this.reverse ? maxAccGrip * 0.55 : maxAccGrip;
    var accEngine = this.throttle * Math.min(engCap, (powerKW * 1000) / (massTotal * Math.max(v, 7)));

    var brakeCap = mu * (G * 1.55 + downforce * 1.05);
    var accBrake = this.brake * brakeCap;

    // 공기저항 + 구름저항 (+ DRS)
    var cd = 0.00095 * env.aeroDrag;
    if (this.drs) cd *= 0.78;
    var drag = cd * v * v * (this.mass / massTotal);
    // 잔디 저항은 속도에 비례해 커진다 (멈춘 차가 스스로 빠져나올 수 있게)
    var roll = (surface === 'grass' ? 1.1 + Math.min(2.9, v * 0.13) : 0.38) +
               (surface === 'kerb' ? 0.9 : 0);
    var scrub = this.slip * 5.2;        // 언더스티어 스크럽

    // 저항은 항상 진행 방향의 반대로 작용한다 (후진 중에도 동일)
    var resist = accBrake + drag + roll + scrub;
    var drive = dir * accEngine;
    var v0 = vLong;
    var along;
    if (v0 > 0.06) along = drive - resist;
    else if (v0 < -0.06) along = drive + resist;
    else along = Math.abs(drive) > 0.5 ? drive : 0;   // 정지 상태

    vLong = v0 + along * dt;
    // 저항만으로 진행 방향이 뒤집히지 않게
    if (v0 > 0 && vLong < 0 && drive <= 0) vLong = 0;
    if (v0 < 0 && vLong > 0 && drive >= 0) vLong = 0;
    if (vLong < -REVERSE_MAX) vLong = -REVERSE_MAX;

    // 피트 리미터
    if (env.pitLimit && Math.abs(vLong) > env.pitLimit) vLong = Math.sign(vLong) * env.pitLimit;

    // --- 횡방향 미끄러짐 ---------------------------------------------------
    var latGrip = (this.spinTimer > 0 ? 1.4 : 7.4) * (surface === 'grass' ? 0.45 : 1);
    vLat *= Math.exp(-latGrip * dt);
    var latCap = maxLat * dt * 2.6;
    if (Math.abs(vLat) > latCap * 6) vLat = Math.sign(vLat) * latCap * 6;
    // 요 회전으로 생기는 횡속도
    vLat -= yaw * vLong * dt * 0.30;

    fwdX = Math.cos(this.heading); fwdY = Math.sin(this.heading);
    rgtX = -fwdY; rgtY = fwdX;
    this.vx = fwdX * vLong + rgtX * vLat;
    this.vy = fwdY * vLong + rgtY * vLat;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.speed = Math.hypot(this.vx, this.vy);

    // --- 소모품 -----------------------------------------------------------
    var latLoad = Math.abs(yaw * Math.max(vLong, 1)) / Math.max(maxLat, 1);
    var wearRate = 0.00132 * this.tyre.wear *
      (0.22 + latLoad * latLoad * 1.75 + this.slip * 2.4 +
       (surface === 'grass' ? 0.8 : 0) + (surface === 'kerb' ? 0.35 : 0));
    if (this.pitState !== 'stopped') this.tyreWear = clamp(this.tyreWear + wearRate * dt, 0, 1);

    var target = clamp(0.30 + latLoad * 0.85 + vLong / 95, 0, 1);
    this.tyreTemp += (target * this.tyre.warm - this.tyreTemp) * dt * 0.28;
    this.tyreTemp = clamp(this.tyreTemp, 0, 1);

    this.fuel = Math.max(0, this.fuel - dt * (0.004 + this.throttle * 0.028));

    if (this.ers && this.ersCharge > 0) this.ersCharge = clamp(this.ersCharge - dt / 22, 0, 1);
    else this.ersCharge = clamp(this.ersCharge + dt * (this.brake > 0.2 ? 1 / 26 : 1 / 90), 0, 1);

    // 잔디에서 고속 = 스핀 위험
    if (surface === 'grass' && v > 30 && vLong > 0 && Math.abs(vLat) > 5 && this.spinTimer <= 0) {
      this.spinTimer = 0.9 + Math.random() * 0.5;
    }
  };

  Car.prototype.changeTyre = function (compound) {
    this.tyre = TYRES[compound];
    this.tyreWear = 0;
    this.tyreTemp = 0.45;
    if (this.usedCompounds.indexOf(compound) < 0) this.usedCompounds.push(compound);
  };

  Car.prototype.tyreLifeText = function () {
    return Math.round(clamp(1 - this.tyreWear, 0, 1) * 100) + '%';
  };

  global.Car = Car;
  global.CarUtil = { clamp: clamp, GEAR_TOP: GEAR_TOP };
})(typeof window !== 'undefined' ? window : globalThis);
