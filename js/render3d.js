/* =========================================================================
 * F1 THE GAME - WebGL 3D renderer (three.js)
 *
 * 게임 월드 좌표: x(동), y(남), z(위).  three.js 좌표: (x, -y, z), Z-up.
 * y 를 뒤집는 이유: 게임의 +y 는 진행 방향 기준 '오른쪽'이라 그대로 쓰면
 * 화면이 좌우 반전된다.
 *
 * 구성
 *  - PBR 재질 + ACES 톤매핑 + 실시간 그림자(플레이어 주변 캐스케이드 1장)
 *  - 하늘 돔 셰이더(태양 산란) → PMREM 환경맵으로 차체 반사
 *  - 서킷 메시는 트랙당 1회 생성: 노면(러버 라인 버텍스 컬러) / 흰 선 / 연석 /
 *    런오프 / 배리어 + 캐치펜스 / 피트레인 · 피트 빌딩 / 그리드 / 출발 갠트리
 *  - 차량은 부품을 재질별로 병합한 상세 모델 (팀 리버리, 회전·조향 휠,
 *    액티브 에어로 플랩, 회생 시 깜빡이는 후미등)
 *  - 파티클: 연기 / 흙먼지 / 플랭크 스파크 (셰이더 포인트)
 *  - 2D 오버레이 캔버스: 드라이버 태그, 미니맵, 충돌 섬광
 * ========================================================================= */
