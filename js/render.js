/* =========================================================================
 * F1 THE GAME - Renderer
 * 트랙을 오프스크린 캔버스에 1회 렌더링 후 카메라 변환으로 블릿
 * ========================================================================= */
(function (global) {
  'use strict';

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tex = null;
    this.particles = [];
    this.showLine = false;
    this.cam = { x: 0, y: 0, scale: 4.2, shake: 0 };
  }

  Renderer.prototype.resize = function (w, h, dpr) {
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
  };

  /* ---------------- 트랙 텍스처 ---------------- */
  Renderer.prototype.prepare = function (race) {
    var track = race.track, spec = race.spec, b = track.bounds;
    var wm = b.maxX - b.minX, hm = b.maxY - b.minY;
    var scale = Math.min(2.4, Math.sqrt(9.0e6 / (wm * hm)));
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(wm * scale);
    cv.height = Math.ceil(hm * scale);
    var g = cv.getContext('2d');
    g.save();
    g.scale(scale, scale);
    g.translate(-b.minX, -b.minY);

    // 배경
    g.fillStyle = spec.ground;
    g.fillRect(b.minX, b.minY, wm, hm);
    g.fillStyle = spec.groundDark;
    for (var s = 0; s < 1400; s++) {
      var px = b.minX + Math.random() * wm, py = b.minY + Math.random() * hm;
      g.globalAlpha = 0.10 + Math.random() * 0.16;
      var sz = 3 + Math.random() * 11;
      g.fillRect(px, py, sz, sz * (0.5 + Math.random()));
    }
    g.globalAlpha = 1;

    function pathOf(pts, close) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      if (close) g.closePath();
    }

    g.lineJoin = 'round'; g.lineCap = 'round';

    // 런오프
    pathOf(track.pts, true);
    g.strokeStyle = spec.id === 'monaco' ? '#6d7278' : '#8d8577';
    g.lineWidth = spec.width + spec.runoff * 1.7;
    g.stroke();
    if (spec.id !== 'monaco') {
      pathOf(track.pts, true);
      g.strokeStyle = '#9a9188';
      g.lineWidth = spec.width + spec.runoff * 0.75;
      g.stroke();
    }

    // 흰 트랙 라인 + 아스팔트
    pathOf(track.pts, true);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = spec.width + 1.2;
    g.stroke();
    pathOf(track.pts, true);
    g.strokeStyle = '#3a3d42';
    g.lineWidth = spec.width - 0.6;
    g.stroke();

    // 노면 질감
    g.save();
    g.globalAlpha = 0.12;
    pathOf(track.pts, true);
    g.strokeStyle = '#55595f';
    g.lineWidth = spec.width * 0.45;
    g.stroke();
    g.restore();

    // 연석
    this.drawKerbs(g, track);

    // 피트레인
    this.drawPit(g, track, spec);

    // 섹터 / DRS / 결승선
    this.drawLines(g, track, spec);

    g.restore();
    this.tex = { canvas: cv, scale: scale, ox: b.minX, oy: b.minY };
  };

  Renderer.prototype.drawKerbs = function (g, track) {
    var n = track.n;
    for (var i = 0; i < n; i++) {
      var k = track.K[i];
      if (Math.abs(k) < 0.0045) continue;
      var inner = k > 0 ? track.left : track.right;
      var outer = k > 0 ? track.right : track.left;
      var seg = Math.floor(i / 2) % 2 === 0;
      g.strokeStyle = seg ? '#d8382f' : '#f0f0f0';
      g.lineWidth = 1.9;
      g.beginPath();
      g.moveTo(inner[i][0], inner[i][1]);
      g.lineTo(inner[(i + 1) % n][0], inner[(i + 1) % n][1]);
      g.stroke();
      if (Math.abs(k) > 0.011) {
        g.beginPath();
        g.moveTo(outer[i][0], outer[i][1]);
        g.lineTo(outer[(i + 1) % n][0], outer[(i + 1) % n][1]);
        g.stroke();
      }
    }
  };

  Renderer.prototype.drawPit = function (g, track, spec) {
    var pit = track.pit, pts = pit.pts;
    if (pts.length < 4) return;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.strokeStyle = '#d6d6d6';
    g.lineWidth = pit.width + 1.2;
    g.stroke();
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.strokeStyle = '#33363b';
    g.lineWidth = pit.width;
    g.stroke();

    // 피트 박스
    var teams = global.F1DATA.TEAMS;
    for (var t = 0; t < pit.boxIdx.length; t++) {
      var bi = pit.boxIdx[t];
      if (bi < 1 || bi >= pts.length - 1) continue;
      var p = pts[bi], q = pts[bi + 1];
      var ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      g.save();
      g.translate(p[0], p[1]);
      g.rotate(ang);
      g.fillStyle = teams[t].color;
      g.globalAlpha = 0.85;
      g.fillRect(-4.5, -pit.width / 2, 9, 1.5);
      g.globalAlpha = 0.3;
      g.fillRect(-4.5, -pit.width / 2, 9, pit.width);
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.font = '2.6px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.fillText(teams[t].name.toUpperCase(), 0, -pit.width / 2 - 1.5);
      // 정지 위치 마커
      g.strokeStyle = '#ffdd33';
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(0, -2.2); g.lineTo(0, 2.2);
      g.stroke();
      g.restore();
    }

    // 피트 리미터 라인
    var e0 = pts[6] || pts[0], e1 = pts[7] || pts[1];
    markLine(g, e0, e1, pit.width, '#ffdd33', 'PIT LIMIT');
    var x0 = pts[pts.length - 8] || pts[0], x1 = pts[pts.length - 7] || pts[1];
    markLine(g, x0, x1, pit.width, '#ffdd33', '');
  };

  function markLine(g, p, q, w, color, label) {
    var ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    g.save();
    g.translate(p[0], p[1]); g.rotate(ang);
    g.fillStyle = color;
    g.fillRect(-0.4, -w / 2, 0.8, w);
    if (label) {
      g.fillStyle = '#ffffff';
      g.font = '2.4px "Segoe UI", sans-serif';
      g.textAlign = 'left';
      g.fillText(label, 1.4, -w / 2 - 1);
    }
    g.restore();
  }

  Renderer.prototype.drawLines = function (g, track, spec) {
    var n = track.n, half = track.half;
    // 결승선 체커
    var p = track.pts[0], t = track.T[0], N = track.N[0];
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(Math.atan2(t[1], t[0]));
    var cell = half * 2 / 8;
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 8; c++) {
        g.fillStyle = ((r + c) % 2 === 0) ? '#ffffff' : '#1a1a1a';
        g.fillRect(-1.6 + r * 1.6, -half + c * cell, 1.6, cell);
      }
    }
    g.restore();

    // 섹터 라인
    [Math.floor(n / 3), Math.floor(n * 2 / 3)].forEach(function (i, k) {
      var pp = track.pts[i], tt = track.T[i];
      g.save();
      g.translate(pp[0], pp[1]);
      g.rotate(Math.atan2(tt[1], tt[0]));
      g.fillStyle = k === 0 ? '#49c6ff' : '#ffe14d';
      g.fillRect(-0.35, -half, 0.7, half * 2);
      g.restore();
    });

    // DRS 존
    for (var z = 0; z < track.drs.length; z++) {
      var zi = track.drs[z].start;
      var pz = track.pts[zi], tz = track.T[zi];
      g.save();
      g.translate(pz[0], pz[1]);
      g.rotate(Math.atan2(tz[1], tz[0]));
      g.fillStyle = 'rgba(70,220,120,0.85)';
      g.fillRect(-0.3, -half, 0.6, half * 2);
      g.fillStyle = '#7dffb0';
      g.font = 'bold 4.5px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.save(); g.rotate(Math.PI / 2); g.fillText('DRS', 0, -half - 3); g.restore();
      g.restore();
    }
  };

  /* ---------------- 파티클 ---------------- */
  Renderer.prototype.spawn = function (x, y, type, vx, vy) {
    if (this.particles.length > 300) return;
    this.particles.push({
      x: x, y: y, vx: vx || 0, vy: vy || 0,
      life: type === 'smoke' ? 0.85 : 0.55, max: type === 'smoke' ? 0.85 : 0.55,
      size: type === 'smoke' ? 1.6 : 1.1, type: type
    });
  };

  Renderer.prototype.updateParticles = function (dt, race) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.size += dt * 3.2;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      if (car.retired) continue;
      var rear = { x: car.x - Math.cos(car.heading) * 2.2, y: car.y - Math.sin(car.heading) * 2.2 };
      if (car.slip > 0.28 && car.speed > 12 && Math.random() < 0.6) {
        this.spawn(rear.x, rear.y, 'smoke', (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      }
      if (!car.onTrack && car.speed > 14 && Math.random() < 0.8) {
        this.spawn(rear.x, rear.y, 'dust', (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      }
    }
  };

  /* ---------------- 메인 드로우 ---------------- */
  Renderer.prototype.draw = function (race, follow, dt) {
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = race.spec.sky;
    ctx.fillRect(0, 0, w, h);

    // 카메라
    var targetScale = 5.8 - Math.min(2.3, follow.speed / 46);
    this.cam.scale += (targetScale - this.cam.scale) * Math.min(1, dt * 2.5);
    var lead = 0.35;
    var tx = follow.x + follow.vx * lead, ty = follow.y + follow.vy * lead;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 6.5);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6.5);

    var sc = this.cam.scale;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (this.cam.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.cam.shake, (Math.random() - 0.5) * this.cam.shake);
      this.cam.shake *= 0.86;
    }
    ctx.scale(sc, sc);
    ctx.translate(-this.cam.x, -this.cam.y);

    // 트랙
    var tex = this.tex;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tex.canvas, tex.ox, tex.oy,
      tex.canvas.width / tex.scale, tex.canvas.height / tex.scale);

    // 레이싱 라인 가이드
    if (this.showLine) {
      var track = race.track;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#37c6ff';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      var i0 = race.player ? race.player.trackIdx : 0;
      for (var q = 0; q < 220; q++) {
        var pt = track.race[(i0 + q) % track.n];
        if (q === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 플레이어 피트 박스 하이라이트
    if (race.pitBoxHint && race.playerBox) {
      ctx.save();
      ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 150) * 0.25;
      ctx.fillStyle = '#ffdd33';
      ctx.beginPath();
      ctx.arc(race.playerBox[0], race.playerBox[1], 2.6, 0, 6.283);
      ctx.fill();
      ctx.restore();
    }

    // 파티클
    for (var pi = 0; pi < this.particles.length; pi++) {
      var p = this.particles[pi];
      var a = (p.life / p.max) * (p.type === 'smoke' ? 0.35 : 0.5);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.type === 'smoke' ? '#cfd3d8' : race.spec.ground;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 차량
    var cars = race.cars;
    for (var c = 0; c < cars.length; c++) if (!cars[c].isPlayer) this.drawCar(ctx, cars[c], false, sc);
    if (race.player) this.drawCar(ctx, race.player, true, sc);

    ctx.restore();
    ctx.restore();
  };

  Renderer.prototype.drawCar = function (ctx, car, isPlayer, sc) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    var col = car.team.color;
    var alpha = car.retired ? 0.4 : 1;
    ctx.globalAlpha = alpha;

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-2.6, -0.95, 5.4, 1.9);

    // 타이어
    ctx.fillStyle = '#17181a';
    ctx.fillRect(0.7, -1.05, 1.5, 0.62);
    ctx.fillRect(0.7, 0.43, 1.5, 0.62);
    ctx.fillRect(-2.2, -1.02, 1.6, 0.66);
    ctx.fillRect(-2.2, 0.36, 1.6, 0.66);

    // 바디
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(2.7, 0);
    ctx.lineTo(1.4, -0.42);
    ctx.lineTo(-0.2, -0.55);
    ctx.lineTo(-2.4, -0.62);
    ctx.lineTo(-2.7, 0);
    ctx.lineTo(-2.4, 0.62);
    ctx.lineTo(-0.2, 0.55);
    ctx.lineTo(1.4, 0.42);
    ctx.closePath();
    ctx.fill();

    // 앞/뒤 윙
    ctx.fillStyle = car.team.accent;
    ctx.fillRect(2.35, -0.95, 0.5, 1.9);
    ctx.fillRect(-2.85, -0.85, 0.55, 1.7);

    // 콕핏 + 헤일로
    ctx.fillStyle = '#101214';
    ctx.beginPath();
    ctx.ellipse(-0.35, 0, 0.75, 0.33, 0, 0, 6.283);
    ctx.fill();

    // DRS 열림 표시
    if (car.drs && car.drsAllowed) {
      ctx.strokeStyle = '#5dff9b';
      ctx.lineWidth = 0.18;
      ctx.strokeRect(-2.9, -0.9, 0.7, 1.8);
    }
    // 타이어 컴파운드 링
    ctx.strokeStyle = car.tyre.color;
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.arc(-0.35, 0, 1.05, 0, 6.283);
    ctx.stroke();

    ctx.restore();

    // 플레이어 마커 / 번호
    ctx.save();
    ctx.translate(car.x, car.y);
    if (isPlayer) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -3.4); ctx.lineTo(-0.9, -4.6); ctx.lineTo(0.9, -4.6);
      ctx.closePath(); ctx.fill();
    }
    if (sc > 3.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 1.5px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(car.driver.code, 0, isPlayer ? -5.0 : -3.4);
    }
    ctx.restore();
  };

  /* ---------------- 미니맵 ---------------- */
  Renderer.prototype.drawMinimap = function (ctx, race, x, y, size) {
    var track = race.track, b = track.bounds;
    var wm = b.maxX - b.minX, hm = b.maxY - b.minY;
    var s = size / Math.max(wm, hm);
    var ox = x + (size - wm * s) / 2, oy = y + (size - hm * s) / 2;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(x - 6, y - 6, size + 12, size + 12);
    ctx.globalAlpha = 1;
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

    // 결승선
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
      if (car.isPlayer) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  global.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
