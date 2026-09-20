/* =========================================================================
 * F1 THE GAME - 3D renderer
 * 외부 라이브러리 없이 Canvas 2D 위에 원근 투영 + 근평면 클리핑 +
 * 화가 알고리즘(먼 것부터)으로 그린다. 시점은 차 뒤쪽 추격 카메라.
 * 월드 좌표: x(동), y(남), z(위).  트랙 표면은 z = 0.
 * ========================================================================= */
(function (global) {
  'use strict';

  var NEAR = 0.35;

  var CAMS = [
    { id: 'chase', label: '추격',  dist: 9.2,  height: 3.5,  look: 15, lookZ: 1.30, fov: 62 },
    { id: 'close', label: '근접',  dist: 5.6,  height: 2.15, look: 13, lookZ: 1.05, fov: 68 },
    { id: 'tcam',  label: 'T캠',   dist: 0.25, height: 1.58, look: 20, lookZ: 1.15, fov: 74 },
    { id: 'heli',  label: '헬기',  dist: 17,   height: 10.5, look: 10, lookZ: 0.40, fov: 54 }
  ];

  /* 트랙별 하늘/노면 팔레트 */
  function palette(spec) {
    if (spec.timeOfDay === 'night') {
      return { skyTop: '#05060f', skyBot: '#1a1430', fog: [26, 22, 44],
               grass: [64, 52, 38], grass2: [52, 42, 30], road: [46, 46, 52], runoff: [92, 78, 54] };
    }
    if (spec.timeOfDay === 'overcast') {
      return { skyTop: '#39424f', skyBot: '#8c96a3', fog: [122, 131, 142],
               grass: [58, 96, 54], grass2: [48, 82, 45], road: [58, 60, 66], runoff: [126, 124, 116] };
    }
    if (spec.id === 'monaco') {
      return { skyTop: '#1d3b5e', skyBot: '#8fb4d6', fog: [136, 158, 178],
               grass: [86, 94, 104], grass2: [72, 79, 88], road: [56, 58, 64], runoff: [104, 108, 114] };
    }
    return { skyTop: '#1f4a86', skyBot: '#a8c8e8', fog: [150, 172, 196],
             grass: [72, 110, 62], grass2: [60, 94, 52], road: [56, 58, 64], runoff: [132, 128, 118] };
  }

  function Renderer3D(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.showLine = false;
    this.camMode = 0;
    this.particles = [];
    this.cam = { shake: 0 };
    this.st = null;
    this.pose = null;
    this.vbuf = [];
    this.sbuf = [];
    this.w = 800; this.h = 600; this.dpr = 1;
    this.fogCache = {};
  }

  Renderer3D.prototype.resize = function (w, h, dpr) {
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
  };

  Renderer3D.prototype.cameraLabel = function () { return CAMS[this.camMode].label; };
  Renderer3D.prototype.cycleCamera = function () {
    this.camMode = (this.camMode + 1) % CAMS.length;
    return CAMS[this.camMode].label;
  };

  /* ------------------------------------------------------------------ *
   *  정적 데이터 (트랙당 1회)
   * ------------------------------------------------------------------ */
  Renderer3D.prototype.prepare = function (race) {
    var track = race.track, spec = race.spec, n = track.n;
    var pal = palette(spec);
    var kerb = new Uint8Array(n);
    for (var i = 0; i < n; i++) kerb[i] = Math.abs(track.K[i]) > 0.0040 ? 1 : 0;

    // 배리어 거리: 스트리트 서킷은 바로 옆, 상설 서킷은 런오프 바깥
    var barrier = track.half + Math.min(spec.runoff, spec.id === 'monaco' ? 6 : 20);

    // 트랙사이드 오브젝트 (관중석 / 광고판 / 나무 / 타이어월)
    var objs = [];
    var street = spec.id === 'monaco';
    for (i = 0; i < n; i += 9) {
      var p = track.pts[i], N = track.N[i];
      var corner = Math.abs(track.K[i]) > 0.0055;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        var d = barrier + 2.5;
        var seed = (i * 7 + (sgn + 1) * 13) % 100;
        var scen = spec.scenery || 'green';
        var kind;
        if (corner && seed % 3 === 0) kind = 'tyres';
        else if (Math.abs(track.S[i] - track.S[0]) < 260 || seed % 17 === 0) kind = 'stand';
        else if (scen === 'street') kind = seed % 2 ? 'building' : 'board';
        else if (scen === 'desert') kind = seed % 3 === 1 ? 'palm' : 'board';
        else kind = (seed % 3 === 0) ? 'board' : 'tree';
        if (kind === 'tyres') d = barrier + 1.2;
        if (kind === 'stand') d = barrier + 7;
        if (kind === 'building') d = barrier + 9;
        objs.push({
          x: p[0] + N[0] * d * sgn, y: p[1] + N[1] * d * sgn,
          idx: i, side: sgn, kind: kind, seed: seed,
          hdg: Math.atan2(track.T[i][1], track.T[i][0])
        });
      }
    }

    // DRS 게이트 / 섹터 위치
    var gates = [];
    for (var z = 0; z < track.drs.length; z++) gates.push({ idx: track.drs[z].start, type: 'drs' });
    gates.push({ idx: Math.floor(n / 3), type: 's1' });
    gates.push({ idx: Math.floor(n * 2 / 3), type: 's2' });

    this.st = { pal: pal, kerb: kerb, barrier: barrier, objs: objs, gates: gates, n: n, street: street };
    this.fogCache = {};
    this.pose = null;
  };

  /* ------------------------------------------------------------------ *
   *  카메라
   * ------------------------------------------------------------------ */
  function angLerp(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  Renderer3D.prototype.updateCamera = function (car, dt) {
    var m = CAMS[this.camMode];
    var spd = Math.min(1, car.speed / 82);
    var dist = m.dist * (1 + spd * 0.14);
    var height = m.height * (1 - spd * 0.05);
    var fov = m.fov + spd * 11;

    if (!this.pose) {
      this.pose = { x: 0, y: 0, z: 0, yaw: car.heading, fov: fov, lx: 0, ly: 0, lz: 0 };
      this.pose.yaw = car.heading;
      this.snap = true;
    }
    var P = this.pose;
    var k = this.snap ? 1 : 1 - Math.exp(-dt * (this.camMode === 2 ? 26 : 7.5));
    var kl = this.snap ? 1 : 1 - Math.exp(-dt * 14);

    // 카메라가 바라보는 기준 방향 (차 방향을 약간 늦게 따라간다)
    P.yaw = this.snap ? car.heading : angLerp(P.yaw, car.heading, 1 - Math.exp(-dt * 9));
    var cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);

    var tx = car.x - cy * dist, ty = car.y - sy * dist, tz = height;
    P.x += (tx - P.x) * k;
    P.y += (ty - P.y) * k;
    P.z += (tz - P.z) * k;
    P.fov += (fov - P.fov) * Math.min(1, dt * 4);

    var ch = Math.cos(car.heading), sh = Math.sin(car.heading);
    var lx = car.x + ch * m.look, ly = car.y + sh * m.look, lz = m.lookZ;
    P.lx += (lx - P.lx) * kl; P.ly += (ly - P.ly) * kl; P.lz += (lz - P.lz) * kl;
    this.snap = false;

    // 카메라 흔들림
    var sh2 = this.cam.shake;
    var ox = 0, oy = 0, oz = 0;
    if (sh2 > 0.01) {
      ox = (Math.random() - 0.5) * sh2 * 0.05;
      oy = (Math.random() - 0.5) * sh2 * 0.05;
      oz = (Math.random() - 0.5) * sh2 * 0.04;
      this.cam.shake *= 0.87;
    }

    this.cx3 = P.x + ox; this.cy3 = P.y + oy; this.cz3 = P.z + oz;

    var fx = P.lx - this.cx3, fy = P.ly - this.cy3, fz = P.lz - this.cz3;
    var fl = Math.hypot(fx, fy, fz) || 1;
    this.fx = fx / fl; this.fy = fy / fl; this.fz = fz / fl;
    var rl = Math.hypot(-this.fy, this.fx) || 1;
    this.rx = -this.fy / rl; this.ry = this.fx / rl;
    // u = f × r
    this.ux = this.fy * 0 - this.fz * this.ry;
    this.uy = this.fz * this.rx - this.fx * 0;
    this.uz = this.fx * this.ry - this.fy * this.rx;

    this.focal = (this.h / 2) / Math.tan(P.fov * Math.PI / 360);
    this.scx = this.w / 2; this.scy = this.h / 2;
  };

  Renderer3D.prototype.horizonY = function () {
    var hl = Math.hypot(this.fx, this.fy) || 1;
    var dx = this.fx / hl, dy = this.fy / hl;
    var vy = dx * this.ux + dy * this.uy;
    var vz = dx * this.fx + dy * this.fy;
    if (vz <= 0.001) return -1e5;
    return this.scy - this.focal * (vy / vz);
  };

  /* ------------------------------------------------------------------ *
   *  투영 / 폴리곤
   * ------------------------------------------------------------------ */
  Renderer3D.prototype.view = function (x, y, z, out) {
    var dx = x - this.cx3, dy = y - this.cy3, dz = z - this.cz3;
    out[0] = dx * this.rx + dy * this.ry;
    out[1] = dx * this.ux + dy * this.uy + dz * this.uz;
    out[2] = dx * this.fx + dy * this.fy + dz * this.fz;
    return out;
  };

  var _t = [0, 0, 0];

  /** 월드 폴리곤을 그린다. pts: [x,y,z, x,y,z, ...] 평탄 배열 */
  Renderer3D.prototype.poly = function (pts, color, depthOverride, strokeColor, strokeW) {
    var cnt = pts.length / 3;
    var v = this.vbuf; v.length = 0;
    var i, zsum = 0;
    for (i = 0; i < cnt; i++) {
      this.view(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], _t);
      v.push(_t[0], _t[1], _t[2]);
    }
    // 근평면 클리핑
    var c = this.sbuf; c.length = 0;
    for (i = 0; i < cnt; i++) {
      var ax = v[i * 3], ay = v[i * 3 + 1], az = v[i * 3 + 2];
      var j = (i + 1) % cnt;
      var bx = v[j * 3], by = v[j * 3 + 1], bz = v[j * 3 + 2];
      var ain = az >= NEAR, bin = bz >= NEAR;
      if (ain) c.push(ax, ay, az);
      if (ain !== bin) {
        var t = (NEAR - az) / (bz - az);
        c.push(ax + (bx - ax) * t, ay + (by - ay) * t, NEAR);
      }
    }
    var m = c.length / 3;
    if (m < 3) return false;

    var ctx = this.ctx;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    ctx.beginPath();
    for (i = 0; i < m; i++) {
      var z = c[i * 3 + 2];
      var sx = this.scx + c[i * 3] * this.focal / z;
      var sy = this.scy - c[i * 3 + 1] * this.focal / z;
      zsum += z;
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    if (maxX < -8 || minX > this.w + 8 || maxY < -8 || minY > this.h + 8) return false;
    ctx.closePath();
    ctx.fillStyle = this.fogged(color, depthOverride !== undefined ? depthOverride : zsum / m);
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeW || 1;
      ctx.stroke();
    }
    return true;
  };

  /** 거리에 따라 안개색과 섞은 색 문자열 (양자화 캐시) */
  Renderer3D.prototype.fogged = function (rgb, depth) {
    var f = (depth - 70) / 620;
    f = f < 0 ? 0 : (f > 0.92 ? 0.92 : f);
    var q = (f * 14) | 0;
    var key = rgb[3] || (rgb[3] = (rgb[0] << 16 | rgb[1] << 8 | rgb[2]));
    var ck = key * 16 + q;
    var hit = this.fogCache[ck];
    if (hit) return hit;
    var fog = this.st.pal.fog, t = q / 14;
    var r = (rgb[0] + (fog[0] - rgb[0]) * t) | 0;
    var g = (rgb[1] + (fog[1] - rgb[1]) * t) | 0;
    var b = (rgb[2] + (fog[2] - rgb[2]) * t) | 0;
    hit = 'rgb(' + r + ',' + g + ',' + b + ')';
    this.fogCache[ck] = hit;
    return hit;
  };

  function shade(rgb, f) {
    return [Math.min(255, rgb[0] * f) | 0, Math.min(255, rgb[1] * f) | 0, Math.min(255, rgb[2] * f) | 0];
  }

  /* ------------------------------------------------------------------ *
   *  메인 드로우
   * ------------------------------------------------------------------ */
  Renderer3D.prototype.draw = function (race, follow, dt) {
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.updateCamera(follow, dt);
    var pal = this.st.pal;

    // 하늘
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, pal.skyTop);
    grad.addColorStop(1, pal.skyBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 지면 (수평선 아래)
    var hy = this.horizonY();
    if (hy < h) {
      var gg = ctx.createLinearGradient(0, Math.max(0, hy), 0, h);
      gg.addColorStop(0, 'rgb(' + pal.fog[0] + ',' + pal.fog[1] + ',' + pal.fog[2] + ')');
      gg.addColorStop(0.16, 'rgb(' + pal.grass[0] + ',' + pal.grass[1] + ',' + pal.grass[2] + ')');
      gg.addColorStop(1, 'rgb(' + pal.grass2[0] + ',' + pal.grass2[1] + ',' + pal.grass2[2] + ')');
      ctx.fillStyle = gg;
      ctx.fillRect(0, Math.max(0, hy), w, h - Math.max(0, hy));
    }

    this.drawTrack(race, follow);
    this.drawGates(race, follow);
    this.drawProps(race, follow);
    this.drawCars(race, follow);
    this.drawParticles(race);

    // 충돌 섬광
    if (race.crashFlash > 0) {
      ctx.fillStyle = 'rgba(255,58,40,' + (race.crashFlash * 0.42).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
      race.crashFlash = Math.max(0, race.crashFlash - dt * 1.7);
    }

    ctx.restore();
  };

  /* ---- 트랙 노면 ---------------------------------------------------- */
  Renderer3D.prototype.drawTrack = function (race, follow) {
    var track = race.track, n = track.n, st = this.st, pal = st.pal;
    var half = track.half, sp = track.spacing;
    var start = (follow.trackIdx - 10 + n) % n;

    // LOD 구간 만들기 (가까운 곳은 촘촘히, 먼 곳은 성기게)
    var spans = [], i = 0, cursor = 0;
    while (cursor < 300) {
      var step = cursor < 34 ? 1 : (cursor < 90 ? 2 : (cursor < 170 ? 4 : 8));
      spans.push([cursor, Math.min(300, cursor + step)]);
      cursor += step;
    }

    var runWPre = half + Math.min(race.spec.runoff, 12);
    var road = pal.road, runoff = pal.runoff;
    var roadDark = shade(road, 0.88);
    var kerbA = [206, 48, 40], kerbB = [232, 232, 232];
    var white = [238, 238, 238];
    var q = [];

    function edge(idx, off) {
      var p = track.pts[idx], N = track.N[idx];
      return [p[0] + N[0] * off, p[1] + N[1] * off];
    }

    // 0) 잔디/지면 띠 (원근이 맞는 실제 지오메트리)
    var grassOut = st.barrier + 30;
    for (i = spans.length - 1; i >= 0; i--) {
      var ga0 = (start + spans[i][0]) % n, gb0 = (start + spans[i][1]) % n;
      var col = (spans[i][0] >> 2) % 2 ? pal.grass : pal.grass2;
      for (var gs = -1; gs <= 1; gs += 2) {
        var i1 = edge(ga0, gs * runWPre), i2 = edge(ga0, gs * grassOut);
        var i3 = edge(gb0, gs * grassOut), i4 = edge(gb0, gs * runWPre);
        q.length = 0;
        q.push(i1[0], i1[1], -0.02, i2[0], i2[1], -0.02, i3[0], i3[1], -0.02, i4[0], i4[1], -0.02);
        this.poly(q, col);
      }
    }

    // 1) 런오프 (먼 것부터)
    var runW = half + Math.min(race.spec.runoff, 12);
    for (i = spans.length - 1; i >= 0; i--) {
      var a = (start + spans[i][0]) % n, b = (start + spans[i][1]) % n;
      var la = edge(a, runW), ra = edge(a, -runW);
      var lb = edge(b, runW), rb = edge(b, -runW);
      q.length = 0;
      q.push(la[0], la[1], 0, ra[0], ra[1], 0, rb[0], rb[1], 0, lb[0], lb[1], 0);
      this.poly(q, (spans[i][0] >> 2) % 2 ? runoff : shade(runoff, 0.94));
    }

    // 2) 노면
    for (i = spans.length - 1; i >= 0; i--) {
      var a2 = (start + spans[i][0]) % n, b2 = (start + spans[i][1]) % n;
      var la2 = edge(a2, half), ra2 = edge(a2, -half);
      var lb2 = edge(b2, half), rb2 = edge(b2, -half);
      q.length = 0;
      q.push(la2[0], la2[1], 0, ra2[0], ra2[1], 0, rb2[0], rb2[1], 0, lb2[0], lb2[1], 0);
      this.poly(q, (spans[i][0] >> 3) % 2 ? road : roadDark);
    }

    // 3) 흰 트랙 라인
    for (i = spans.length - 1; i >= 0; i--) {
      if (spans[i][0] > 200) continue;
      var a3 = (start + spans[i][0]) % n, b3 = (start + spans[i][1]) % n;
      for (var s = -1; s <= 1; s += 2) {
        var o1 = s * half, o2 = s * (half - 0.35);
        var p1 = edge(a3, o1), p2 = edge(a3, o2), p3 = edge(b3, o2), p4 = edge(b3, o1);
        q.length = 0;
        q.push(p1[0], p1[1], 0.01, p2[0], p2[1], 0.01, p3[0], p3[1], 0.01, p4[0], p4[1], 0.01);
        this.poly(q, white);
      }
    }

    // 4) 연석
    for (i = spans.length - 1; i >= 0; i--) {
      if (spans[i][0] > 150) continue;
      var a4 = (start + spans[i][0]) % n;
      if (!st.kerb[a4]) continue;
      var b4 = (start + spans[i][1]) % n;
      var k = track.K[a4];
      var sides = Math.abs(k) > 0.010 ? [1, -1] : [k > 0 ? 1 : -1];
      var col = ((spans[i][0] + (a4 >> 1)) % 4 < 2) ? kerbA : kerbB;
      for (var si = 0; si < sides.length; si++) {
        var ss = sides[si];
        var e1 = edge(a4, ss * half), e2 = edge(a4, ss * (half + 1.5));
        var e3 = edge(b4, ss * (half + 1.5)), e4 = edge(b4, ss * half);
        q.length = 0;
        q.push(e1[0], e1[1], 0.02, e2[0], e2[1], 0.10, e3[0], e3[1], 0.10, e4[0], e4[1], 0.02);
        this.poly(q, col);
      }
    }

    // 5) 피트레인 (가까울 때만)
    this.drawPitLane(race, follow);

    // 6) 출발선 / 섹터 라인
    this.drawStartLine(race, follow);

    // 7) 주행 라인 가이드
    if (this.showLine) {
      var gcol = [64, 176, 255];
      for (i = spans.length - 1; i >= 0; i--) {
        if (spans[i][0] > 120 || (spans[i][0] >> 1) % 2) continue;
        var ga = (start + spans[i][0]) % n, gb = (start + spans[i][1]) % n;
        var pa = track.race[ga], pb = track.race[gb];
        var Na = track.N[ga], Nb = track.N[gb];
        q.length = 0;
        q.push(pa[0] + Na[0] * 0.45, pa[1] + Na[1] * 0.45, 0.03,
               pa[0] - Na[0] * 0.45, pa[1] - Na[1] * 0.45, 0.03,
               pb[0] - Nb[0] * 0.45, pb[1] - Nb[1] * 0.45, 0.03,
               pb[0] + Nb[0] * 0.45, pb[1] + Nb[1] * 0.45, 0.03);
        this.ctx.globalAlpha = 0.5;
        this.poly(q, gcol);
        this.ctx.globalAlpha = 1;
      }
    }

    // 8) 배리어
    this.drawBarriers(race, follow, spans, start);
  };

  Renderer3D.prototype.drawBarriers = function (race, follow, spans, start) {
    var track = race.track, n = track.n, st = this.st;
    var d = st.barrier, q = [];
    var wallA = st.street ? [188, 190, 196] : [214, 216, 220];
    var wallB = st.street ? [196, 60, 54] : [70, 96, 176];
    for (var i = spans.length - 1; i >= 0; i--) {
      if (spans[i][0] > 200) continue;
      var a = (start + spans[i][0]) % n, b = (start + spans[i][1]) % n;
      for (var s = -1; s <= 1; s += 2) {
        var pa = track.pts[a], Na = track.N[a], pb = track.pts[b], Nb = track.N[b];
        var x1 = pa[0] + Na[0] * d * s, y1 = pa[1] + Na[1] * d * s;
        var x2 = pb[0] + Nb[0] * d * s, y2 = pb[1] + Nb[1] * d * s;
        q.length = 0;
        q.push(x1, y1, 0, x2, y2, 0, x2, y2, 1.05, x1, y1, 1.05);
        this.poly(q, ((a >> 2) % 3 === 0) ? wallB : wallA);
      }
    }
  };

  Renderer3D.prototype.drawPitLane = function (race, follow) {
    var track = race.track, pit = track.pit, n = track.n;
    var k = race.pitMap[follow.trackIdx];
    var near = k >= 0;
    if (!near) {
      // 앞쪽 60포인트 안에 피트 입구가 있으면 미리 그린다
      var d = ((pit.entryIdx - follow.trackIdx) % n + n) % n;
      if (d > 90) return;
      k = 0;
    }
    var q = [], road = shade(this.st.pal.road, 0.86), line = [230, 230, 230];
    var from = Math.max(0, k - 12), to = Math.min(pit.pts.length - 1, k + 150);
    for (var i = to - 1; i >= from; i--) {
      var a = pit.pts[i], b = pit.pts[i + 1];
      var src = pit.idx[i], src2 = pit.idx[i + 1];
      var Na = track.N[src], Nb = track.N[src2];
      var hw = pit.width / 2;
      q.length = 0;
      q.push(a[0] + Na[0] * hw, a[1] + Na[1] * hw, 0.005,
             a[0] - Na[0] * hw, a[1] - Na[1] * hw, 0.005,
             b[0] - Nb[0] * hw, b[1] - Nb[1] * hw, 0.005,
             b[0] + Nb[0] * hw, b[1] + Nb[1] * hw, 0.005);
      this.poly(q, road);
      if (i % 2 === 0) {
        q.length = 0;
        q.push(a[0] + Na[0] * hw, a[1] + Na[1] * hw, 0.02,
               a[0] + Na[0] * (hw - 0.3), a[1] + Na[1] * (hw - 0.3), 0.02,
               b[0] + Nb[0] * (hw - 0.3), b[1] + Nb[1] * (hw - 0.3), 0.02,
               b[0] + Nb[0] * hw, b[1] + Nb[1] * hw, 0.02);
        this.poly(q, line);
      }
    }
    // 팀 박스
    var teams = global.F1DATA.TEAMS;
    for (var t = 0; t < pit.boxIdx.length; t++) {
      var bi = pit.boxIdx[t];
      if (bi < from || bi > to) continue;
      var p = pit.pts[bi], src3 = pit.idx[bi], N = track.N[src3], T = track.T[src3];
      var col = hexRGB(teams[t].color);
      q.length = 0;
      var sdd = pit.side;
      var o0 = sdd * (pit.width / 2 - 0.4), o1 = sdd * (pit.width / 2 + 3.4);
      q.push(p[0] - T[0] * 2.6 + N[0] * o0, p[1] - T[1] * 2.6 + N[1] * o0, 0.03,
             p[0] + T[0] * 2.6 + N[0] * o0, p[1] + T[1] * 2.6 + N[1] * o0, 0.03,
             p[0] + T[0] * 2.6 + N[0] * o1, p[1] + T[1] * 2.6 + N[1] * o1, 0.03,
             p[0] - T[0] * 2.6 + N[0] * o1, p[1] - T[1] * 2.6 + N[1] * o1, 0.03);
      this.poly(q, col);
      // 가라지 벽
      q.length = 0;
      q.push(p[0] - T[0] * 2.6 + N[0] * o1, p[1] - T[1] * 2.6 + N[1] * o1, 0,
             p[0] + T[0] * 2.6 + N[0] * o1, p[1] + T[1] * 2.6 + N[1] * o1, 0,
             p[0] + T[0] * 2.6 + N[0] * o1, p[1] + T[1] * 2.6 + N[1] * o1, 3.4,
             p[0] - T[0] * 2.6 + N[0] * o1, p[1] - T[1] * 2.6 + N[1] * o1, 3.4);
      this.poly(q, shade(col, 0.55));
    }
    // 내 박스 표시등 — 카메라를 향하는 수직 빌보드
    if (race.pitBoxHint && race.playerBox && race.player && race.player.pitState !== 'stopped') {
      var bx = race.playerBox;
      var dx = bx[0] - this.cx3, dy = bx[1] - this.cy3;
      var dd = Math.hypot(dx, dy);
      if (dd > 7) {
        var px = -dy / dd, py = dx / dd, hw = 0.85;
        var pulse = 0.55 + 0.45 * Math.sin(performance.now() / 140);
        q.length = 0;
        q.push(bx[0] - px * hw, bx[1] - py * hw, 0,
               bx[0] + px * hw, bx[1] + py * hw, 0,
               bx[0] + px * hw, bx[1] + py * hw, 4.0,
               bx[0] - px * hw, bx[1] - py * hw, 4.0);
        this.ctx.globalAlpha = pulse;
        this.poly(q, [255, 214, 51], 30);
        this.ctx.globalAlpha = 1;
      }
    }
  };

  Renderer3D.prototype.drawStartLine = function (race, follow) {
    var track = race.track, n = track.n, half = track.half, q = [];
    var d = ((0 - follow.trackIdx) % n + n) % n;
    if (d < 260 || d > n - 20) {
      var p = track.pts[0], N = track.N[0], T = track.T[0];
      for (var c = 0; c < 10; c++) {
        for (var r = 0; r < 2; r++) {
          var o1 = half - c * (half * 2 / 10), o2 = half - (c + 1) * (half * 2 / 10);
          var t1 = r * 1.4, t2 = (r + 1) * 1.4;
          q.length = 0;
          q.push(p[0] + N[0] * o1 + T[0] * t1, p[1] + N[1] * o1 + T[1] * t1, 0.015,
                 p[0] + N[0] * o2 + T[0] * t1, p[1] + N[1] * o2 + T[1] * t1, 0.015,
                 p[0] + N[0] * o2 + T[0] * t2, p[1] + N[1] * o2 + T[1] * t2, 0.015,
                 p[0] + N[0] * o1 + T[0] * t2, p[1] + N[1] * o1 + T[1] * t2, 0.015);
          this.poly(q, ((c + r) % 2) ? [240, 240, 240] : [26, 26, 26]);
        }
      }
    }
  };

  /* ---- DRS 게이트 / 섹터 게이트 -------------------------------------- */
  Renderer3D.prototype.drawGates = function (race, follow) {
    var track = race.track, n = track.n, half = track.half, q = [];
    var st = this.st;
    for (var i = 0; i < st.gates.length; i++) {
      var g = st.gates[i];
      var d = ((g.idx - follow.trackIdx) % n + n) % n;
      if (d > 220) continue;
      var p = track.pts[g.idx], N = track.N[g.idx];
      var col = g.type === 'drs' ? [46, 170, 92] : (g.type === 's1' ? [56, 150, 210] : [212, 180, 50]);
      var postH = 6.2, arm = half + 1.4;
      for (var s = -1; s <= 1; s += 2) {
        var bx = p[0] + N[0] * arm * s, by = p[1] + N[1] * arm * s;
        q.length = 0;
        q.push(bx - N[0] * 0.25, by - N[1] * 0.25, 0, bx + N[0] * 0.25, by + N[1] * 0.25, 0,
               bx + N[0] * 0.25, by + N[1] * 0.25, postH, bx - N[0] * 0.25, by - N[1] * 0.25, postH);
        this.poly(q, [72, 76, 84]);
      }
      var l = [p[0] + N[0] * arm, p[1] + N[1] * arm], r = [p[0] - N[0] * arm, p[1] - N[1] * arm];
      q.length = 0;
      q.push(l[0], l[1], postH - 1.1, r[0], r[1], postH - 1.1, r[0], r[1], postH, l[0], l[1], postH);
      this.poly(q, col);
    }
  };

  /* ---- 트랙사이드 오브젝트 -------------------------------------------- */
  Renderer3D.prototype.drawProps = function (race, follow) {
    var st = this.st, track = race.track, n = track.n;
    var list = [];
    for (var i = 0; i < st.objs.length; i++) {
      var o = st.objs[i];
      var d = ((o.idx - follow.trackIdx) % n + n) % n;
      if (d > 180) continue;
      var dx = o.x - this.cx3, dy = o.y - this.cy3;
      list.push({ o: o, d: dx * this.fx + dy * this.fy });
    }
    list.sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < list.length; i++) this.drawProp(list[i].o);
  };

  Renderer3D.prototype.drawProp = function (o) {
    var q = [], c = Math.cos(o.hdg), s = Math.sin(o.hdg);
    var nx = -s, ny = c;
    var box = function (cx, cy, wl, ww, h, z0) {
      return [
        cx - c * wl - nx * ww, cy - s * wl - ny * ww, z0,
        cx + c * wl - nx * ww, cy + s * wl - ny * ww, z0,
        cx + c * wl - nx * ww, cy + s * wl - ny * ww, z0 + h,
        cx - c * wl - nx * ww, cy - s * wl - ny * ww, z0 + h
      ];
    };
    if (o.kind === 'palm') {
      var ph = 7 + (o.seed % 6);
      q = box(o.x, o.y, 0.28, 0, ph, 0);
      this.poly(q, [86, 68, 44]);
      for (var pf = 0; pf < 3; pf++) {
        var sp2 = 1.4 + pf * 0.9;
        q = box(o.x, o.y, sp2, 0, 0.55, ph - 0.3 - pf * 0.5);
        this.poly(q, [44, 84, 44]);
      }
    } else if (o.kind === 'tree') {
      var th = 4 + (o.seed % 5);
      q = box(o.x, o.y, 0.35, 0, th * 0.35, 0);
      this.poly(q, [72, 54, 36]);
      q = box(o.x, o.y, 2.2, 0, th, th * 0.3);
      this.poly(q, [40 + (o.seed % 20), 88 + (o.seed % 30), 42]);
    } else if (o.kind === 'board') {
      q = box(o.x, o.y, 5.5, 0, 2.4, 0.2);
      this.poly(q, [238, 240, 244]);
      q = box(o.x, o.y, 5.0, -0.05, 1.4, 0.7);
      this.poly(q, [(o.seed * 37) % 200 + 40, (o.seed * 17) % 180 + 40, (o.seed * 7) % 200 + 40]);
    } else if (o.kind === 'stand') {
      q = box(o.x, o.y, 13, 0, 7.5, 0);
      this.poly(q, [86, 92, 102]);
      // 관중 픽셀
      for (var r = 0; r < 4; r++) {
        q = box(o.x, o.y, 12.4, -0.1, 0.9, 1.6 + r * 1.45);
        this.poly(q, [120 + (o.seed * (r + 3)) % 90, 116 + (o.seed * (r + 5)) % 80, 128]);
      }
    } else if (o.kind === 'building') {
      var bh = 10 + (o.seed % 16);
      q = box(o.x, o.y, 9, 0, bh, 0);
      this.poly(q, [150 + o.seed % 50, 140 + o.seed % 40, 128 + o.seed % 40]);
      for (var f = 1; f * 3 < bh - 2; f++) {
        q = box(o.x, o.y, 8, -0.1, 1.1, f * 3);
        this.poly(q, [70, 86, 104]);
      }
    } else { // tyres
      for (var t = 0; t < 3; t++) {
        q = box(o.x + c * (t - 1) * 1.3, o.y + s * (t - 1) * 1.3, 0.6, 0, 1.1, 0);
        this.poly(q, t % 2 ? [32, 32, 36] : [210, 210, 214]);
      }
    }
  };

  /* ---- 차량 ------------------------------------------------------------ */
  Renderer3D.prototype.drawCars = function (race, follow) {
    var list = [], i;
    for (i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      var dx = car.x - this.cx3, dy = car.y - this.cy3;
      var d = dx * this.fx + dy * this.fy;
      if (d < -8 || d > 420) continue;
      list.push({ car: car, d: d });
    }
    list.sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < list.length; i++) this.drawCar(list[i].car, list[i].d, race);
  };

  /* 차 좌표계 박스 하나를 그린다 (x 전방, y 우측, z 위).
     볼록 도형이므로 후면 컬링만으로 올바르게 그려진다. */
  Renderer3D.prototype.box = function (ctx3, f0, f1, s0, s1, z0, z1, col, bias) {
    var c = ctx3.c, s = ctx3.s, nx = -s, ny = c, x = ctx3.x, y = ctx3.y;
    var q = this.qbuf || (this.qbuf = []);
    var self = this;
    function W(f, sd, z) { return [x + c * f + nx * sd, y + s * f + ny * sd, z]; }

    // 8 꼭짓점
    var v = [
      W(f1, s0, z1), W(f1, s1, z1), W(f0, s1, z1), W(f0, s0, z1),   // 윗면 0-3
      W(f1, s0, z0), W(f1, s1, z0), W(f0, s1, z0), W(f0, s0, z0)    // 밑면 4-7
    ];
    // 면: [정점들, 월드 법선, 명암]
    var faces = [
      [[0, 1, 2, 3], [0, 0, 1], 1.16],                    // top
      [[4, 5, 1, 0], [c, s, 0], 0.80],                    // front (+x)
      [[6, 7, 3, 2], [-c, -s, 0], 0.62],                  // rear (-x)
      [[5, 6, 2, 1], [nx, ny, 0], 0.98],                  // +y
      [[7, 4, 0, 3], [-nx, -ny, 0], 0.74]                 // -y
    ];
    for (var i = 0; i < faces.length; i++) {
      var fc = faces[i], idx = fc[0], nrm = fc[1];
      // 중심 -> 카메라 방향과 법선 비교 (후면 컬링)
      var cxp = 0, cyp = 0, czp = 0;
      for (var k = 0; k < 4; k++) { cxp += v[idx[k]][0]; cyp += v[idx[k]][1]; czp += v[idx[k]][2]; }
      cxp /= 4; cyp /= 4; czp /= 4;
      if (nrm[0] * (cxp - this.cx3) + nrm[1] * (cyp - this.cy3) + nrm[2] * (czp - this.cz3) >= 0) continue;
      q.length = 0;
      for (k = 0; k < 4; k++) q.push(v[idx[k]][0], v[idx[k]][1], v[idx[k]][2]);
      var dd = (cxp - this.cx3) * this.fx + (cyp - this.cy3) * this.fy + (czp - this.cz3) * this.fz;
      self.poly(q, shade(col, fc[2]), dd + (bias || 0));
    }
  };

  Renderer3D.prototype.drawCar = function (car, depth, race) {
    var ctx3 = { c: Math.cos(car.heading), s: Math.sin(car.heading), x: car.x, y: car.y };
    var base = hexRGB(car.team.color);
    var acc = hexRGB(car.team.accent);
    var tc = hexRGB(car.tyre.color);
    var black = [30, 30, 34], dark = [20, 20, 24];
    var ctx = this.ctx;

    // 그림자
    var c = ctx3.c, s = ctx3.s, nx = -s, ny = c, q = [];
    function G(f, sd) { return [car.x + c * f + nx * sd, car.y + s * f + ny * sd, 0.004]; }
    var g1 = G(2.5, -1.05), g2 = G(2.5, 1.05), g3 = G(-2.6, 1.15), g4 = G(-2.6, -1.15);
    q.push(g1[0], g1[1], g1[2], g2[0], g2[1], g2[2], g3[0], g3[1], g3[2], g4[0], g4[1], g4[2]);
    ctx.globalAlpha = 0.34;
    this.poly(q, [8, 8, 10], depth + 1.2);
    ctx.globalAlpha = 1;

    // 구성품 (차 좌표계) — 카메라에서 먼 것부터
    var wz = 0.70, ws = 0.17;
    var parts = [
      [2.02, 2.48, -1.05, 1.05, 0.05, 0.17, acc],        // 프론트 윙
      [2.30, 2.44, -1.05, -0.86, 0.05, 0.34, base],      // 윙 엔드플레이트 L
      [2.30, 2.44, 0.86, 1.05, 0.05, 0.34, base],        // 윙 엔드플레이트 R
      [0.40, 2.16, -0.30, 0.30, 0.17, 0.46, base],       // 노즈
      [-2.05, 0.52, -0.44, 0.44, 0.09, 0.54, base],      // 섀시
      [-1.62, 0.46, 0.44, 0.74, 0.07, 0.50, base],       // 사이드팟 R
      [-1.62, 0.46, -0.74, -0.44, 0.07, 0.50, base],     // 사이드팟 L
      [-2.00, -0.36, -0.31, 0.31, 0.54, 0.84, base],     // 엔진 커버
      [-0.72, 0.34, -0.40, 0.40, 0.50, 0.58, black],     // 콕핏 주변
      [-0.10, 0.30, -0.36, 0.36, 0.58, 0.98, dark],      // 헤일로
      [-2.34, -1.92, -0.52, 0.52, 0.02, 0.24, dark],     // 디퓨저
      [-2.44, -2.16, -0.09, 0.09, 0.50, 0.94, black],    // 리어 윙 파일런
      [-2.58, -2.18, -0.80, 0.80, 0.92, 1.03, acc],      // 리어 윙
      [-2.62, -2.12, -0.86, -0.78, 0.60, 1.08, base],    // 엔드플레이트 L
      [-2.62, -2.12, 0.78, 0.86, 0.60, 1.08, base],      // 엔드플레이트 R
      [1.19, 1.91, 0.75, 0.75 + 0.34, 0.00, wz, black],  // 앞 오른쪽 타이어
      [1.19, 1.91, -0.75 - 0.34, -0.75, 0.00, wz, black],
      [-1.81, -1.09, 0.80, 0.80 + 0.36, 0.00, wz + 0.04, black],
      [-1.81, -1.09, -0.80 - 0.36, -0.80, 0.00, wz + 0.04, black]
    ];
    // DRS 열림: 윗 날개가 눕는다
    if (car.drs && car.drsAllowed) {
      parts[12] = [-2.58, -2.18, -0.80, 0.80, 0.99, 1.05, [96, 235, 146]];
    }

    var order = [];
    for (var i = 0; i < parts.length; i++) {
      var pp = parts[i];
      var mf = (pp[0] + pp[1]) / 2, msd = (pp[2] + pp[3]) / 2;
      var wx = car.x + c * mf + nx * msd, wy = car.y + s * mf + ny * msd;
      order.push({ p: pp, d: (wx - this.cx3) * this.fx + (wy - this.cy3) * this.fy });
    }
    order.sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < order.length; i++) {
      var o = order[i].p;
      this.box(ctx3, o[0], o[1], o[2], o[3], o[4], o[5], o[6], 0);
    }

    // 타이어 컴파운드 띠 (가까울 때만)
    if (depth < 70) {
      var ring = [[1.55, 0.92], [1.55, -0.92], [-1.45, 0.98], [-1.45, -0.98]];
      for (i = 0; i < ring.length; i++) {
        var sd = ring[i][1];
        this.box(ctx3, ring[i][0] - 0.16, ring[i][0] + 0.16,
                 sd > 0 ? sd + 0.17 : sd - 0.19, sd > 0 ? sd + 0.19 : sd - 0.17,
                 0.26, 0.42, tc, -0.4);
      }
    }

    this.carLabel(car, depth);
  };

  Renderer3D.prototype.carLabel = function (car, depth) {
    if (depth < 6 || depth > 190) return;
    this.view(car.x, car.y, 1.8, _t);
    if (_t[2] < NEAR) return;
    var sx = this.scx + _t[0] * this.focal / _t[2];
    var sy = this.scy - _t[1] * this.focal / _t[2];
    var ctx = this.ctx;
    var size = Math.max(8, Math.min(17, 260 / depth));
    ctx.font = 'bold ' + size.toFixed(0) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.max(0.25, 1 - depth / 190);
    if (car.isPlayer) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(sx, sy - size * 0.2);
      ctx.lineTo(sx - size * 0.45, sy - size * 0.95);
      ctx.lineTo(sx + size * 0.45, sy - size * 0.95);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(car.driver.code, sx + 1, sy + 1);
      ctx.fillStyle = car.team.color;
      ctx.fillText(car.driver.code, sx, sy);
    }
    ctx.globalAlpha = 1;
  };

  /* ---- 파티클 ---------------------------------------------------------- */
  Renderer3D.prototype.spawn = function (x, y, z, type, vx, vy) {
    if (this.particles.length > 220) return;
    this.particles.push({
      x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: 0.5 + Math.random(),
      life: type === 'smoke' ? 0.9 : 0.6, max: type === 'smoke' ? 0.9 : 0.6,
      size: type === 'smoke' ? 0.5 : 0.35, type: type
    });
  };

  Renderer3D.prototype.updateParticles = function (dt, race) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.93; p.vy *= 0.93; p.vz *= 0.96;
      p.size += dt * 2.6;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      if (car.retired) continue;
      var rx = car.x - Math.cos(car.heading) * 2.2, ry = car.y - Math.sin(car.heading) * 2.2;
      if (car.slip > 0.25 && car.speed > 12 && Math.random() < 0.55) {
        this.spawn(rx, ry, 0.25, 'smoke', (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
      }
      if (!car.onTrack && car.speed > 12 && Math.random() < 0.7) {
        this.spawn(rx, ry, 0.2, 'dust', (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      }
    }
  };

  Renderer3D.prototype.drawParticles = function (race) {
    var ctx = this.ctx, pal = this.st.pal;
    var list = [];
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      this.view(p.x, p.y, p.z, _t);
      if (_t[2] < NEAR || _t[2] > 320) continue;
      list.push({ p: p, x: this.scx + _t[0] * this.focal / _t[2], y: this.scy - _t[1] * this.focal / _t[2],
                  r: p.size * this.focal / _t[2], d: _t[2] });
    }
    list.sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < list.length; i++) {
      var it = list[i], q = it.p;
      ctx.globalAlpha = (q.life / q.max) * (q.type === 'smoke' ? 0.34 : 0.45);
      ctx.fillStyle = q.type === 'smoke' ? '#d3d7dd'
        : 'rgb(' + pal.grass[0] + ',' + pal.grass[1] + ',' + pal.grass[2] + ')';
      ctx.beginPath();
      ctx.arc(it.x, it.y, Math.max(1, it.r), 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* ---- 미니맵 (2D 오버레이) --------------------------------------------- */
  Renderer3D.prototype.drawMinimap = function (ctx, race, x, y, size) {
    var track = race.track, b = track.bounds;
    var wm = b.maxX - b.minX, hm = b.maxY - b.minY;
    var s = size / Math.max(wm, hm);
    var ox = x + (size - wm * s) / 2, oy = y + (size - hm * s) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.72)';
    ctx.fillRect(x - 6, y - 6, size + 12, size + 12);
    ctx.beginPath();
    for (var i = 0; i <= track.n; i += 2) {
      var p = track.pts[i % track.n];
      var px = ox + (p[0] - b.minX) * s, py = oy + (p[1] - b.minY) * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    var sp = track.pts[0];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox + (sp[0] - b.minX) * s - 2, oy + (sp[1] - b.minY) * s - 2, 4, 4);
    for (var c = 0; c < race.cars.length; c++) {
      var car = race.cars[c];
      if (car.retired) continue;
      var cx = ox + (car.x - b.minX) * s, cy = oy + (car.y - b.minY) * s;
      ctx.beginPath();
      ctx.arc(cx, cy, car.isPlayer ? 3.6 : 2.4, 0, 6.283);
      ctx.fillStyle = car.isPlayer ? '#ffffff' : car.team.color;
      ctx.fill();
      if (car.isPlayer) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    ctx.restore();
  };

  /* ---- 유틸 ------------------------------------------------------------ */
  var _hexCache = {};
  function hexRGB(hex) {
    var c = _hexCache[hex];
    if (c) return c;
    var v = parseInt(hex.slice(1), 16);
    c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    _hexCache[hex] = c;
    return c;
  }

  Renderer3D.prototype.reset = function () { this.pose = null; this.snap = true; };

  global.Renderer3D = Renderer3D;
  global.CAMERA_MODES = CAMS;
})(typeof window !== 'undefined' ? window : globalThis);