(function (global) {
  'use strict';

  var THREE = global.THREE;

  var CAMS = [
    { id: 'chase',   label: '추격',  dist: 8.4,  height: 2.55, look: 14, lookZ: 1.05, fov: 60 },
    { id: 'close',   label: '근접',  dist: 5.2,  height: 1.75, look: 12, lookZ: 0.95, fov: 66 },
    { id: 'tcam',    label: 'T캠',   dist: 0.42, height: 1.22, look: 20, lookZ: 1.0,  fov: 72, rigid: true },
    { id: 'cockpit', label: '콕핏',  dist: 0.1, height: 0.93, look: 20, lookZ: 0.70, fov: 74, rigid: true },
    { id: 'heli',    label: '헬기',  dist: 17,   height: 10.5, look: 10, lookZ: 0.40, fov: 54 }
  ];

  /* ------------------------------------------------------------------ *
   *  트랙별 환경
   * ------------------------------------------------------------------ */
  function environment(spec) {
    if (spec.timeOfDay === 'night') {
      return {
        night: true,
        skyTop: 0x05060f, skyHor: 0x2a1d3e, sunCol: 0xffd9a0, sunDir: [0.25, 0.4, 0.88],
        fog: 0x1a1428, fogNear: 220, fogFar: 1500,
        hemiSky: 0x8d93c8, hemiGround: 0x3a2c1e, hemiI: 1.15,
        sunI: 2.1, exposure: 1.05,
        ground: 0xb08a58, groundTex: 'sand', runoff: 0x5a5a5e, road: 0x55565c,
        hills: 0x2b2030, kerbB: 0xeaeaea, cloud: 0.1
      };
    }
    if (spec.timeOfDay === 'overcast') {
      return {
        night: false,
        skyTop: 0x4a5462, skyHor: 0xb3bcc6, sunCol: 0xe8eef4, sunDir: [-0.35, 0.3, 0.88],
        fog: 0x9aa3ae, fogNear: 180, fogFar: 1300,
        hemiSky: 0xc4ccd6, hemiGround: 0x4a5a3c, hemiI: 1.35,
        sunI: 1.2, exposure: 1.0,
        ground: 0x4f7a3a, groundTex: 'grass', runoff: 0x66676b, road: 0x4c4e54,
        hills: 0x3d5a3a, kerbB: 0xe6e6e6, cloud: 0.95
      };
    }
    if (spec.id === 'monaco') {
      return {
        night: false,
        skyTop: 0x2763b0, skyHor: 0xbcd6ee, sunCol: 0xfff1d6, sunDir: [0.5, -0.45, 0.74],
        fog: 0xb5cbe0, fogNear: 260, fogFar: 1700,
        hemiSky: 0xbfd8f2, hemiGround: 0x6f6a60, hemiI: 1.0,
        sunI: 2.9, exposure: 1.0,
        ground: 0x8d8c88, groundTex: 'concrete', runoff: 0x96948e, road: 0x4a4b50,
        hills: 0x5c7564, kerbB: 0xf0f0f0, cloud: 0.35
      };
    }
    return {
      night: false,
      skyTop: 0x2a6ac4, skyHor: 0xcfe2f4, sunCol: 0xfff3dc, sunDir: [-0.4, -0.5, 0.77],
      fog: 0xc0d4e8, fogNear: 280, fogFar: 1800,
      hemiSky: 0xc4dcf4, hemiGround: 0x4f6a35, hemiI: 1.0,
      sunI: 3.0, exposure: 1.0,
      ground: 0x5b8f3e, groundTex: 'grass', runoff: 0x6e6f73, road: 0x4c4e54,
      hills: 0x4d7246, kerbB: 0xeeeeee, cloud: 0.5
    };
  }

  /* ------------------------------------------------------------------ *
   *  절차적 텍스처 (캔버스)
   * ------------------------------------------------------------------ */
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }

  function canvasTex(w, h, draw, opts) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = (opts && opts.linear) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  var TEX = null;
  function textures() {
    if (TEX) return TEX;
    TEX = {};
    // 아스팔트: 미세 골재 + 얼룩
    TEX.asphalt = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
      var r = rng(7);
      for (var i = 0; i < 26000; i++) {
        var v = 90 + r() * 110 | 0;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + r() * 0.5).toFixed(2) + ')';
        g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      for (i = 0; i < 26; i++) {
        var gr = g.createRadialGradient(0, 0, 0, 0, 0, 30 + r() * 60);
        gr.addColorStop(0, 'rgba(40,40,40,0.16)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
        g.save(); g.translate(r() * w, r() * h); g.fillStyle = gr;
        g.fillRect(-100, -100, 200, 200); g.restore();
      }
      // 이음매 (세로 방향 실금)
      g.strokeStyle = 'rgba(30,30,30,0.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(w * 0.5, 0); g.lineTo(w * 0.5 + 3, h); g.stroke();
    });
    TEX.asphaltRough = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, w, h);
      var r = rng(19);
      for (var i = 0; i < 9000; i++) {
        var v = 150 + r() * 105 | 0;
        g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        g.fillRect(r() * w, r() * h, 1.5, 1.5);
      }
    }, { linear: true });
    TEX.grass = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
      var r = rng(3);
      for (var i = 0; i < 30000; i++) {
        var v = 110 + r() * 120 | 0;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.55)';
        g.fillRect(r() * w, r() * h, 1, 2 + r() * 4);
      }
      // 잔디 깎은 줄무늬
      for (i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        g.fillRect(0, i * h / 4, w, h / 4);
      }
    });
    TEX.sand = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#a0a0a0'; g.fillRect(0, 0, w, h);
      var r = rng(5);
      for (var i = 0; i < 22000; i++) {
        var v = 120 + r() * 110 | 0;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.45)';
        g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      g.strokeStyle = 'rgba(80,80,80,0.12)';
      for (i = 0; i < 40; i++) {
        g.lineWidth = 2 + r() * 4;
        g.beginPath(); var y = r() * h; g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + 20 * (r() - 0.5), w * 0.6, y + 20 * (r() - 0.5), w, y);
        g.stroke();
      }
    });
    TEX.concrete = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#a8a8a8'; g.fillRect(0, 0, w, h);
      var r = rng(11);
      for (var i = 0; i < 14000; i++) {
        var v = 130 + r() * 90 | 0;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.4)';
        g.fillRect(r() * w, r() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 2;
      for (i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
        g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
      }
    });
    TEX.gravel = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#b8b2a6'; g.fillRect(0, 0, w, h);
      var r = rng(23);
      for (var i = 0; i < 9000; i++) {
        var v = 120 + r() * 120 | 0;
        g.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 16) + ')';
        g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * 1.6, 0, 6.28); g.fill();
      }
    });
    // 캐치펜스 메시
    TEX.fence = canvasTex(64, 64, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(210,214,220,1)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    });
    // 관중
    TEX.crowd = canvasTex(512, 128, function (g, w, h) {
      g.fillStyle = '#3a3f4a'; g.fillRect(0, 0, w, h);
      var r = rng(31);
      var cols = ['#e10600', '#ff8000', '#ffffff', '#2540a8', '#00d7b6', '#f5e600', '#1b1b1b', '#e8002d', '#7fb2ff', '#d9d9d9'];
      for (var row = 0; row < 8; row++) {
        for (var x = 0; x < w; x += 6) {
          if (r() < 0.12) continue;
          g.fillStyle = cols[(r() * cols.length) | 0];
          g.fillRect(x + r() * 2, row * 16 + 5, 4, 7);
          g.fillStyle = '#e0b89a';
          g.fillRect(x + 1 + r() * 2, row * 16 + 2, 3, 3);
        }
      }
    });
    TEX.windows = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#d8d0c0'; g.fillRect(0, 0, w, h);
      var r = rng(41);
      for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
          g.fillStyle = r() < 0.2 ? '#f2e3b8' : '#4a5a6c';
          g.fillRect(x * 64 + 14, y * 64 + 12, 36, 40);
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fillRect(x * 64 + 14, y * 64 + 12, 36, 4);
          g.fillStyle = '#7a6a58';
          g.fillRect(x * 64 + 10, y * 64 + 52, 44, 5);       // 발코니
        }
      }
    });
    // 광고판 (가상 브랜드)
    var BRANDS = [
      ['GG GAMES', '#e10600', '#ffffff'], ['APEX OIL', '#0b1a2b', '#ffd400'],
      ['VELOCE', '#ffffff', '#c8102e'], ['TURBOWAVE', '#003b7a', '#ffffff'],
      ['KERBSIDE', '#111111', '#3cff8f'], ['NOVA TYRES', '#f5e600', '#111111'],
      ['PITLANE.TV', '#6d28d9', '#ffffff'], ['SLIPSTREAM', '#00a6d6', '#ffffff']
    ];
    TEX.boards = BRANDS.map(function (b, i) {
      return canvasTex(512, 128, function (g, w, h) {
        g.fillStyle = b[1]; g.fillRect(0, 0, w, h);
        g.fillStyle = b[2];
        g.font = 'italic 900 78px "Segoe UI", Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(b[0], w / 2, h / 2 + 4);
        if (i % 2) { g.fillRect(0, h - 10, w, 10); }
      });
    });
    // 배리어 패널 (빨강/흰 + 광고)
    TEX.barrier = canvasTex(1024, 64, function (g, w, h) {
      for (var i = 0; i < 8; i++) {
        var b = BRANDS[i];
        g.fillStyle = b[1]; g.fillRect(i * 128, 0, 128, h);
        g.fillStyle = b[2];
        g.font = 'italic 900 22px "Segoe UI", Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(b[0], i * 128 + 64, h / 2 + 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (i = 0; i < 8; i++) g.fillRect(i * 128, 0, 2, h);
    });
    TEX.tecpro = canvasTex(256, 64, function (g, w, h) {
      for (var i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? '#d9dde3' : '#d4242b';
        g.fillRect(i * 64, 0, 64, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, h - 8, w, 8);
    });
    // 체커 출발선
    TEX.checker = canvasTex(256, 64, function (g, w, h) {
      for (var x = 0; x < 16; x++) for (var y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#151515';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    });
    // 카본 위브
    TEX.carbon = canvasTex(64, 64, function (g, w, h) {
      g.fillStyle = '#2a2b2e'; g.fillRect(0, 0, w, h);
      for (var x = 0; x < 8; x++) for (var y = 0; y < 8; y++) {
        var gr = g.createLinearGradient(x * 8, y * 8, x * 8 + 8, y * 8 + 8);
        var a = (x + y) % 2;
        gr.addColorStop(0, a ? '#3a3c40' : '#1d1e21');
        gr.addColorStop(1, a ? '#1d1e21' : '#3a3c40');
        g.fillStyle = gr; g.fillRect(x * 8, y * 8, 8, 8);
      }
    });
    TEX.carbon.repeat.set(6, 6);
    // 둥근 파티클
    TEX.puff = canvasTex(64, 64, function (g, w, h) {
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    TEX.glow = canvasTex(64, 64, function (g, w, h) {
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.2, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    return TEX;
  }

  /** 타이어 측면 (컴파운드 색 띠 + 휠 커버) */
  var _sideCache = {};
  function sidewallTex(color) {
    if (_sideCache[color]) return _sideCache[color];
    var t = canvasTex(256, 256, function (g, w, h) {
      var cx = 128, cy = 128;
      g.fillStyle = '#141416'; g.fillRect(0, 0, w, h);
      g.beginPath(); g.arc(cx, cy, 127, 0, 6.283); g.fillStyle = '#1b1b1d'; g.fill();
      g.beginPath(); g.arc(cx, cy, 104, 0, 6.283); g.lineWidth = 7; g.strokeStyle = color; g.stroke();
      // 사이드월 레터링
      g.fillStyle = 'rgba(235,235,235,0.85)';
      g.font = 'bold 15px Arial';
      g.textAlign = 'center';
      for (var k = 0; k < 2; k++) {
        g.save(); g.translate(cx, cy); g.rotate(k * Math.PI);
        g.fillText('N O V A', 0, -112);
        g.restore();
      }
      // 림 + 휠 커버
      g.beginPath(); g.arc(cx, cy, 86, 0, 6.283); g.fillStyle = '#2b2d31'; g.fill();
      var gr = g.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, 86);
      gr.addColorStop(0, '#5a5e66'); gr.addColorStop(1, '#202226');
      g.beginPath(); g.arc(cx, cy, 80, 0, 6.283); g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
      for (k = 0; k < 10; k++) {
        g.beginPath(); g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(k * 0.628) * 78, cy + Math.sin(k * 0.628) * 78); g.stroke();
      }
      g.beginPath(); g.arc(cx, cy, 14, 0, 6.283); g.fillStyle = color; g.fill();
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    _sideCache[color] = t;
    return t;
  }

  /** 차 번호 데칼 */
  function numberTex(num, fg, bg) {
    return canvasTex(128, 128, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 60, 0, 6.283); g.fill(); }
      g.fillStyle = fg;
      g.font = 'italic 900 78px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), 64, 68);
    });
  }

  /* ------------------------------------------------------------------ *
   *  지오메트리 유틸
   * ------------------------------------------------------------------ */
  /** 여러 지오메트리를 (행렬 적용 후) 하나로 합친다 */
  function merge(list) {
    var pos = [], nrm = [], uv = [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i].index ? list[i].toNonIndexed() : list[i];
      if (!g.attributes.normal) g.computeVertexNormals();
      var p = g.attributes.position.array, n = g.attributes.normal.array;
      var u = g.attributes.uv ? g.attributes.uv.array : null;
      for (var k = 0; k < p.length; k++) { pos.push(p[k]); nrm.push(n[k]); }
      var vc = p.length / 3;
      for (k = 0; k < vc; k++) {
        if (u) { uv.push(u[k * 2], u[k * 2 + 1]); } else uv.push(0, 0);
      }
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  /** 박스 (중심, 크기, 회전) */
  function boxG(cx, cy, cz, sx, sy, sz, rx, ry, rz) {
    var g = new THREE.BoxGeometry(sx, sy, sz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(cx, cy, cz);
    return g;
  }

  /**
   * 테이퍼 박스: x0→x1 구간에서 단면(폭, 하단, 상단)이 선형으로 변하는 볼록 블록.
   * 차량 노즈 / 사이드팟 / 엔진 커버용. 단면을 여러 개 주면 그 사이를 잇는다.
   * sections: [[x, halfWidth, zBottom, zTop, (yCenter)], ...]
   */
  function loft(sections, bevel) {
    var pos = [];
    var b = bevel === undefined ? 0.25 : bevel;
    function ring(s) {
      var x = s[0], hw = s[1], z0 = s[2], z1 = s[3], yc = s[4] || 0;
      var bw = hw * b, bz = (z1 - z0) * b;
      // 8각 단면 (모서리 모따기)
      return [
        [x, yc - hw + bw, z1], [x, yc + hw - bw, z1],
        [x, yc + hw, z1 - bz], [x, yc + hw, z0 + bz * 0.6],
        [x, yc + hw - bw, z0], [x, yc - hw + bw, z0],
        [x, yc - hw, z0 + bz * 0.6], [x, yc - hw, z1 - bz]
      ];
    }
    var rings = sections.map(ring);
    var idx = [], R = rings.length, i, k;
    // 측면: 링 정점을 공유해 부드러운 법선
    for (i = 0; i < R; i++) for (k = 0; k < 8; k++) pos.push(rings[i][k][0], rings[i][k][1], rings[i][k][2]);
    for (i = 0; i < R - 1; i++) {
      for (k = 0; k < 8; k++) {
        var k2 = (k + 1) % 8, a0 = i * 8 + k, a1 = i * 8 + k2, b0 = (i + 1) * 8 + k, b1 = (i + 1) * 8 + k2;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 마구리 (별도 정점 — 각진 모서리)
    var cap = [];
    var F = rings[0], L = rings[R - 1];
    function tri(a, b2, c) { cap.push(a[0], a[1], a[2], b2[0], b2[1], b2[2], c[0], c[1], c[2]); }
    for (k = 1; k < 7; k++) { tri(F[0], F[k + 1], F[k]); tri(L[0], L[k], L[k + 1]); }
    var cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
    cg.computeVertexNormals();
    g = merge([g, cg]);
    return g;
  }

  function cyl(r0, r1, len, seg, axis, cx, cy, cz) {
    var g = new THREE.CylinderGeometry(r0, r1, len, seg || 12);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(cx || 0, cy || 0, cz || 0);
    return g;
  }

  /** 두 점을 잇는 가는 막대 (서스펜션 암) */
  function rod(a, b, r) {
    var va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
    var len = va.distanceTo(vb);
    var g = new THREE.CylinderGeometry(r, r, len, 6);
    var dir = vb.clone().sub(va).normalize();
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    var mid = va.add(vb).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    return g;
  }

  /** 얇은 날개 단면 (x 시위, y 스팬, 받음각 aoa) */
  function wing(cx, cz, chord, span, thick, aoa, cy) {
    var g = new THREE.BoxGeometry(chord, span, thick);
    g.rotateY(aoa);
    g.translate(cx, cy || 0, cz);
    return g;
  }

  /* ------------------------------------------------------------------ *
   *  차량 모델 (geometry 는 전 팀 공유, material 만 팀별)
   *  로컬 좌표: +X 전방, +Y 왼쪽, +Z 위.  원점 = 차량 중심 지면.
   * ------------------------------------------------------------------ */
  var CAR_GEO = null;
  var WHEEL = { fr: 0.36, rr: 0.36, fw: 0.30, rw: 0.40, fx: 1.72, rx: -1.86, fy: 0.80, ry: 0.78 };

  function buildCarGeometry() {
    if (CAR_GEO) return CAR_GEO;
    var paint = [], accent = [], carbon = [], black = [], gloss = [];

    // --- 모노코크 + 노즈 (하나의 로프트)
    paint.push(loft([
      [2.62, 0.06, 0.20, 0.28],
      [2.20, 0.13, 0.17, 0.40],
      [1.40, 0.22, 0.17, 0.56],
      [0.55, 0.32, 0.12, 0.66],
      [0.05, 0.38, 0.10, 0.70],
      [-0.55, 0.40, 0.08, 0.66]
    ], 0.35));
    // 사이드팟 (언더컷이 깊은 2026 스타일)
    for (var s = -1; s <= 1; s += 2) {
      paint.push(loft([
        [0.42, 0.04, 0.30, 0.56, s * 0.48],
        [0.18, 0.20, 0.22, 0.60, s * 0.56],
        [-0.40, 0.22, 0.12, 0.58, s * 0.55],
        [-1.20, 0.16, 0.10, 0.46, s * 0.46],
        [-1.80, 0.06, 0.12, 0.32, s * 0.30]
      ], 0.45));
      // 사이드팟 인렛 (검은 입구)
      black.push(boxG(0.44, s * 0.58, 0.44, 0.04, 0.30, 0.20));
      // 사이드 임팩트 + 미러
      carbon.push(boxG(0.30, s * 0.70, 0.62, 0.16, 0.26, 0.03));
      carbon.push(rod([0.25, s * 0.36, 0.66], [0.32, s * 0.62, 0.80], 0.012));
      gloss.push(boxG(0.32, s * 0.66, 0.82, 0.05, 0.16, 0.08));
    }
    // 엔진 커버 + 샤크핀
    paint.push(loft([
      [-0.45, 0.30, 0.50, 0.92],
      [-0.95, 0.24, 0.40, 0.88],
      [-1.60, 0.14, 0.30, 0.66],
      [-2.20, 0.06, 0.26, 0.42]
    ], 0.4));
    accent.push(loft([
      [-0.70, 0.012, 0.88, 0.96],
      [-1.30, 0.012, 0.66, 1.00],
      [-1.95, 0.012, 0.46, 0.96]
    ], 0));
    // 에어박스 (롤후프)
    black.push(loft([
      [-0.30, 0.10, 0.88, 1.02],
      [-0.48, 0.14, 0.86, 1.04]
    ], 0.4));
    // 콕핏 개구부 + 헤드레스트
    black.push(loft([[0.40, 0.25, 0.64, 0.665], [-0.40, 0.26, 0.64, 0.665]], 0.3));
    carbon.push(boxG(-0.30, 0, 0.72, 0.18, 0.46, 0.14));

    // --- 바닥 (플로어) + 플랭크 + 디퓨저
    carbon.push(loft([
      [1.10, 0.36, 0.05, 0.08],
      [0.40, 0.78, 0.04, 0.08],
      [-1.40, 0.80, 0.04, 0.08],
      [-2.30, 0.52, 0.06, 0.10]
    ], 0.1));
    black.push(boxG(-0.4, 0, 0.025, 2.6, 0.30, 0.03));          // 스키드 블록
    for (var d = -2; d <= 2; d++) {
      carbon.push(boxG(-2.40, d * 0.17, 0.18, 0.42, 0.02, 0.20, 0, -0.30, 0));
    }
    carbon.push(boxG(-2.40, 0, 0.26, 0.46, 1.04, 0.02, 0, -0.32, 0));

    // --- 프론트 윙 (3엘리먼트 + 엔드플레이트 + 파일런)
    carbon.push(wing(2.42, 0.10, 0.36, 1.92, 0.025, -0.04));
    accent.push(wing(2.20, 0.17, 0.22, 1.86, 0.02, -0.28));
    accent.push(wing(2.06, 0.25, 0.16, 1.74, 0.02, -0.55));
    for (s = -1; s <= 1; s += 2) {
      paint.push(boxG(2.30, s * 0.97, 0.18, 0.58, 0.025, 0.30));
      carbon.push(rod([2.30, s * 0.05, 0.22], [2.30, s * 0.05, 0.10], 0.03));
    }

    // --- 리어 윙 (메인 플레인 + 엔드플레이트 + 빔윙 + 스완넥). 플랩은 별도(가동)
    accent.push(wing(-2.48, 0.92, 0.34, 1.02, 0.03, 0.12));
    carbon.push(wing(-2.36, 0.40, 0.24, 0.92, 0.025, 0.25));         // 빔윙
    for (s = -1; s <= 1; s += 2) {
      paint.push(boxG(-2.46, s * 0.53, 0.82, 0.62, 0.025, 0.56));
      carbon.push(rod([-2.30, s * 0.06, 0.40], [-2.42, s * 0.06, 0.92], 0.02));
    }
    // 우천 / 회생 후미등 하우징
    black.push(boxG(-2.66, 0, 0.30, 0.04, 0.16, 0.10));

    // --- 헤일로 (튜브)
    var halo = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.62, 0, 0.66),
      new THREE.Vector3(0.48, 0, 0.88),
      new THREE.Vector3(0.20, 0.20, 0.96),
      new THREE.Vector3(-0.22, 0.27, 0.92),
      new THREE.Vector3(-0.42, 0.24, 0.82)
    ]);
    var halo2 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.48, 0, 0.88),
      new THREE.Vector3(0.20, -0.20, 0.96),
      new THREE.Vector3(-0.22, -0.27, 0.92),
      new THREE.Vector3(-0.42, -0.24, 0.82)
    ]);
    carbon.push(new THREE.TubeGeometry(halo, 20, 0.032, 8, false));
    carbon.push(new THREE.TubeGeometry(halo2, 16, 0.032, 8, false));

    // --- 서스펜션 암 (차체 → 휠 허브)
    var arms = [
      [[0.90, 0.20, 0.42], [WHEEL.fx, 0.66, 0.42]], [[1.55, 0.18, 0.40], [WHEEL.fx, 0.66, 0.42]],
      [[0.90, 0.20, 0.24], [WHEEL.fx, 0.66, 0.24]], [[1.55, 0.16, 0.22], [WHEEL.fx, 0.66, 0.24]],
      [[1.10, 0.22, 0.30], [WHEEL.fx + 0.05, 0.66, 0.34]],
      [[-1.40, 0.28, 0.42], [WHEEL.rx, 0.60, 0.44]], [[-2.10, 0.20, 0.42], [WHEEL.rx, 0.60, 0.44]],
      [[-1.40, 0.30, 0.20], [WHEEL.rx, 0.60, 0.24]], [[-2.10, 0.22, 0.20], [WHEEL.rx, 0.60, 0.24]]
    ];
    for (var a = 0; a < arms.length; a++) {
      var A = arms[a][0], B = arms[a][1];
      carbon.push(rod(A, B, 0.018));
      carbon.push(rod([A[0], -A[1], A[2]], [B[0], -B[1], B[2]], 0.018));
    }

    // --- 리어 플랩 (가동 — 피벗을 원점에)
    var flap = wing(-0.10, 0, 0.22, 1.02, 0.025, 0.55);
    // --- 드라이버 헬멧
    var helmet = new THREE.SphereGeometry(0.135, 18, 14);
    helmet.scale(1.08, 1, 1);
    helmet.translate(-0.05, 0, 0.80);
    var visor = new THREE.SphereGeometry(0.137, 14, 8, -0.9, 1.8, 1.15, 0.5);
    visor.rotateZ(0);
    visor.scale(1.08, 1, 1);
    visor.translate(-0.05, 0, 0.80);
    // --- 후미등
    var light = boxG(-2.685, 0, 0.30, 0.01, 0.13, 0.07);
    // --- 넘버 데칼 (노즈 위 평면)
    var num = new THREE.PlaneGeometry(0.26, 0.26);
    var tcam = boxG(-0.40, 0, 1.07, 0.10, 0.10, 0.05);

    CAR_GEO = {
      paint: merge(paint), accent: merge(accent), carbon: merge(carbon),
      black: merge(black), gloss: merge(gloss),
      flap: flap, helmet: helmet, visor: visor, light: light, num: num, tcam: tcam,
      shadow: (function () { var g = new THREE.PlaneGeometry(5.6, 2.3); g.translate(-0.2, 0, 0.055); return g; })()
    };
    // 휠: 트레드 + 사이드월(캡) 재질 그룹
    CAR_GEO.wheelF = new THREE.CylinderGeometry(WHEEL.fr, WHEEL.fr, WHEEL.fw, 28, 1);
    CAR_GEO.wheelR = new THREE.CylinderGeometry(WHEEL.rr, WHEEL.rr, WHEEL.rw, 28, 1);
    return CAR_GEO;
  }

  function teamMaterials(team, envMap) {
    var base = new THREE.Color(team.color), acc = new THREE.Color(team.accent);
    var T = textures();
    return {
      paint: new THREE.MeshPhysicalMaterial({ color: base, metalness: 0.1, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06, envMap: envMap, envMapIntensity: 0.55 }),
      accent: new THREE.MeshPhysicalMaterial({ color: acc, metalness: 0.1, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap: envMap, envMapIntensity: 0.55 }),
      carbon: new THREE.MeshStandardMaterial({ color: 0x9a9a9a, map: T.carbon, metalness: 0.25, roughness: 0.42, envMap: envMap, envMapIntensity: 0.7 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0e0e10, metalness: 0.1, roughness: 0.65 }),
      gloss: new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.9, roughness: 0.12, envMap: envMap }),
      helmet: new THREE.MeshPhysicalMaterial({ color: acc.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.2, clearcoat: 1, envMap: envMap }),
      visor: new THREE.MeshStandardMaterial({ color: 0x0c0d12, metalness: 1, roughness: 0.05, envMap: envMap }),
      tread: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.92 })
    };
  }

  function buildCar(car, envMap, matCache) {
    var G = buildCarGeometry();
    var key = car.team.id;
    var M = matCache[key] || (matCache[key] = teamMaterials(car.team, envMap));
    var root = new THREE.Group();
    var body = new THREE.Group();          // 피치/롤 적용 부분
    root.add(body);
    function mesh(g, m, cast) {
      var o = new THREE.Mesh(g, m);
      o.castShadow = cast !== false;
      o.receiveShadow = false;
      body.add(o);
      return o;
    }
    mesh(G.paint, M.paint); mesh(G.accent, M.accent); mesh(G.carbon, M.carbon);
    mesh(G.black, M.black); mesh(G.gloss, M.gloss, false);
    mesh(G.helmet, M.helmet); mesh(G.visor, M.visor, false);
    var tcamMat = new THREE.MeshStandardMaterial({ color: car.driver.num % 2 ? 0xf5d000 : 0x111111, roughness: 0.5 });
    mesh(G.tcam, tcamMat);

    // 넘버 데칼
    var numMat = new THREE.MeshBasicMaterial({
      map: numberTex(car.driver.num, '#ffffff', null), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false
    });
    var numMesh = new THREE.Mesh(G.num, numMat);
    numMesh.rotation.set(0, 0.2, Math.PI / 2, 'YXZ');
    numMesh.position.set(1.72, 0, 0.505);
    body.add(numMesh);

    // 가동 리어 플랩
    var flapPivot = new THREE.Group();
    flapPivot.position.set(-2.42, 0, 1.03);
    var flap = new THREE.Mesh(G.flap, M.accent);
    flap.castShadow = true;
    flapPivot.add(flap);
    body.add(flapPivot);

    // 후미등
    var lightMat = new THREE.MeshBasicMaterial({ color: 0x330000, toneMapped: false });
    var light = new THREE.Mesh(G.light, lightMat);
    body.add(light);

    // 바퀴
    var side = new THREE.MeshStandardMaterial({ map: sidewallTex(car.tyre.color), roughness: 0.8 });
    var wheels = [];
    var defs = [
      [WHEEL.fx, WHEEL.fy, WHEEL.fr, G.wheelF, true], [WHEEL.fx, -WHEEL.fy, WHEEL.fr, G.wheelF, true],
      [WHEEL.rx, WHEEL.ry + 0.04, WHEEL.rr, G.wheelR, false], [WHEEL.rx, -WHEEL.ry - 0.04, WHEEL.rr, G.wheelR, false]
    ];
    for (var i = 0; i < defs.length; i++) {
      var steerG = new THREE.Group();
      steerG.position.set(defs[i][0], defs[i][1], defs[i][2]);
      var spin = new THREE.Mesh(defs[i][3], [M.tread, side, side]);
      spin.castShadow = true;
      steerG.add(spin);
      root.add(steerG);
      wheels.push({ steer: steerG, spin: spin, front: defs[i][4] });
    }

    // 접지 그림자 (부드러운 AO 블롭)
    var shMat = new THREE.MeshBasicMaterial({ map: textures().puff, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    var sh = new THREE.Mesh(G.shadow, shMat);
    sh.renderOrder = 1;
    root.add(sh);

    root.userData = {
      body: body, wheels: wheels, flap: flapPivot, light: lightMat, sideMat: side,
      tyreColor: car.tyre.color, roll: 0, pitch: 0, spinAng: 0, lastSpeed: 0
    };
    return root;
  }

  /* ------------------------------------------------------------------ *
   *  파티클 셰이더 (사이즈·알파·색을 버텍스마다)
   * ------------------------------------------------------------------ */
  function particleMaterial(additive) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: textures().puff }, scale: { value: 600 } },
      vertexShader: [
        'attribute float size; attribute float alpha; attribute vec3 tint;',
        'varying float vA; varying vec3 vC; uniform float scale;',
        'void main(){ vA = alpha; vC = tint;',
        '  vec4 mv = modelViewMatrix * vec4(position,1.0);',
        '  gl_PointSize = size * scale / max(0.5, -mv.z);',
        '  gl_Position = projectionMatrix * mv; }'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D map; varying float vA; varying vec3 vC;',
        'void main(){ vec4 t = texture2D(map, gl_PointCoord);',
        '  gl_FragColor = vec4(vC, t.a * vA); }'
      ].join('\n'),
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
  }

  /* ------------------------------------------------------------------ *
   *  Renderer
   * ------------------------------------------------------------------ */
  function Renderer3D(canvas) {
    this.canvas = canvas;
    // 2D 오버레이 (미니맵, 드라이버 태그)
    var ov = document.getElementById('overlay');
    if (!ov) {
      ov = document.createElement('canvas');
      ov.id = 'overlay';
      canvas.parentNode.insertBefore(ov, canvas.nextSibling);
    }
    this.overlay = ov;
    this.ctx = ov.getContext('2d');

    this.gl = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.2, 6000);
    this.camera.up.set(0, 0, 1);

    this.showLine = false;
    this.camMode = 0;
    this.particles = [];
    this.cam = { shake: 0 };
    this.pose = null;
    this.w = 800; this.h = 600; this.dpr = 1;
    this.scene = null;
    this.carObjs = {};
  }

  Renderer3D.prototype.resize = function (w, h, dpr) {
    var pr = Math.min(dpr, 2);
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, true);
    this.overlay.width = Math.floor(w * dpr);
    this.overlay.height = Math.floor(h * dpr);
    this.overlay.style.width = w + 'px';
    this.overlay.style.height = h + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  Renderer3D.prototype.cameraLabel = function () { return CAMS[this.camMode].label; };
  Renderer3D.prototype.cycleCamera = function () {
    this.camMode = (this.camMode + 1) % CAMS.length;
    this.snap = true;
    return CAMS[this.camMode].label;
  };

  function V(x, y, z) { return new THREE.Vector3(x, -y, z); }

  /* ---- 리본 메시: 센터라인 인덱스 i 마다 off(i) → 두 개의 측면 오프셋 ---- */
  function ribbon(track, opt) {
    var n = track.n, pos = [], uv = [], col = [], idx = [];
    var lanes = opt.lanes || 1;
    var include = opt.include || function () { return true; };
    var vi = 0, prevOk = false, i;
    var count = opt.closed === false ? n : n + 1;
    for (var k = 0; k < count; k++) {
      i = k % n;
      var ok = include(i);
      if (!ok) { prevOk = false; continue; }
      var p = track.pts[i], N = track.N[i];
      var o0 = opt.off0(i), o1 = opt.off1(i);
      for (var l = 0; l <= lanes; l++) {
        var t = l / lanes, o = o0 + (o1 - o0) * t;
        var z = opt.z ? opt.z(i, t) : 0;
        pos.push(p[0] + N[0] * o, -(p[1] + N[1] * o), z);
        uv.push(opt.uScale ? o * opt.uScale : t, (k >= n ? track.length : track.S[i]) * (opt.vScale || 0.1));
        if (opt.color) { var c = opt.color(i, t, k); col.push(c[0], c[1], c[2]); }
      }
      if (prevOk) {
        var a = vi - (lanes + 1), b = vi;
        for (l = 0; l < lanes; l++) {
          idx.push(a + l, b + l, a + l + 1, a + l + 1, b + l, b + l + 1);
        }
      }
      vi += lanes + 1;
      prevOk = true;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (opt.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 평면 리본은 법선을 위로 고정 (부호 무관 — DoubleSide 에서 면 방향으로 맞춰진다)
    if (opt.flat !== false) {
      var nr = g.attributes.normal.array;
      for (i = 0; i < nr.length; i += 3) {
        var sgn = nr[i + 2] >= 0 ? 1 : -1;
        nr[i] = 0; nr[i + 1] = 0; nr[i + 2] = sgn;
      }
    }
    return g;
  }

  /** 수직 벽 리본 (오프셋 off, 높이 z0~z1) */
  function wallRibbon(track, off, z0, z1, include, uLen) {
    var n = track.n, pos = [], uv = [], idx = [], vi = 0, prevOk = false;
    for (var k = 0; k <= n; k++) {
      var i = k % n;
      if (include && !include(i)) { prevOk = false; continue; }
      var p = track.pts[i], N = track.N[i];
      var o = typeof off === 'function' ? off(i) : off;
      var x = p[0] + N[0] * o, y = -(p[1] + N[1] * o);
      var u = (k >= n ? track.length : track.S[i] - track.S[0]) / (uLen || 32);
      pos.push(x, y, z0, x, y, z1);
      uv.push(u, 0, u, 1);
      if (prevOk) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
      vi += 2; prevOk = true;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ------------------------------------------------------------------ *
   *  씬 구성 (트랙당 1회)
   * ------------------------------------------------------------------ */
  Renderer3D.prototype.prepare = function (race) {
    this.disposeScene();
    var track = race.track, spec = race.spec, n = track.n;
    var E = environment(spec);
    var T = textures();
    var scene = new THREE.Scene();
    this.scene = scene;
    this.env = E;
    this.gl.toneMappingExposure = E.exposure;

    // --- 하늘 돔 --------------------------------------------------------
    var sunDir = new THREE.Vector3(E.sunDir[0], E.sunDir[1], E.sunDir[2]).normalize();
    var skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(E.skyTop) }, hor: { value: new THREE.Color(E.skyHor) },
        sun: { value: sunDir }, sunCol: { value: new THREE.Color(E.sunCol) },
        night: { value: E.night ? 1 : 0 }, cloud: { value: E.cloud || 0 }
      },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunCol; uniform float night; varying vec3 vD;',
        'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
        'float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);',
        '  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }',
        'float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }',
        'uniform float cloud;',
        'void main(){ float e = clamp(vD.z, -0.2, 1.0);',
        '  vec3 c = mix(hor, top, pow(max(e,0.0), 0.55));',
        '  if (e < 0.0) c = mix(hor, hor*0.6, clamp(-e*5.0,0.0,1.0));',
        '  float sd = max(dot(normalize(vD), sun), 0.0);',
        '  c += sunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.35) * (1.0 - night*0.85);',
        '  if (e > 0.0 && cloud > 0.0) { vec2 cp = vD.xy / (e + 0.08) * 1.6; float cl = smoothstep(0.52 - cloud*0.25, 0.85, fbm(cp));',
        '    cl *= smoothstep(0.0, 0.12, e); c = mix(c, mix(hor, vec3(1.0), 0.75) * (1.0 - night*0.8), cl * 0.85 * min(1.0, cloud * 1.6)); }',
        '  if (night > 0.5) { vec2 g = floor(vD.xy / max(0.2, vD.z+0.25) * 340.0); float s = step(0.9975, h(g)) * smoothstep(0.05, 0.4, e); c += vec3(s); }',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n'),
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    this.sky = sky;

    // 환경맵 (차체 반사)
    var pm = new THREE.PMREMGenerator(this.gl);
    var envScene = new THREE.Scene();
    var envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat.clone());
        envScene.add(envSky);
    var envGround = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: E.ground }));
    envGround.position.z = -2;
    envScene.add(envGround);
    this.envMap = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    scene.environment = null;

    scene.fog = new THREE.Fog(E.fog, E.fogNear, E.fogFar);

    // --- 조명 -------------------------------------------------------------
    var hemi = new THREE.HemisphereLight(E.hemiSky, E.hemiGround, E.hemiI);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(E.sunCol, E.sunI);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this.sunDir = sunDir;

    // --- 지면 -------------------------------------------------------------
    var b = track.bounds, cxm = (b.minX + b.maxX) / 2, cym = (b.minY + b.maxY) / 2;
    var span = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 3000;
    var gTex = T[E.groundTex].clone(); gTex.needsUpdate = true;
    gTex.repeat.set(span / 24, span / 24);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({ color: E.ground, map: gTex, roughness: 1 }));
    ground.position.set(cxm, -cym, -0.08);
    ground.receiveShadow = true;
    scene.add(ground);

    // 원경 산 / 언덕 (링)
    this.addHills(scene, cxm, -cym, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.5 + 700, E);

    var half = track.half;
    var st = { half: half, barrier: track.barrier };
    this.st = st;

    // 연석 위치
    var kerb = new Uint8Array(n), kerbSide = new Int8Array(n);
    for (var i = 0; i < n; i++) {
      var K = track.K[i];
      if (Math.abs(K) > 0.0040) { kerb[i] = 1; kerbSide[i] = Math.abs(K) > 0.010 ? 2 : (K > 0 ? 1 : -1); }
    }
    // 연석 구간 확장 (진입/탈출을 조금 더 길게)
    var kerb2 = new Uint8Array(n);
    for (i = 0; i < n; i++) if (kerb[i]) for (var d = -3; d <= 3; d++) kerb2[(i + d + n) % n] = 1;
    for (i = 0; i < n; i++) if (kerb2[i] && !kerb[i]) {
      var nb = kerb[(i + 1) % n] ? (i + 1) % n : (kerb[(i + n - 1) % n] ? (i + n - 1) % n : -1);
      for (d = 1; d <= 3 && nb < 0; d++) {
        if (kerb[(i + d) % n]) nb = (i + d) % n; else if (kerb[(i - d + n) % n]) nb = (i - d + n) % n;
      }
      kerbSide[i] = nb >= 0 ? kerbSide[nb] : 1;
    }
    kerb = kerb2;
    st.kerb = kerb;

    var roadCol = new THREE.Color(E.road);
    var DS = THREE.DoubleSide;

    // --- 런오프 (아스팔트 띠 → 그래블) --------------------------------------
    var runW = Math.min(spec.runoff, 13);
    var runMat = new THREE.MeshStandardMaterial({ color: E.runoff, map: T.asphalt, roughness: 0.9, side: DS, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    // 연석 바깥 페인트 띠 (서킷별 색)
    var paintCol = spec.scenery === 'street' ? 0x9a1f1f : (spec.timeOfDay === 'night' ? 0x1f5fae : 0x2f8a4a);
    var paintMat = new THREE.MeshStandardMaterial({ color: paintCol, map: T.asphalt, roughness: 0.7, side: DS });
    for (var ps2 = -1; ps2 <= 1; ps2 += 2) {
      (function (s) {
        var g = ribbon(track, {
          off0: function () { return s * (half + 1.55); },
          off1: function () { return s * (half + Math.min(runW, 4.5)); },
          include: function (i) { return kerb[i] && (kerbSide[i] === 2 || kerbSide[i] === s); },
          uScale: 0.12, vScale: 0.12
        });
        var m = new THREE.Mesh(g, paintMat);
        m.position.z = 0.012;
        m.receiveShadow = true;
        scene.add(m);
      })(ps2);
    }
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      (function (s) {
        var g = ribbon(track, {
          off0: function () { return s * (half - 0.2); },
          off1: function () { return s * (half + runW); },
          z: function () { return 0.0; }, uScale: 0.12, vScale: 0.12
        });
        var m = new THREE.Mesh(g, runMat);
        m.receiveShadow = true;
        scene.add(m);
      })(sgn);
    }
    // 바깥 그래블 / 잔디 경계 (상설 서킷)
    if (spec.scenery !== 'street') {
      var gravMat = new THREE.MeshStandardMaterial({ color: 0xc8b89a, map: T.gravel, roughness: 1, side: DS });
      for (sgn = -1; sgn <= 1; sgn += 2) {
        (function (s) {
          var g = ribbon(track, {
            off0: function () { return s * (half + runW); },
            off1: function () { return s * (track.barrier - 0.4); },
            include: function (i) { return kerb[i] && (kerbSide[i] === 2 || kerbSide[i] === -s); },
            z: function () { return 0.005; }, uScale: 0.25, vScale: 0.25
          });
          var m = new THREE.Mesh(g, gravMat);
          m.receiveShadow = true;
          scene.add(m);
        })(sgn);
      }
    }

    // --- 노면 (러버 라인 버텍스 컬러) --------------------------------------
    var lanes = 12;
    var roadGeo = ribbon(track, {
      off0: function () { return half; }, off1: function () { return -half; },
      lanes: lanes, uScale: 0.09, vScale: 0.09,
      color: function (i, t) {
        var o = half - 2 * half * t;
        var dl = Math.abs(o - track.lat[i]);
        var rub = Math.max(0, 1 - dl / 2.6);
        var f = 1 - rub * 0.32;
        // 출발 그리드 부근 진한 고무 자국
        return [f, f, f * 1.01];
      }
    });
    var roadMat = new THREE.MeshStandardMaterial({
      color: roadCol, map: T.asphalt, roughnessMap: T.asphaltRough, roughness: 0.82, metalness: 0.0,
      vertexColors: true, side: DS, envMap: this.envMap, envMapIntensity: E.night ? 0.6 : 0.3
    });
    var road = new THREE.Mesh(roadGeo, roadMat);
    road.position.z = 0.02;
    road.receiveShadow = true;
    scene.add(road);

    // --- 흰 트랙 경계선 ---------------------------------------------------
    var lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, side: DS });
    for (sgn = -1; sgn <= 1; sgn += 2) {
      (function (s) {
        var g = ribbon(track, { off0: function () { return s * (half - 0.38); }, off1: function () { return s * (half - 0.05); } });
        var m = new THREE.Mesh(g, lineMat);
        m.position.z = 0.04;
        m.receiveShadow = true;
        scene.add(m);
      })(sgn);
    }

    // --- 연석 (톱니 모양 프로파일, 빨강/흰 교차) ------------------------------
    var kerbTex = canvasTex(8, 64, function (g, w, h) {
      g.fillStyle = '#d2262a'; g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#' + new THREE.Color(E.kerbB).getHexString(); g.fillRect(0, h / 2, w, h / 2);
    });
    kerbTex.magFilter = THREE.NearestFilter;
    var kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.55, side: DS });
    for (sgn = -1; sgn <= 1; sgn += 2) {
      (function (s) {
        var g = ribbon(track, {
          off0: function () { return s * (half - 0.05); },
          off1: function () { return s * (half + 1.6); },
          lanes: 3, flat: false,
          include: function (i) { return kerb[i] && (kerbSide[i] === 2 || kerbSide[i] === s); },
          z: function (i, t) { return 0.035 + (t > 0.05 && t < 0.95 ? 0.07 : 0.0) - t * 0.02; },
          vScale: 0.5
        });
        var m = new THREE.Mesh(g, kerbMat);
        m.receiveShadow = true;
        scene.add(m);
        // 소시지 연석 (헤어핀 안쪽)
      })(sgn);
    }

    // --- 배리어 (광고 월 / 테크프로) + 캐치펜스 --------------------------------
    var bar = track.barrier;
    var pit = track.pit;
    var street = spec.scenery === 'street';
    var barTex = (street ? T.tecpro : T.barrier).clone();
    barTex.needsUpdate = true;
    var wallMat = new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.55, side: DS });
    var wallTop = new THREE.MeshStandardMaterial({ color: 0x9da2aa, roughness: 0.7, side: DS });
    var fenceTex = T.fence.clone(); fenceTex.needsUpdate = true;
    fenceTex.repeat.set(1, 1);
    var fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.25, side: DS, roughness: 0.4, metalness: 0.6, color: 0xcfd4da });
    for (sgn = -1; sgn <= 1; sgn += 2) {
      (function (s, self) {
        var g = wallRibbon(track, s * bar, 0, 1.1, null, street ? 6 : 34);
        // 오른쪽 벽은 원근상 진행 방향이 화면 왼쪽으로 가므로 u 를 뒤집어야 글씨가 바로 읽힌다
        if (s > 0) { var ua = g.attributes.uv.array; for (var uq = 0; uq < ua.length; uq += 2) ua[uq] = -ua[uq]; }
        var m = new THREE.Mesh(g, wallMat);
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m);
        var top = ribbon(track, { off0: function () { return s * bar; }, off1: function () { return s * (bar + 0.5); } });
        var tm = new THREE.Mesh(top, wallTop);
        tm.position.z = 1.1;
        scene.add(tm);
        var fg = wallRibbon(track, s * (bar + 0.25), 1.1, 4.2, null, 0.6);
        // 펜스 UV: 세로 반복
        var uvA = fg.attributes.uv.array;
        for (var q = 1; q < uvA.length; q += 2) uvA[q] *= 5;
        var fm = new THREE.Mesh(fg, fenceMat);
        scene.add(fm);
      })(sgn, this);
    }
    // 펜스 기둥 (인스턴싱)
    var postGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.3, 6);
    postGeo.rotateX(Math.PI / 2); postGeo.translate(0, 0, 2.65);
    var postMat = new THREE.MeshStandardMaterial({ color: 0x8c9198, metalness: 0.6, roughness: 0.4 });
    var postCount = Math.ceil(n / 3) * 2;
    var posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    var mtx = new THREE.Matrix4(), pi = 0;
    for (i = 0; i < n; i += 3) {
      for (sgn = -1; sgn <= 1; sgn += 2) {
        var pp = track.pts[i], NN = track.N[i];
        mtx.makeTranslation(pp[0] + NN[0] * sgn * (bar + 0.3), -(pp[1] + NN[1] * sgn * (bar + 0.3)), 0);
        posts.setMatrixAt(pi++, mtx);
      }
    }
    posts.count = pi;
    scene.add(posts);

    // --- 피트레인 ----------------------------------------------------------
    this.buildPit(scene, race, E, T);

    // --- 출발선 / 그리드 / 갠트리 ---------------------------------------------
    this.buildStart(scene, race, E, T);

    // --- DRS / 섹터 보드 -------------------------------------------------------
    this.buildGates(scene, race);

    // --- 트랙사이드 오브젝트 ------------------------------------------------
    this.buildProps(scene, race, E, T);

    // --- 주행 라인 가이드 ---------------------------------------------------
    var lineCol = [];
    var guideGeo = ribbon(track, {
      off0: function (i) { return track.lat[i] + 0.22; }, off1: function (i) { return track.lat[i] - 0.22; },
      color: function (i) {
        // 브레이킹 존은 빨강, 그 외 파랑 — 곡률 변화로 근사
        var ahead = Math.abs(track.raceK ? track.raceK[(i + 12) % n] : track.K[(i + 12) % n]);
        var now = Math.abs(track.raceK ? track.raceK[i] : track.K[i]);
        if (ahead > 0.008 && ahead > now * 1.5) return [1, 0.15, 0.1];
        if (now > 0.008) return [1, 0.75, 0.1];
        return [0.1, 0.85, 0.35];
      }
    });
    var guide = new THREE.Mesh(guideGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: DS }));
    guide.position.z = 0.05;
    guide.visible = this.showLine;
    scene.add(guide);
    this.guide = guide;

    // --- 차량 ---------------------------------------------------------------
    this.carObjs = {};
    this.matCache = {};
    for (i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      var obj = buildCar(car, this.envMap, this.matCache);
      scene.add(obj);
      this.carObjs[car.id] = obj;
    }

    // --- 파티클 -------------------------------------------------------------
    this.ptMax = 600;
    this.pts = this.makePoints(false);
    this.sparks = this.makePoints(true);
    scene.add(this.pts.obj);
    scene.add(this.sparks.obj);
    this.sparkList = [];
    this.particles.length = 0;

    this.pose = null;
  };

  Renderer3D.prototype.makePoints = function (additive) {
    var max = this.ptMax;
    var g = new THREE.BufferGeometry();
    var pos = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max), tint = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    var mat = particleMaterial(additive);
    if (additive) mat.uniforms.map.value = textures().glow;
    var obj = new THREE.Points(g, mat);
    obj.frustumCulled = false;
    obj.renderOrder = 5;
    return { obj: obj, geo: g, pos: pos, size: size, alpha: alpha, tint: tint, mat: mat };
  };

  Renderer3D.prototype.addHills = function (scene, cx, cy, R, E) {
    var seg = 96, pos = [], idx = [];
    var r = rng(77);
    var hts = [];
    for (var i = 0; i <= seg; i++) hts.push(i === seg ? hts[0] : 40 + r() * 140 + Math.sin(i * 0.35) * 40);
    for (i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2;
      var x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      var h = E.night ? hts[i] * 0.4 : hts[i];
      pos.push(x, y, -5, x * 1.0 + Math.cos(a) * 60, y + Math.sin(a) * 60, h);
      if (i < seg) { var k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    var m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: E.hills, roughness: 1, side: THREE.DoubleSide }));
    scene.add(m);
  };

  /* ---- 피트레인 / 피트 빌딩 ------------------------------------------- */
  Renderer3D.prototype.buildPit = function (scene, race, E, T) {
    var track = race.track, pit = track.pit, m = pit.pts.length;
    if (m < 2) return;
    var DS = THREE.DoubleSide;
    var hw = pit.width / 2, psd = pit.side, half = track.half;
    function P(i, off) {
      var p = pit.pts[i], N = track.N[pit.idx[i]];
      return [p[0] + N[0] * off, -(p[1] + N[1] * off)];
    }
    function strip(o0, o1, z, mat, every) {
      var pos = [], idx = [], uv = [], vi = 0;
      for (var i = 0; i < m; i++) {
        var a = P(i, o0), b = P(i, o1);
        pos.push(a[0], a[1], z, b[0], b[1], z);
        uv.push(0, i * 0.4, 1, i * 0.4);
        if (i > 0 && (!every || every(i))) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
        vi += 2;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      var me = new THREE.Mesh(g, mat);
      me.receiveShadow = true;
      scene.add(me);
      return me;
    }
    var pitRoad = new THREE.MeshStandardMaterial({ color: new THREE.Color(E.road).multiplyScalar(0.9), map: T.asphalt, roughness: 0.85, side: DS });
    strip(hw, -hw, 0.009, pitRoad);
    var white = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, side: DS });
    strip(hw, hw - 0.25, 0.02, white);
    strip(-hw, -hw + 0.25, 0.02, white);
    // 패스트 레인 / 워킹 레인 구분선 (점선)
    strip(psd * 0.6, psd * 0.85, 0.02, white, function (i) { return i % 3 !== 0; });

    // 피트 월 (본선 쪽) — 물리 벽 위치와 동일
    var wallMat = new THREE.MeshStandardMaterial({ map: T.tecpro, roughness: 0.6, side: DS });
    var pos = [], uv = [], idx = [], vi = 0, prev = false;
    for (var i = 0; i < m; i++) {
      var inner = pit.off[i] - psd * (pit.width / 2);
      if (Math.abs(inner) <= half + 1.0) { prev = false; continue; }
      var w1 = inner - psd * 1.1;
      var s1 = pit.idx[i], c1 = track.pts[s1], n1 = track.N[s1];
      var x = c1[0] + n1[0] * w1, y = -(c1[1] + n1[1] * w1);
      pos.push(x, y, 0, x, y, 1.15);
      uv.push(i * 0.3, 0, i * 0.3, 1);
      if (prev) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
      vi += 2; prev = true;
    }
    if (vi) {
      var wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      wg.setIndex(idx); wg.computeVertexNormals();
      var wm = new THREE.Mesh(wg, wallMat); wm.castShadow = true; wm.receiveShadow = true;
      scene.add(wm);
    }

    // 팀 가라지 + 피트 박스
    var teams = global.F1DATA.TEAMS;
    var garageGeo = new THREE.BoxGeometry(1, 1, 1);
    for (var t = 0; t < pit.boxIdx.length && t < teams.length; t++) {
      var bi = pit.boxIdx[t];
      var p = pit.pts[bi], src = pit.idx[bi], N = track.N[src], Tt = track.T[src];
      var col = new THREE.Color(teams[t].color);
      var hdg = Math.atan2(-Tt[1], Tt[0]);
      // 박스 페인트
      var boxPaint = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 3.6), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -1 }));
      var o0 = psd * (hw - 2.0);
      boxPaint.position.set(p[0] + N[0] * o0, -(p[1] + N[1] * o0), 0.03);
      boxPaint.rotation.z = hdg;
      scene.add(boxPaint);
      // 가라지
      var o1 = psd * (hw + 4.5);
      var gar = new THREE.Mesh(garageGeo, new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.55), roughness: 0.6 }));
      gar.scale.set(7.8, 7, 4.2);
      gar.position.set(p[0] + N[0] * o1, -(p[1] + N[1] * o1), 2.1);
      gar.rotation.z = hdg;
      gar.castShadow = true; gar.receiveShadow = true;
      scene.add(gar);
      // 가라지 입구 (밝은 내부)
      var mg = new THREE.PlaneGeometry(6.8, 3.4); mg.rotateX(Math.PI / 2);
      var mouth = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0xdfe6ee, side: DS }));
      var o2 = psd * (hw + 0.95);
      mouth.position.set(p[0] + N[0] * o2, -(p[1] + N[1] * o2), 1.75);
      mouth.rotation.z = hdg;
      scene.add(mouth);
    }
    // 피트 빌딩 상부 (패덕 클럽)
    var top = [];
    for (i = 0; i < m; i += 2) {
      var tp = pit.pts[i], tn = track.N[pit.idx[i]];
      var ofs = psd * (hw + 4.5);
      top.push(new THREE.Vector3(tp[0] + tn[0] * ofs, -(tp[1] + tn[1] * ofs), 0));
    }
    var bmid = Math.floor(pit.boxIdx.length / 2);
    if (pit.boxIdx.length) {
      var fb = pit.boxIdx[0], lb = pit.boxIdx[pit.boxIdx.length - 1];
      var bA = pit.pts[Math.max(0, fb - 4)], bB = pit.pts[Math.min(m - 1, lb + 4)];
      var midI = pit.boxIdx[bmid];
      var mp = pit.pts[midI], mn = track.N[pit.idx[midI]], mt = track.T[pit.idx[midI]];
      var len = Math.hypot(bB[0] - bA[0], bB[1] - bA[1]) + 10;
      var ofs2 = psd * (hw + 4.5);
      var club = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 5), new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.3, metalness: 0.2, envMap: this.envMap }));
      club.position.set((bA[0] + bB[0]) / 2 + mn[0] * ofs2, -((bA[1] + bB[1]) / 2 + mn[1] * ofs2), 6.7);
      club.rotation.z = Math.atan2(-(bB[1] - bA[1]), bB[0] - bA[0]);
      club.castShadow = true;
      scene.add(club);
      var glass = new THREE.Mesh(new THREE.BoxGeometry(len - 0.4, 9.2, 2.2), new THREE.MeshStandardMaterial({ color: 0x1d2a3a, roughness: 0.05, metalness: 0.9, envMap: this.envMap }));
      glass.position.copy(club.position); glass.position.z = 6.8;
      glass.rotation.z = club.rotation.z;
      scene.add(glass);
    }

    // 플레이어 박스 마커
    var mk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd633, transparent: true, opacity: 0.4, side: DS, depthWrite: false, toneMapped: false }));
    mk.rotation.x = Math.PI / 2;
    mk.visible = false;
    scene.add(mk);
    this.boxMarker = mk;
  };

  /* ---- 출발선 / 그리드 / 출발 신호 갠트리 ---------------------------------- */
  Renderer3D.prototype.buildStart = function (scene, race, E, T) {
    var track = race.track, half = track.half;
    var p = track.pts[0], N = track.N[0], Tt = track.T[0];
    var hdg = Math.atan2(-Tt[1], Tt[0]);
    var chk = new THREE.Mesh(new THREE.PlaneGeometry(1.6, half * 2), new THREE.MeshStandardMaterial({ map: T.checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    chk.position.set(p[0] + Tt[0] * 0.8, -(p[1] + Tt[1] * 0.8), 0.045);
    chk.rotation.z = hdg;
    chk.material.map = T.checker.clone(); chk.material.map.needsUpdate = true;
    chk.material.map.repeat.set(0.5, half * 2.5);
    scene.add(chk);

    // 그리드 박스
    var gmat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    var grid = track.grid || [];
    for (var i = 0; i < grid.length; i++) {
      var gp = grid[i];
      var h = -gp.heading;
      var g = new THREE.Group();
      g.position.set(gp.x, -gp.y, 0.045);
      g.rotation.z = h;
      var front = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.2), gmat);
      front.position.set(2.9, 0, 0);
      g.add(front);
      for (var s = -1; s <= 1; s += 2) {
        var arm = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.2), gmat);
        arm.position.set(2.4, s * 1.0, 0);
        g.add(arm);
      }
      scene.add(g);
    }

    // 출발 신호 갠트리 (5개 라이트 쌍)
    var gan = new THREE.Group();
    var gp0 = track.pts[0];
    gan.position.set(gp0[0] + Tt[0] * 6, -(gp0[1] + Tt[1] * 6), 0);
    gan.rotation.z = hdg;
    var steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
    var span = half + 3;
    for (s = -1; s <= 1; s += 2) {
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 9), steel);
      post.position.set(0, s * span, 4.5);
      post.castShadow = true;
      gan.add(post);
    }
    var beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, span * 2 + 0.6, 1.4), steel);
    beam.position.set(0, 0, 8.4);
    beam.castShadow = true;
    gan.add(beam);
    var board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 2.0), new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5 }));
    board.position.set(-0.4, 0, 7.0);
    gan.add(board);
    this.lightMats = [];
    var lgeo = new THREE.CircleGeometry(0.32, 20);
    for (var k = 0; k < 5; k++) {
      var lm = new THREE.MeshBasicMaterial({ color: 0x220000, toneMapped: false });
      this.lightMats.push(lm);
      for (var row = 0; row < 2; row++) {
        var lamp = new THREE.Mesh(lgeo, lm);
        lamp.position.set(-0.66, (k - 2) * 1.2, 6.55 + row * 0.82);
        lamp.rotation.y = -Math.PI / 2;
        gan.add(lamp);
      }
    }
    scene.add(gan);
  };

  Renderer3D.prototype.buildGates = function (scene, race) {
    var track = race.track, n = track.n, half = track.half;
    var gates = [];
    for (var z = 0; z < track.drs.length; z++) gates.push({ idx: track.drs[z].start, type: 'drs' });
    var steel = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.5, roughness: 0.4 });
    function label(text, bg) {
      return canvasTex(512, 96, function (g, w, h) {
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff'; g.font = 'italic 900 58px "Segoe UI", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 3);
      });
    }
    var drsTex = label('ACTIVE AERO', '#13a050');
    for (var i = 0; i < gates.length; i++) {
      var g = gates[i], p = track.pts[g.idx], Tt = track.T[g.idx];
      var grp = new THREE.Group();
      grp.position.set(p[0], -p[1], 0);
      grp.rotation.z = Math.atan2(-Tt[1], Tt[0]);
      var arm = half + 1.6;
      for (var s = -1; s <= 1; s += 2) {
        var post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 6.4), steel);
        post.position.set(0, s * arm, 3.2);
        post.castShadow = true;
        grp.add(post);
      }
      var beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, arm * 2, 1.3), steel);
      beam.position.set(0, 0, 6.0);
      grp.add(beam);
      for (var f = -1; f <= 1; f += 2) {
        var pg = new THREE.PlaneGeometry(Math.min(arm * 2 - 1, 14), 1.1);
        pg.rotateX(Math.PI / 2); pg.rotateZ(f > 0 ? -Math.PI / 2 : Math.PI / 2);
        var pl = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: drsTex, toneMapped: false }));
        pl.position.set(f * 0.17, 0, 6.0);
        grp.add(pl);
      }
      scene.add(grp);
    }
  };

  /* ---- 트랙사이드 오브젝트 (인스턴싱) ------------------------------------ */
  Renderer3D.prototype.buildProps = function (scene, race, E, T) {
    var track = race.track, spec = race.spec, n = track.n;
    var bar = track.barrier, scen = spec.scenery || 'green';
    var r = rng(spec.id.length * 131 + n);
    var trees = [], palms = [], stands = [], boards = [], buildings = [], tyres = [], towers = [];
    var mapW = track.bounds;
    var pit = track.pit;
    // 피트 쪽 인덱스 (피트 빌딩과 겹치지 않게)
    var pitSide = new Int8Array(n);
    for (var q = 0; q < pit.idx.length; q++) pitSide[pit.idx[q]] = 1;

    for (var i = 0; i < n; i += 6) {
      var p = track.pts[i], N = track.N[i], Tt = track.T[i];
      var corner = Math.abs(track.K[i]) > 0.0055;
      var hdg = Math.atan2(-Tt[1], Tt[0]);
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        if (pitSide[i] && sgn === track.pit.side) continue;
        var roll = r();
        var nearStart = Math.min(track.S[i], track.length - track.S[i]) < 300;
        var d;
        var at = (function (pp, NN, sg) { return function (dd) { return [pp[0] + NN[0] * dd * sg, -(pp[1] + NN[1] * dd * sg)]; }; })(p, N, sgn);
        if (corner && roll < 0.35 && scen !== 'street') {
          d = bar - 1.0; var tp = at(d); tyres.push([tp[0], tp[1], hdg]);
        } else if ((nearStart && roll < 0.55) || (roll < 0.06 && i % 24 === 0)) {
          d = bar + 9; var sp = at(d); stands.push([sp[0], sp[1], hdg, sgn]);
          i += 0;
        } else if (roll < 0.22) {
          d = bar + 1.6; var bp = at(d); boards.push([bp[0], bp[1], hdg, (r() * 8) | 0, sgn]);
        }
        // 원경 오브젝트 (나무 / 야자 / 건물)
        var count = scen === 'street' ? 1 : 2;
        for (var c = 0; c < count; c++) {
          var dd = bar + 14 + r() * (scen === 'street' ? 10 : 70);
          var o = at(dd);
          if (scen === 'street') { if (r() < 0.8) buildings.push([o[0], o[1], hdg, r(), sgn]); }
          else if (scen === 'desert') { if (r() < 0.3) palms.push([o[0], o[1], r()]); }
          else trees.push([o[0], o[1], r()]);
        }
      }
      if (E.night && i % 30 === 0) {
        var s2 = (i / 30) % 2 ? 1 : -1;
        var lp = [p[0] + N[0] * (bar + 6) * s2, -(p[1] + N[1] * (bar + 6) * s2)];
        towers.push([lp[0], lp[1], hdg, s2]);
      }
    }

    var mtx = new THREE.Matrix4(), qu = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    var zAxis = new THREE.Vector3(0, 0, 1);
    function inst(geo, mat, list, fn, shadow) {
      if (!list.length) return null;
      var im = new THREE.InstancedMesh(geo, mat, list.length);
      for (var k = 0; k < list.length; k++) { fn(list[k], k); im.setMatrixAt(k, mtx); }
      im.castShadow = !!shadow; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      return im;
    }
    function setM(x, y, z, rot, sx, sy, sz) {
      ps.set(x, y, z); qu.setFromAxisAngle(zAxis, rot); sc.set(sx, sy, sz);
      mtx.compose(ps, qu, sc);
    }

    // 나무 (줄기 + 2단 수관)
    var trunk = new THREE.CylinderGeometry(0.22, 0.32, 3, 6); trunk.rotateX(Math.PI / 2); trunk.translate(0, 0, 1.5);
    var crown = new THREE.IcosahedronGeometry(2.6, 1); crown.scale(1, 1, 1.25); crown.translate(0, 0, 5.2);
    var crown2 = new THREE.ConeGeometry(2.4, 6, 8); crown2.rotateX(Math.PI / 2); crown2.translate(0, 0, 6.5);
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
    var leafA = new THREE.MeshStandardMaterial({ color: spec.timeOfDay === 'overcast' ? 0x2f5130 : 0x3d6b2e, roughness: 0.95, flatShading: true });
    var leafB = new THREE.MeshStandardMaterial({ color: 0x24452a, roughness: 0.95, flatShading: true });
    var deci = trees.filter(function (t, k) { return k % 3 !== 0; }), coni = trees.filter(function (t, k) { return k % 3 === 0; });
    inst(trunk, trunkMat, trees, function (t) { var s = 0.8 + t[2] * 0.9; setM(t[0], t[1], 0, t[2] * 6, s, s, s); });
    inst(crown, leafA, deci, function (t) { var s = 0.8 + t[2] * 0.9; setM(t[0], t[1], 0, t[2] * 6, s, s, s); }, true);
    inst(crown2, leafB, coni, function (t) { var s = 0.8 + t[2] * 0.9; setM(t[0], t[1], 0, t[2] * 6, s, s, s * 1.2); }, true);

    // 야자수
    var ptrunk = new THREE.CylinderGeometry(0.16, 0.28, 9, 6); ptrunk.rotateX(Math.PI / 2); ptrunk.translate(0, 0, 4.5);
    var fronds = [];
    for (var f = 0; f < 7; f++) {
      var fr = new THREE.ConeGeometry(0.5, 4.2, 4); fr.scale(1, 1, 0.15);
      fr.rotateZ(-Math.PI / 2); fr.translate(2.0, 0, 0); fr.rotateY(0.35); fr.rotateZ(f / 7 * Math.PI * 2);
      fr.translate(0, 0, 9);
      fronds.push(fr);
    }
    var frondGeo = merge(fronds);
    inst(ptrunk, new THREE.MeshStandardMaterial({ color: 0x7a5c3c, roughness: 1 }), palms, function (t) { var s = 0.8 + t[2] * 0.5; setM(t[0], t[1], 0, t[2] * 6, s, s, s); }, true);
    inst(frondGeo, new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, side: THREE.DoubleSide }), palms, function (t) { var s = 0.8 + t[2] * 0.5; setM(t[0], t[1], 0, t[2] * 6, s, s, s); }, true);

    // 타이어 월
    var tyreGeo = new THREE.TorusGeometry(0.42, 0.2, 6, 12);
    var tyreStack = [];
    for (var a = -2; a <= 2; a++) for (var h = 0; h < 3; h++) {
      var tg = tyreGeo.clone(); tg.translate(a * 0.95, 0, 0.2 + h * 0.38); tyreStack.push(tg);
    }
    var stackGeo = merge(tyreStack);
    inst(stackGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 }), tyres, function (t) { setM(t[0], t[1], 0, t[2], 1, 1, 1); }, true);
    // 컨베이어 벨트 커버 (테크프로 색)
    var beltGeo = new THREE.BoxGeometry(4.9, 0.08, 1.3); beltGeo.translate(0, -0.66, 0.65);
    var beltGeo2 = beltGeo.clone(); beltGeo2.translate(0, 1.32, 0);
    inst(merge([beltGeo, beltGeo2]), new THREE.MeshStandardMaterial({ color: 0x2f5fd0, roughness: 0.5 }), tyres, function (t) { setM(t[0], t[1], 0, t[2], 1, 1, 1); });

    // 관중석 (계단식 + 지붕)
    var standParts = [];
    for (var row = 0; row < 7; row++) {
      var st = new THREE.BoxGeometry(26, 1.4, 1.2); st.translate(0, row * 1.4, 0.6 + row * 1.2); standParts.push(st);
    }
    var standGeo = merge(standParts);
    var crowdGeo = new THREE.PlaneGeometry(26, 12.9);
    crowdGeo.rotateX(Math.atan2(1.2, 1.4));
    crowdGeo.translate(0, 4.2, 4.95);
    var roofGeo = new THREE.BoxGeometry(27, 11, 0.3); roofGeo.rotateX(-0.12); roofGeo.translate(0, 4.5, 12.2);
    var poleGeo = []; for (var pl = -1; pl <= 1; pl++) { var pg = new THREE.BoxGeometry(0.3, 0.3, 12); pg.translate(pl * 12, 9.6, 6); poleGeo.push(pg); }
    var crowdMat = new THREE.MeshStandardMaterial({ map: T.crowd, roughness: 0.9 });
    T.crowd.repeat.set(3, 1);
    // 관중석은 트랙을 향하도록: 로컬 -Y 가 트랙 방향
    function standM(t) {
      var rot = t[2] + (t[3] > 0 ? Math.PI : 0);
      setM(t[0], t[1], 0, rot, 1, 1, 1);
    }
    inst(standGeo, new THREE.MeshStandardMaterial({ color: 0x8a909a, roughness: 0.8 }), stands, standM, true);
    inst(crowdGeo, crowdMat, stands, standM);
    inst(roofGeo, new THREE.MeshStandardMaterial({ color: 0xe6e8ec, roughness: 0.4, metalness: 0.3 }), stands, standM, true);
    inst(merge(poleGeo), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.5, roughness: 0.4 }), stands, standM, true);

    // 광고판 (브랜드별로 나눠 인스턴싱)
    var boardFrame = new THREE.BoxGeometry(8, 0.25, 2.6); boardFrame.translate(0, 0, 1.8);
    var boardLegs = merge([boxG(-3.5, 0, 0.6, 0.15, 0.15, 1.2), boxG(3.5, 0, 0.6, 0.15, 0.15, 1.2)]);
    inst(merge([boardFrame, boardLegs]), new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.6 }), boards, function (t) { setM(t[0], t[1], 0, t[2], 1, 1, 1); }, true);
    var face = new THREE.PlaneGeometry(7.8, 2.4); face.rotateX(Math.PI / 2); face.translate(0, -0.14, 1.8);
    var face2 = face.clone(); face2.rotateZ(Math.PI);
    for (var bIdx = 0; bIdx < T.boards.length; bIdx++) {
      var sub = boards.filter(function (t) { return t[3] === bIdx; });
      var bm = new THREE.MeshStandardMaterial({ map: T.boards[bIdx], roughness: 0.5, emissive: 0xffffff, emissiveMap: T.boards[bIdx], emissiveIntensity: E.night ? 0.5 : 0.08 });
      inst(face, bm, sub, function (t) { setM(t[0], t[1], 0, t[2], 1, 1, 1); });
      inst(face2, bm, sub, function (t) { setM(t[0], t[1], 0, t[2], 1, 1, 1); });
    }

    // 시가지 건물
    if (buildings.length) {
      var bgeo = new THREE.BoxGeometry(1, 1, 1); bgeo.translate(0, 0, 0.5);
      var wtex = T.windows;
      var palette = [0xe8d8b8, 0xf0c8a0, 0xd8a890, 0xf4ecd8, 0xc8b8a0, 0xe0c0c8];
      for (var pc = 0; pc < palette.length; pc++) {
        var subB = buildings.filter(function (t) { return ((t[3] * 100) | 0) % palette.length === pc; });
        var tex = wtex.clone(); tex.needsUpdate = true; tex.repeat.set(3, 4);
        inst(bgeo, new THREE.MeshStandardMaterial({ color: palette[pc], map: tex, roughness: 0.8 }), subB, function (t) {
          var hh = 12 + t[3] * 26;
          setM(t[0], t[1], 0, t[2], 14, 12, hh);
        }, true);
      }
    }

    // 야간 조명탑
    if (towers.length) {
      var tw = merge([boxG(0, 0, 11, 0.5, 0.5, 22), boxG(0, 0, 22.5, 1.0, 4.4, 1.6)]);
      inst(tw, new THREE.MeshStandardMaterial({ color: 0x555a62, metalness: 0.5, roughness: 0.4 }), towers, function (t) { setM(t[0], t[1], 0, t[2], 1, 1, 1); });
      var lamp = new THREE.PlaneGeometry(4.0, 1.2); lamp.rotateX(Math.PI / 2); lamp.translate(0, -0.52, 22.5);
      inst(lamp, new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false, side: THREE.DoubleSide }), towers, function (t) { setM(t[0], t[1], 0, t[2] + (t[3] > 0 ? Math.PI : 0), 1, 1, 1); });
      // 글로우 스프라이트
      var glowMat = new THREE.SpriteMaterial({ map: T.glow, color: 0xfff1c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
      for (var tt = 0; tt < towers.length; tt++) {
        var spr = new THREE.Sprite(glowMat);
        spr.position.set(towers[tt][0], towers[tt][1], 22.5);
        spr.scale.set(16, 16, 1);
        scene.add(spr);
      }
    }
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

  Renderer3D.prototype.updateCamera = function (car, dt, race) {
    var m = CAMS[this.camMode];
    var spd = Math.min(1, car.speed / 82);
    var dist = m.rigid ? m.dist : m.dist * (1 + spd * 0.12);
    var height = m.rigid ? m.height : m.height * (1 - spd * 0.05);
    var fov = m.fov + spd * (m.rigid ? 6 : 10);

    if (!this.pose) {
      this.pose = { x: 0, y: 0, z: 0, yaw: car.heading, fov: fov, lx: 0, ly: 0, lz: 0 };
      this.snap = true;
    }
    var P = this.pose;
    var k = this.snap ? 1 : 1 - Math.exp(-dt * 7.5);
    var kl = this.snap ? 1 : 1 - Math.exp(-dt * 14);

    var revView = car.reverse && !m.rigid && this.camMode !== 4 &&
                  (car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading)) < -1.2;
    var viewHdg = car.heading + (revView ? Math.PI : 0);

    if (m.rigid) {
      P.yaw = car.heading;
      var c0 = Math.cos(car.heading), s0 = Math.sin(car.heading);
      P.x = car.x - c0 * dist; P.y = car.y - s0 * dist; P.z = height;
      P.lx = car.x + c0 * m.look; P.ly = car.y + s0 * m.look; P.lz = m.lookZ;
      P.fov = fov;
    } else {
      P.yaw = this.snap ? viewHdg : angLerp(P.yaw, viewHdg, 1 - Math.exp(-dt * 9));
      var cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
      var tx = car.x - cy * dist, ty = car.y - sy * dist, tz = height;
      P.x += (tx - P.x) * k; P.y += (ty - P.y) * k; P.z += (tz - P.z) * k;
      P.fov += (fov - P.fov) * Math.min(1, dt * 4);
      var ch = Math.cos(viewHdg), sh = Math.sin(viewHdg);
      var lx = car.x + ch * m.look, ly = car.y + sh * m.look, lz = m.lookZ;
      P.lx += (lx - P.lx) * kl; P.ly += (ly - P.ly) * kl; P.lz += (lz - P.lz) * kl;
    }
    this.snap = false;

    // 카메라가 배리어/캐치펜스 바깥으로 나가지 않게 (트랙 법선 방향으로 클램프)
    if (race && !m.rigid && this.camMode !== 4) {
      var tr = race.track, ti = car.trackIdx;
      var bp = tr.pts[ti], bn = tr.N[ti];
      var lat = (P.x - bp[0]) * bn[0] + (P.y - bp[1]) * bn[1];
      var lim = tr.barrier - 0.7;
      if (Math.abs(lat) > lim && Math.abs((car.x - bp[0]) * bn[0] + (car.y - bp[1]) * bn[1]) < lim) {
        var fix = lat - Math.sign(lat) * lim;
        P.x -= bn[0] * fix; P.y -= bn[1] * fix;
      }
    }

    var sh2 = this.cam.shake, ox = 0, oy = 0, oz = 0;
    if (sh2 > 0.01) {
      ox = (Math.random() - 0.5) * sh2 * 0.05;
      oy = (Math.random() - 0.5) * sh2 * 0.05;
      oz = (Math.random() - 0.5) * sh2 * 0.04;
      this.cam.shake *= 0.87;
    }
    // 고속 미세 진동 (온보드 시점)
    if (m.rigid && car.speed > 20) {
      var vib = Math.min(1, car.speed / 90) * 0.012;
      oz += (Math.random() - 0.5) * vib;
      ox += (Math.random() - 0.5) * vib * 0.5;
    }
    this.cx3 = P.x + ox; this.cy3 = P.y + oy; this.cz3 = P.z + oz;

    var cam = this.camera;
    cam.position.set(this.cx3, -this.cy3, this.cz3);
    cam.fov = P.fov;
    cam.updateProjectionMatrix();
    cam.lookAt(P.lx, -P.ly, P.lz);
    this.fx = P.lx - this.cx3; this.fy = P.ly - this.cy3;
    var fl = Math.hypot(this.fx, this.fy) || 1;
    this.fx /= fl; this.fy /= fl;
  };

  /* ------------------------------------------------------------------ *
   *  프레임
   * ------------------------------------------------------------------ */
  Renderer3D.prototype.draw = function (race, follow, dt) {
    if (!this.scene) return;
    this.updateCamera(follow, dt, race);
    var cam = this.camera;

    // 하늘 돔과 그림자 박스는 카메라를 따라간다
    this.sky.position.copy(cam.position);
    var tx = follow.x + Math.cos(follow.heading) * 25, ty = -(follow.y + Math.sin(follow.heading) * 25);
    this.sun.target.position.set(tx, ty, 0);
    this.sun.position.set(tx + this.sunDir.x * 300, ty + this.sunDir.y * 300, this.sunDir.z * 300);
    this.sun.target.updateMatrixWorld();

    if (this.guide) this.guide.visible = this.showLine;

    // 출발 신호
    if (this.lightMats) {
      var on = race.state === 'lights' ? race.lights : 0;
      for (var l = 0; l < 5; l++) this.lightMats[l].color.setHex(l < on ? 0xff1a10 : 0x220000);
    }

    // 플레이어 피트 박스 마커
    if (this.boxMarker) {
      var show = race.pitBoxHint && race.playerBox && race.player && race.player.pitState !== 'stopped';
      this.boxMarker.visible = !!show;
      if (show) {
        var bx = race.playerBox;
        this.boxMarker.position.set(bx[0], -bx[1], 2);
        this.boxMarker.material.opacity = 0.25 + 0.25 * Math.sin(performance.now() / 140);
      }
    }

    var drawCam = CAMS[this.camMode];
    for (var i = 0; i < race.cars.length; i++) {
      this.updateCar(race.cars[i], dt, follow, drawCam);
    }

    this.updatePointBuffers();
    this.gl.render(this.scene, cam);
    this.drawOverlay(race, follow, dt);
  };

  Renderer3D.prototype.updateCar = function (car, dt, follow, drawCam) {
    var obj = this.carObjs[car.id];
    if (!obj) return;
    var u = obj.userData;
        obj.position.set(car.x, -car.y, 0);
    obj.rotation.z = -car.heading;

    // 차체 거동: 가감속 피치, 코너 롤
    var vl = car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);
    var acc = dt > 0 ? (vl - u.lastSpeed) / dt : 0;
    u.lastSpeed = vl;
    var latAcc = car.yawRate * vl;
    var tp = Math.max(-0.018, Math.min(0.018, -acc * 0.0009));
    var tr = Math.max(-0.02, Math.min(0.02, -latAcc * 0.0006));
    u.pitch += (tp - u.pitch) * Math.min(1, dt * 6);
    u.roll += (tr - u.roll) * Math.min(1, dt * 6);
    u.body.rotation.set(u.roll, u.pitch, 0);
    // 고속에서 다운포스로 차고가 낮아진다
    u.body.position.z = -Math.min(0.02, car.speed * 0.00025);

    // 바퀴 회전 / 조향
    u.spinAng += vl * dt / WHEEL.fr;
    var steerMax = 0.52 - 0.34 * Math.min(1, Math.abs(vl) / 78);
    var steerA = -(car.steer || 0) * steerMax * 0.9;
    for (var w = 0; w < u.wheels.length; w++) {
      var wh = u.wheels[w];
      wh.steer.rotation.z = wh.front ? steerA : 0;
      wh.spin.rotation.y = u.spinAng;
    }
    // 타이어 컴파운드 색 갱신 (피트스탑)
    if (u.tyreColor !== car.tyre.color) {
      u.tyreColor = car.tyre.color;
      u.sideMat.map = sidewallTex(car.tyre.color);
      u.sideMat.needsUpdate = true;
    }

    // 액티브 에어로: 직선 모드에서 플랩이 눕는다
    var open = car.drs && car.drsAllowed;
    var target = open ? -0.45 : 0;
    u.flap.rotation.y += (target - u.flap.rotation.y) * Math.min(1, dt * 10);

    // 후미등: 회생(브레이킹) 중 깜빡임, 피트레인 상시 점등
    var blink = (car.brake > 0.2 && car.speed > 15) ? ((performance.now() / 90) | 0) % 2 : 0;
    var lightOn = blink || car.inPitLane || car.ers;
    u.light.color.setHex(lightOn ? 0xff2010 : 0x330000);

    // 콕핏 시점에서는 자기 헬멧이 시야를 가리므로 숨김
    var hideSelf = car === follow && drawCam.id === 'cockpit';
    u.body.children[5].visible = !hideSelf;
    u.body.children[6].visible = !hideSelf;
  };

  /* ------------------------------------------------------------------ *
   *  파티클
   * ------------------------------------------------------------------ */
  Renderer3D.prototype.spawn = function (x, y, z, type, vx, vy, vz) {
    var list = type === 'spark' ? (this.sparkList || (this.sparkList = [])) : this.particles;
    if (list.length >= (this.ptMax || 400) - 1) return;
    var life = type === 'smoke' ? 1.4 : (type === 'spark' ? 0.35 + Math.random() * 0.25 : 0.8);
    list.push({
      x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz !== undefined ? vz : 0.5 + Math.random(),
      life: life, max: life,
      size: type === 'smoke' ? 0.5 : (type === 'spark' ? 0.09 : 0.4), type: type
    });
  };

  Renderer3D.prototype.updateParticles = function (dt, race) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.95; p.vy *= 0.95; p.vz *= 0.97;
      p.size += dt * (p.type === 'smoke' ? 1.7 : 1.1);
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    var sl = this.sparkList || (this.sparkList = []);
    for (i = sl.length - 1; i >= 0; i--) {
      p = sl[i];
      p.life -= dt;
      p.vz -= 9.8 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0.02) { p.z = 0.02; p.vz = -p.vz * 0.3; p.vx *= 0.7; p.vy *= 0.7; }
      if (p.life <= 0) sl.splice(i, 1);
    }
    var rate = Math.min(1, dt * 60);
    for (i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      if (car.retired) continue;
      var c = Math.cos(car.heading), s = Math.sin(car.heading);
      var rx = car.x - c * 1.9, ry = car.y - s * 1.9;
      if ((car.slip > 0.25 || car.spinTimer > 0) && car.speed > 10 && Math.random() < 0.7 * rate) {
        for (var w = -1; w <= 1; w += 2) {
          this.spawn(rx - s * w * 0.8, ry + c * w * 0.8, 0.3, 'smoke', (Math.random() - 0.5) * 2 + car.vx * 0.2, (Math.random() - 0.5) * 2 + car.vy * 0.2);
        }
      }
      if (!car.onTrack && car.speed > 10 && Math.random() < 0.8 * rate) {
        this.spawn(rx, ry, 0.2, 'dust', (Math.random() - 0.5) * 5 + car.vx * 0.15, (Math.random() - 0.5) * 5 + car.vy * 0.15);
      }
      // 티타늄 스키드 스파크 (고속 직선 · 연석 · 브레이킹 바운스)
      if (car.speed > 62 && car.onTrack) {
        var chance = (car.speed - 62) / 30 * 0.35 * rate;
        if (Math.random() < chance) {
          var n = 3 + (Math.random() * 6 | 0);
          for (var k = 0; k < n; k++) {
            var sp = 0.55 + Math.random() * 0.35;
            this.spawn(car.x - c * (0.6 + Math.random()), car.y - s * (0.6 + Math.random()), 0.04,
              'spark', car.vx * sp + (Math.random() - 0.5) * 6, car.vy * sp + (Math.random() - 0.5) * 6, 0.5 + Math.random() * 2.2);
          }
        }
      }
    }
  };

  Renderer3D.prototype.updatePointBuffers = function () {
    if (!this.pts) return;
    var E = this.env;
    var dustCol = new THREE.Color(E.groundTex === 'grass' ? 0x6d5a3a : E.ground);
    this.fillPoints(this.pts, this.particles, function (p, out) {
      if (p.type === 'smoke') { out[0] = 0.86; out[1] = 0.87; out[2] = 0.9; return (p.life / p.max) * 0.28; }
      out[0] = dustCol.r; out[1] = dustCol.g; out[2] = dustCol.b; return (p.life / p.max) * 0.4;
    });
    this.fillPoints(this.sparks, this.sparkList || [], function (p, out) {
      var t = p.life / p.max;
      out[0] = 1.6; out[1] = 0.7 + t * 0.5; out[2] = 0.25 * t; return t;
    });
    var scale = this.h * this.gl.getPixelRatio() / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.pts.mat.uniforms.scale.value = scale;
    this.sparks.mat.uniforms.scale.value = scale;
  };

  var _tint = [0, 0, 0];
  Renderer3D.prototype.fillPoints = function (P, list, fn) {
    var n = Math.min(list.length, this.ptMax);
    for (var i = 0; i < n; i++) {
      var p = list[i];
      P.pos[i * 3] = p.x; P.pos[i * 3 + 1] = -p.y; P.pos[i * 3 + 2] = p.z;
      P.alpha[i] = fn(p, _tint);
      P.tint[i * 3] = _tint[0]; P.tint[i * 3 + 1] = _tint[1]; P.tint[i * 3 + 2] = _tint[2];
      P.size[i] = p.size;
    }
    P.geo.setDrawRange(0, n);
    P.geo.attributes.position.needsUpdate = true;
    P.geo.attributes.alpha.needsUpdate = true;
    P.geo.attributes.tint.needsUpdate = true;
    P.geo.attributes.size.needsUpdate = true;
  };

  /* ------------------------------------------------------------------ *
   *  2D 오버레이 (드라이버 태그, 충돌 섬광, 속도 비네트)
   * ------------------------------------------------------------------ */
  var _v = null;
  Renderer3D.prototype.drawOverlay = function (race, follow, dt) {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (!_v) _v = new THREE.Vector3();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 고속 비네트
    var spd = Math.min(1, Math.max(0, (follow.speed - 55) / 35));
    if (spd > 0.01) {
      var vg = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.35, w / 2, h * 0.55, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,' + (spd * 0.35).toFixed(3) + ')');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    }

    // 드라이버 태그
    var cam = this.camera;
    for (var i = 0; i < race.cars.length; i++) {
      var car = race.cars[i];
      if (car === follow && CAMS[this.camMode].rigid) continue;
      var dx = car.x - this.cx3, dy = car.y - this.cy3;
      var depth = dx * this.fx + dy * this.fy;
      if (depth < 4 || depth > 200) continue;
      _v.set(car.x, -car.y, 1.75).project(cam);
      if (_v.z > 1) continue;
      var sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h) continue;
      var size = Math.max(9, Math.min(15, 240 / depth));
      ctx.globalAlpha = Math.max(0.3, 1 - depth / 200);
      if (car.isPlayer) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(sx, sy - size * 0.2);
        ctx.lineTo(sx - size * 0.45, sy - size * 0.95);
        ctx.lineTo(sx + size * 0.45, sy - size * 0.95);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.font = '700 ' + size.toFixed(0) + 'px "Titillium Web", "Segoe UI", sans-serif';
        var tw = ctx.measureText(car.driver.code).width + size * 0.9;
        ctx.fillStyle = 'rgba(12,14,20,0.78)';
        ctx.fillRect(sx - tw / 2, sy - size * 1.3, tw, size * 1.3);
        ctx.fillStyle = car.team.color;
        ctx.fillRect(sx - tw / 2, sy - size * 1.3, size * 0.22, size * 1.3);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(car.driver.code, sx + size * 0.12, sy - size * 0.62);
      }
    }
    ctx.globalAlpha = 1;

    // 충돌 섬광
    if (race.crashFlash > 0) {
      ctx.fillStyle = 'rgba(255,58,40,' + (race.crashFlash * 0.42).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
      race.crashFlash = Math.max(0, race.crashFlash - dt * 1.7);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /* ---- 미니맵 (2D 오버레이) --------------------------------------------- */
  Renderer3D.prototype.drawMinimap = function (ctx, race, x, y, size) {
    var track = race.track, b = track.bounds;
    var wm = b.maxX - b.minX, hm = b.maxY - b.minY;
    var s = size / Math.max(wm, hm);
    var ox = x + (size - wm * s) / 2, oy = y + (size - hm * s) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.62)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 8, y - 8, size + 16, size + 16, 10); else ctx.rect(x - 8, y - 8, size + 16, size + 16);
    ctx.fill();
    ctx.beginPath();
    for (var i = 0; i <= track.n; i += 2) {
      var p = track.pts[i % track.n];
      var px = ox + (p[0] - b.minX) * s, py = oy + (p[1] - b.minY) * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.stroke();
    // 액티브 에어로 구간
    ctx.strokeStyle = '#2fd270'; ctx.lineWidth = 3;
    for (var z = 0; z < track.drs.length; z++) {
      var zn = track.drs[z];
      ctx.beginPath();
      var cnt = ((zn.end - zn.start) % track.n + track.n) % track.n;
      for (var k = 0; k <= cnt; k += 2) {
        var q = track.pts[(zn.start + k) % track.n];
        var qx = ox + (q[0] - b.minX) * s, qy = oy + (q[1] - b.minY) * s;
        if (k === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
      }
      ctx.stroke();
    }
    var sp = track.pts[0];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox + (sp[0] - b.minX) * s - 2, oy + (sp[1] - b.minY) * s - 4, 4, 8);
    for (var c = race.cars.length - 1; c >= 0; c--) {
      var car = race.cars[c];
      if (car.retired) continue;
      var cx = ox + (car.x - b.minX) * s, cy = oy + (car.y - b.minY) * s;
      ctx.beginPath();
      ctx.arc(cx, cy, car.isPlayer ? 4.5 : 3.2, 0, 6.283);
      ctx.fillStyle = car.team.color;
      ctx.fill();
      ctx.strokeStyle = car.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.7)';
      ctx.lineWidth = car.isPlayer ? 2 : 1;
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer3D.prototype.disposeScene = function () {
    if (!this.scene) return;
    this.scene.traverse(function (o) {
      if (o.geometry && o.geometry !== (CAR_GEO && CAR_GEO.paint)) {
        // 차량 공유 지오메트리는 유지
        var shared = false;
        if (CAR_GEO) for (var k in CAR_GEO) if (CAR_GEO[k] === o.geometry) shared = true;
        if (!shared) o.geometry.dispose();
      }
    });
    this.scene = null;
  };

  Renderer3D.prototype.reset = function () { this.pose = null; this.snap = true; };

  global.Renderer3D = Renderer3D;
  global.CAMERA_MODES = CAMS;
})(typeof window !== 'undefined' ? window : globalThis);
