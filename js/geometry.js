/* =========================================================================
 * F1 THE GAME - Track geometry builder
 * 컨트롤 포인트 -> Catmull-Rom 스플라인 -> 등간격 센터라인
 *  -> 가장자리 / 연석 / 피트레인 / 레이싱 라인 / DRS 존
 * ========================================================================= */
(function (global) {
  'use strict';

  var SPACING = 4; // 센터라인 샘플 간격(m)

  /* centripetal Catmull-Rom (alpha=0.5) — 급격한 코너에서 오버슈트/커스프 방지 */
  function catmull(p0, p1, p2, p3, t) {
    var a = 0.5;
    function knot(ti, pa, pb) {
      var d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      return ti + Math.pow(d < 1e-6 ? 1e-6 : d, a);
    }
    var t0 = 0, t1 = knot(t0, p0, p1), t2 = knot(t1, p1, p2), t3 = knot(t2, p2, p3);
    var tt = t1 + (t2 - t1) * t;
    function mix(pa, pb, ta, tb) {
      var w = (tb - tt) / (tb - ta), v = (tt - ta) / (tb - ta);
      return [pa[0] * w + pb[0] * v, pa[1] * w + pb[1] * v];
    }
    var A1 = mix(p0, p1, t0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
    var B1 = mix(A1, A2, t0, t2), B2 = mix(A2, A3, t1, t3);
    return mix(B1, B2, t1, t2);
  }

  function densify(ctrl, sub) {
    var n = ctrl.length, out = [];
    for (var i = 0; i < n; i++) {
      var p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i],
          p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (var j = 0; j < sub; j++) out.push(catmull(p0, p1, p2, p3, j / sub));
    }
    return out;
  }

  function polyLength(pts) {
    var L = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return L;
  }

  /** 닫힌 폴리라인을 등간격으로 재샘플링 */
  function resample(pts, spacing) {
    var total = polyLength(pts);
    var count = Math.max(16, Math.round(total / spacing));
    var step = total / count;
    var out = [], d = 0, i = 0, acc = 0;
    var cur = [pts[0][0], pts[0][1]];
    out.push([cur[0], cur[1]]);
    var idx = 0;
    while (out.length < count) {
      var a = pts[idx % pts.length], b = pts[(idx + 1) % pts.length];
      var segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var need = step - acc;
      if (segLen - d >= need) {
        d += need;
        var t = d / segLen;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        acc = 0;
      } else {
        acc += segLen - d;
        d = 0; idx++;
        if (idx > pts.length * 3) break;
      }
    }
    return out;
  }

  function smoothArray(arr, passes, wrap) {
    var a = arr.slice(), n = a.length;
    for (var p = 0; p < passes; p++) {
      var b = a.slice();
      for (var i = 0; i < n; i++) {
        var im = wrap ? (i - 1 + n) % n : Math.max(0, i - 1);
        var ip = wrap ? (i + 1) % n : Math.min(n - 1, i + 1);
        b[i] = (a[im] + 2 * a[i] + a[ip]) / 4;
      }
      a = b;
    }
    return a;
  }

  /**
   * 트랙 스펙으로부터 주행 가능한 지오메트리를 생성한다.
   */
  function buildTrack(spec) {
    var dense = densify(spec.points, 24);

    // 실제 서킷 길이에 맞춰 스케일
    var raw = polyLength(dense);
    var scale = spec.realLength / raw;
    for (var i = 0; i < dense.length; i++) {
      dense[i][0] *= scale;
      dense[i][1] *= scale;
    }

    var pts = resample(dense, SPACING);
    var n = pts.length;

    // 결승선을 메인 직선 한가운데로 옮긴다.
    // 컨트롤 포인트 0 은 직선의 '시작'이라 그대로 두면 그리드가 최종 코너에 놓인다.
    (function () {
      // 현(chord) 기준으로 방향을 재야 리샘플링 지터에 속지 않는다
      function dir(i) {
        var a = pts[i % n], b = pts[(i + 6) % n];
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
      function straightAt(i) {
        var d = dir(i + 6) - dir(i);
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) < 0.035;
      }
      // 인덱스 0 이후 처음 나오는 '충분히 긴' 직선 = 메인 스트레이트
      var MIN_RUN = 25;                          // 100m
      var a = -1, found = null;
      for (var i = 0; i < n; i++) {
        if (straightAt(i)) { if (a < 0) a = i; }
        else {
          if (a >= 0 && i - a >= MIN_RUN) { found = { a: a, len: i - a }; break; }
          a = -1;
        }
      }
      if (!found && a >= 0 && n - a >= MIN_RUN) found = { a: a, len: n - a };
      if (!found) return;
      var shift = found.a + Math.floor(found.len * 0.55);
      if (shift > 2 && shift < n - 2) pts = pts.slice(shift).concat(pts.slice(0, shift));
    })();

    var T = new Array(n), N = new Array(n), S = new Array(n), K = new Array(n);
    var total = 0;
    for (i = 0; i < n; i++) {
      var a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      T[i] = [dx / len, dy / len];
      N[i] = [-T[i][1], T[i][0]]; // 좌측(+) 법선
    }
    for (i = 0; i < n; i++) {
      S[i] = total;
      var c = pts[i], d = pts[(i + 1) % n];
      total += Math.hypot(d[0] - c[0], d[1] - c[1]);
    }
    // 곡률: 헤딩 변화율 (좌회전 +, 우회전 -)
    for (i = 0; i < n; i++) {
      var t0 = T[(i - 1 + n) % n], t1 = T[(i + 1) % n];
      var cross = t0[0] * t1[1] - t0[1] * t1[0];
      var dot = t0[0] * t1[0] + t0[1] * t1[1];
      var dtheta = Math.atan2(cross, dot);
      var ds = Math.hypot(pts[(i + 1) % n][0] - pts[(i - 1 + n) % n][0],
                          pts[(i + 1) % n][1] - pts[(i - 1 + n) % n][1]) || 1;
      K[i] = dtheta / ds;
    }
    K = smoothArray(K, 3, true);

    var half = spec.width / 2;
    var left = new Array(n), right = new Array(n);
    for (i = 0; i < n; i++) {
      left[i] = [pts[i][0] + N[i][0] * half, pts[i][1] + N[i][1] * half];
      right[i] = [pts[i][0] - N[i][0] * half, pts[i][1] - N[i][1] * half];
    }

    // ---- 피트레인 -------------------------------------------------------
    var pit = spec.pit;
    var entryIdx = Math.floor(pit.entryT * n) % n;
    var exitIdx = Math.floor(pit.exitT * n) % n;
    var pitIdx = [], k = entryIdx;
    for (var guard = 0; guard < n; guard++) {
      pitIdx.push(k);
      if (k === exitIdx) break;
      k = (k + 1) % n;
    }
    var pitLen = pitIdx.length * SPACING;
    var ramp = Math.min(110, pitLen * 0.25);
    var pitPts = [], pitOff = [];
    for (i = 0; i < pitIdx.length; i++) {
      var dAlong = i * SPACING;
      var f = 1;
      if (dAlong < ramp) f = dAlong / ramp;
      else if (dAlong > pitLen - ramp) f = Math.max(0, (pitLen - dAlong) / ramp);
      f = f * f * (3 - 2 * f); // smoothstep
      var off = pit.offset * f * pit.side;
      var src = pitIdx[i];
      pitOff.push(off);
      pitPts.push([pts[src][0] + N[src][0] * off, pts[src][1] + N[src][1] * off]);
    }
    // 피트 박스 (팀당 1개) — 램프 구간 밖의 평탄부에 배치
    var flatStart = Math.ceil(ramp / SPACING) + 4;
    var flatEnd = pitIdx.length - Math.ceil(ramp / SPACING) - 4;
    var boxSpan = Math.max(1, flatEnd - flatStart);
    var pitBoxIdx = [];
    for (i = 0; i < 10; i++) {
      pitBoxIdx.push(flatStart + Math.round(boxSpan * (i + 0.5) / 10));
    }

    // ---- 레이싱 라인 ----------------------------------------------------
    // 1) 아펙스를 향한 초기 프로파일 -> 2) 코스 폭 안에서 곡률 최소화 완화
    var usable = Math.max(1.5, half - 2.3);
    var lat = new Array(n);
    for (i = 0; i < n; i++) {
      var kk = K[i];
      var strength = Math.min(1, Math.abs(kk) * 260);
      lat[i] = -Math.sign(kk) * usable * strength;
    }
    lat = smoothArray(lat, 12, true);

    var rx = new Array(n), ry = new Array(n);
    function sync(i) {
      rx[i] = pts[i][0] + N[i][0] * lat[i];
      ry[i] = pts[i][1] + N[i][1] * lat[i];
    }
    for (i = 0; i < n; i++) sync(i);

    for (var it = 0; it < 260; it++) {
      for (i = 0; i < n; i++) {
        var im = (i - 1 + n) % n, ip = (i + 1) % n;
        var mx = (rx[im] + rx[ip]) * 0.5, my = (ry[im] + ry[ip]) * 0.5;
        var want = (mx - pts[i][0]) * N[i][0] + (my - pts[i][1]) * N[i][1];
        var v = lat[i] + (want - lat[i]) * 0.45;
        lat[i] = v < -usable ? -usable : (v > usable ? usable : v);
        sync(i);
      }
    }

    var race = new Array(n);
    for (i = 0; i < n; i++) race[i] = [rx[i], ry[i]];

    // 레이싱 라인 기준 곡률 (AI 목표 속도 계산용)
    // 헤딩 변화율로 구한 뒤, 근방 최대값을 취해 코너 진입에서 과속하지 않게 한다.
    var rk = new Array(n);
    for (i = 0; i < n; i++) {
      var pA = race[(i - 2 + n) % n], pB = race[i], pC = race[(i + 2) % n];
      var d1x = pB[0] - pA[0], d1y = pB[1] - pA[1];
      var d2x = pC[0] - pB[0], d2y = pC[1] - pB[1];
      var l1 = Math.hypot(d1x, d1y) || 1, l2 = Math.hypot(d2x, d2y) || 1;
      var cross = (d1x * d2y - d1y * d2x) / (l1 * l2);
      var dot = (d1x * d2x + d1y * d2y) / (l1 * l2);
      rk[i] = Math.abs(Math.atan2(cross, dot)) / ((l1 + l2) / 2);
    }
    rk = smoothArray(rk, 2, true);
    var raceK = new Array(n);
    for (i = 0; i < n; i++) {
      var mx2 = 0;
      for (var w = -3; w <= 3; w++) { var vv = rk[(i + w + n) % n]; if (vv > mx2) mx2 = vv; }
      raceK[i] = mx2;
    }

    // ---- DRS 존: 가장 긴 저곡률 직선 2곳 --------------------------------
    var straight = new Array(n);
    for (i = 0; i < n; i++) straight[i] = Math.abs(K[i]) < 0.0016 ? 1 : 0;
    var zones = [];
    var runStart = -1;
    for (i = 0; i < n * 2; i++) {
      var idx2 = i % n;
      if (straight[idx2]) { if (runStart < 0) runStart = i; }
      else {
        if (runStart >= 0 && i - runStart > 60) zones.push({ a: runStart % n, b: (i - 1) % n, len: (i - runStart) * SPACING });
        runStart = -1;
      }
      if (i >= n && runStart < 0 && zones.length) break;
    }
    zones.sort(function (x, y) { return y.len - x.len; });
    var drs = zones.slice(0, 2).map(function (z) {
      return { start: z.a, end: z.b, detect: (z.a - 45 + n) % n };
    });

    // ---- 스타팅 그리드 ---------------------------------------------------
    var grid = [];
    // 결승선 뒤쪽으로 이어지는 직선 구간 길이를 재서 그리드 간격을 맞춘다
    var backRun = 0;
    while (backRun < 120 && Math.abs(K[(n - 1 - backRun) % n]) < 0.0022) backRun++;
    var backLen = Math.max(70, backRun * SPACING - 8);
    var rowGap = Math.min(15, (backLen - 10) / 9);
    for (i = 0; i < 20; i++) {
      var back = 10 + Math.floor(i / 2) * rowGap;
      var gi = (Math.round((-back) / SPACING) % n + n * 2) % n;
      var side = (i % 2 === 0 ? 1 : -1) * (half * 0.42);
      grid.push({
        x: pts[gi][0] + N[gi][0] * side,
        y: pts[gi][1] + N[gi][1] * side,
        heading: Math.atan2(T[gi][1], T[gi][0]),
        idx: gi
      });
    }

    // ---- 바운딩 박스 ----------------------------------------------------
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(p) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    for (i = 0; i < n; i++) { grow(left[i]); grow(right[i]); }
    for (i = 0; i < pitPts.length; i++) grow(pitPts[i]);
    var pad = spec.runoff + 40;

    return {
      spec: spec,
      pts: pts, n: n, T: T, N: N, S: S, K: K, raceK: raceK,
      left: left, right: right, race: race, lat: lat,
      length: total, spacing: SPACING, half: half,
      barrier: half + spec.runoff,            // 물리 벽 = 그려지는 배리어
      runoff: spec.runoff,
      pit: {
        pts: pitPts, idx: pitIdx, off: pitOff,
        boxIdx: pitBoxIdx, width: 11,
        entryIdx: entryIdx, exitIdx: exitIdx,
        limit: pit.limit / 3.6, side: pit.side, offset: pit.offset
      },
      drs: drs,
      grid: grid,
      bounds: { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
    };
  }

  function circleCurvature(a, b, c) {
    var ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    var area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    var ab = Math.hypot(bx - ax, by - ay);
    var bc = Math.hypot(cx - bx, cy - by);
    var ca = Math.hypot(ax - cx, ay - cy);
    var denom = ab * bc * ca;
    if (denom < 1e-6) return 0;
    return 2 * area2 / denom;
  }

  /** 캐시된 인덱스 주변을 우선 탐색하는 최근접 센터라인 인덱스 */
  function nearestIndex(track, x, y, hint) {
    var n = track.n, best = -1, bestD = Infinity, i, d, p;
    if (hint >= 0) {
      for (var o = -50; o <= 50; o++) {
        i = (hint + o + n) % n;
        p = track.pts[i];
        d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD < 90 * 90) return best;
    }
    best = -1; bestD = Infinity;
    for (i = 0; i < n; i += 3) {
      p = track.pts[i];
      d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    for (var j = -4; j <= 4; j++) {
      i = (best + j + n) % n;
      p = track.pts[i];
      d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** 센터라인 기준 부호 있는 횡방향 오프셋 (좌측 +) */
  function lateralOffset(track, idx, x, y) {
    var p = track.pts[idx], N = track.N[idx];
    return (x - p[0]) * N[0] + (y - p[1]) * N[1];
  }

  var _cache = {};
  function getTrack(spec) {
    if (!_cache[spec.id]) _cache[spec.id] = buildTrack(spec);
    return _cache[spec.id];
  }

  global.Geometry = {
    buildTrack: buildTrack,
    getTrack: getTrack,
    nearestIndex: nearestIndex,
    lateralOffset: lateralOffset,
    polyLength: polyLength,
    SPACING: SPACING
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Geometry;
})(typeof window !== 'undefined' ? window : globalThis);
