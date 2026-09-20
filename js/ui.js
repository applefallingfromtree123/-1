/* =========================================================================
 * F1 THE GAME - UI (화면 전환, 메뉴 구성, HUD)
 * ========================================================================= */
(function (global) {
  'use strict';

  var F1 = global.F1DATA;
  var fmt = global.fmtTime;
  var $ = function (id) { return document.getElementById(id); };

  var UI = {
    screen: 'intro',
    thumbCache: {},
    el: {}
  };

  UI.init = function () {
    var ids = ['hudPos', 'hudPosOf', 'hudLap', 'hudFlags', 'hudCur', 'hudLast', 'hudBest',
      'hudGapAhead', 'hudGapBehind', 'hudStandings', 'hudTyre', 'hudTyreBar', 'hudTyrePct',
      'hudFuelBar', 'hudFuel', 'hudErsBar', 'hudErs', 'hudDmgBar', 'hudDmg', 'hudNextTyre',
      'hudSpeed', 'hudGear', 'hudRev', 'lights', 'bigMsg', 'eventLog'];
    for (var i = 0; i < ids.length; i++) UI.el[ids[i]] = $(ids[i]);
    var l = UI.el.lights;
    l.innerHTML = '';
    for (i = 0; i < 5; i++) l.appendChild(document.createElement('i'));
  };

  UI.show = function (id) {
    var all = document.querySelectorAll('.screen');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    $(id).classList.add('active');
    UI.screen = id;
  };

  /* ---------------- 팀 / 드라이버 ---------------- */
  UI.buildTeams = function (onPick) {
    var g = $('teamGrid');
    g.innerHTML = '';
    F1.TEAMS.forEach(function (team) {
      var b = document.createElement('button');
      b.className = 'team-card';
      b.innerHTML = '<span class="chip" style="background:' + team.color + '"></span>' +
        '<span><b>' + team.name + '</b><span>' + team.full + '</span></span>' +
        '<span class="pace">' + (team.pace * 100).toFixed(1) + '</span>';
      b.onclick = function () { onPick(team); };
      g.appendChild(b);
    });
  };

  UI.buildDrivers = function (team, onPick) {
    $('driverSelectSub').textContent = team.name + ' · ' + team.full;
    var g = $('driverGrid');
    g.innerHTML = '';
    team.drivers.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'driver-card';
      b.style.borderLeft = '3px solid ' + team.color;
      b.innerHTML = '<div class="num" style="color:' + team.color + '">' + d.num + '</div>' +
        '<b>' + d.name + '</b><div class="code">' + d.code + '</div>' +
        '<div class="stats"><span>페이스 ' + Math.round(d.skill * 100) + '</span>' +
        '<span>타이어 ' + Math.round(d.tyre * 100) + '</span>' +
        '<span>공격성 ' + Math.round(d.agg * 100) + '</span></div>';
      b.onclick = function () { onPick(d); };
      g.appendChild(b);
    });
  };

  /* ---------------- 서킷 ---------------- */
  UI.trackThumb = function (spec, size) {
    if (UI.thumbCache[spec.id]) return UI.thumbCache[spec.id];
    var t = global.Geometry.getTrack(spec);
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    var b = t.bounds, wm = b.maxX - b.minX, hm = b.maxY - b.minY;
    var s = (size - 16) / Math.max(wm, hm);
    var ox = (size - wm * s) / 2 - b.minX * s, oy = (size - hm * s) / 2 - b.minY * s;
    g.beginPath();
    for (var i = 0; i <= t.n; i += 2) {
      var p = t.pts[i % t.n];
      var x = ox + p[0] * s, y = oy + p[1] * s;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = 2.6; g.lineJoin = 'round';
    g.stroke();
    var sp = t.pts[0];
    g.fillStyle = '#e10600';
    g.fillRect(ox + sp[0] * s - 2.5, oy + sp[1] * s - 2.5, 5, 5);
    UI.thumbCache[spec.id] = cv;
    return cv;
  };

  UI.buildTracks = function (onPick, roundLabels) {
    var g = $('trackGrid');
    g.innerHTML = '';
    global.TRACKS.forEach(function (spec, i) {
      var b = document.createElement('button');
      b.className = 'track-card';
      var thumb = UI.trackThumb(spec, 96);
      var cv = document.createElement('canvas');
      cv.width = 96; cv.height = 96;
      cv.getContext('2d').drawImage(thumb, 0, 0);
      b.appendChild(cv);
      var info = document.createElement('div');
      info.innerHTML = (roundLabels ? '<div class="rnd">ROUND ' + (i + 1) + '</div>' : '') +
        '<b>' + spec.flag + ' ' + spec.name + '</b>' +
        '<div class="meta">' + (spec.realLength / 1000).toFixed(3) + ' km · ' +
        spec.gpLaps + '랩(GP) · 폭 ' + spec.width + 'm<br>' +
        '<span class="desc">' + spec.notes + '</span></div>';
      b.appendChild(info);
      b.onclick = function () { onPick(spec); };
      g.appendChild(b);
    });
  };

  /* ---------------- 옵션 ---------------- */
  UI.buildOptions = function (containerId, items, current, onPick) {
    var c = $(containerId);
    c.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'opt' + (it.value === current ? ' sel' : '');
      b.textContent = it.label;
      b.onclick = function () {
        var kids = c.querySelectorAll('.opt');
        for (var i = 0; i < kids.length; i++) kids[i].classList.remove('sel');
        b.classList.add('sel');
        onPick(it.value);
      };
      c.appendChild(b);
    });
  };

  /* ---------------- HUD ---------------- */
  var lastFlags = '';
  UI.updateHUD = function (race, app) {
    var e = UI.el, p = race.player;
    if (!p) return;

    e.hudPos.textContent = p.position;
    e.hudPosOf.textContent = '/' + race.cars.length;
    e.hudLap.textContent = race.mode === 'practice'
      ? Math.max(0, p.lap)
      : (Math.min(p.lap + 1, race.totalLaps) + '/' + race.totalLaps);

    var cur = race.state === 'lights' ? 0 : race.time - p.lapStart;
    e.hudCur.textContent = fmt(Math.max(0, cur));
    e.hudLast.textContent = fmt(p.lastLap);
    e.hudBest.textContent = fmt(p.bestLap);

    var ord = race.order || race.cars;
    var idx = ord.indexOf(p);
    var ahead = idx > 0 ? ord[idx - 1] : null;
    var behind = idx < ord.length - 1 ? ord[idx + 1] : null;
    e.hudGapAhead.textContent = ahead
      ? '▲ ' + ahead.driver.code + ' +' + p.gapAhead.toFixed(1) + 's' : '▲ 선두';
    e.hudGapBehind.textContent = behind
      ? '▼ ' + behind.driver.code + ' -' + behind.gapAhead.toFixed(1) + 's' : '▼ 최후미';

    // 플래그
    var flags = '';
    if (p.drsAllowed) flags += '<div class="flag drs">DRS</div>';
    if (p.inPitLane) flags += '<div class="flag pit">PIT LIMITER</div>';
    if (race.mandatoryPit && p.pitStops === 0 && race.mode === 'race') {
      var urgent = p.lap >= race.totalLaps - 2;
      flags += '<div class="flag ' + (urgent ? 'box' : 'pit') + '">BOX 필요</div>';
    }
    if (!p.onTrack) flags += '<div class="flag off">OFF TRACK</div>';
    if (flags !== lastFlags) { e.hudFlags.innerHTML = flags; lastFlags = flags; }

    // 게이지
    var life = Math.max(0, 1 - p.tyreWear);
    e.hudTyre.textContent = p.tyre.short;
    e.hudTyre.style.color = p.tyre.color;
    e.hudTyreBar.style.width = (life * 100) + '%';
    e.hudTyreBar.style.background = life > 0.5 ? 'var(--good)' : (life > 0.22 ? 'var(--warn)' : 'var(--bad)');
    e.hudTyrePct.textContent = Math.round(life * 100) + '%';

    var fuelMax = race.fuelLoad;
    e.hudFuelBar.style.width = Math.max(0, Math.min(100, p.fuel / fuelMax * 100)) + '%';
    e.hudFuel.textContent = p.fuel.toFixed(1) + 'kg';
    e.hudErsBar.style.width = (p.ersCharge * 100) + '%';
    e.hudErs.textContent = Math.round(p.ersCharge * 100) + '%';
    e.hudDmgBar.style.width = (p.damage * 100) + '%';
    e.hudDmg.textContent = Math.round(p.damage * 100) + '%';
    e.hudNextTyre.textContent = F1.TYRES[race.playerNextCompound].label;

    var gi = p.gearInfo();
    e.hudSpeed.textContent = Math.round(p.speed * 3.6);
    e.hudGear.textContent = p.reverse ? 'REVERSE' : (p.speed < 0.6 ? 'N' : 'GEAR ' + gi.gear);
    e.hudRev.style.width = Math.min(100, (gi.rpm / 12500) * 100) + '%';

    UI.updateStandings(race);
    UI.updateEvents(race);
  };

  var stCache = '';
  UI.updateStandings = function (race) {
    var ord = race.order;
    if (!ord) return;
    var p = race.player;
    var me = ord.indexOf(p);
    var rows = [];
    var shown = {};
    function add(i) {
      if (i < 0 || i >= ord.length || shown[i]) return;
      shown[i] = true; rows.push(i);
    }
    for (var i = 0; i < Math.min(6, ord.length); i++) add(i);
    add(me - 1); add(me); add(me + 1);
    rows.sort(function (a, b) { return a - b; });

    var html = '';
    var prev = -1;
    rows.forEach(function (i) {
      var c = ord[i];
      if (prev >= 0 && i - prev > 1) html += '<div class="st-row"><span class="p"></span><span class="n" style="color:#4c5464">···</span></div>';
      prev = i;
      var gap = i === 0 ? 'LEADER' : ('+' + c.gapAhead.toFixed(1));
      if (c.retired) gap = 'DNF';
      else if (c.finished) gap = 'FIN';
      else if (c.inPitLane) gap = 'PIT';
      html += '<div class="st-row' + (c === p ? ' me' : '') + (c.retired ? ' out' : '') + '">' +
        '<span class="p">' + (i + 1) + '</span>' +
        '<span class="c" style="background:' + c.team.color + '"></span>' +
        '<span class="n">' + c.driver.code + '</span>' +
        '<span class="g">' + gap + '</span></div>';
    });
    if (html !== stCache) { UI.el.hudStandings.innerHTML = html; stCache = html; }
  };

  var evCache = '';
  UI.updateEvents = function (race) {
    var html = '';
    for (var i = Math.min(2, race.events.length - 1); i >= 0; i--) {
      if (race.time - race.events[i].t < 4.5) html += '<div>' + race.events[i].text + '</div>';
    }
    if (html !== evCache) { UI.el.eventLog.innerHTML = html; evCache = html; }
  };

  UI.setLights = function (count) {
    var kids = UI.el.lights.children;
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < count);
    UI.el.lights.style.display = count >= 0 ? 'flex' : 'none';
  };

  UI.big = function (text, color) {
    var el = UI.el.bigMsg;
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  };

  /* ---------------- 테이블 ---------------- */
  function row(cells, cls) {
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
      cells.map(function (c) { return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.v + '</td>'; }).join('') +
      '</tr>';
  }
  function head(cols) {
    return '<tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
  }

  UI.renderQuali = function (entries, spec, playerEntry) {
    $('qualiSub').textContent = spec.flag + ' ' + spec.name + ' · Q3 결과';
    var html = head(['', '드라이버', '팀', '랩타임', '갭']);
    var p1 = entries[0].time;
    entries.forEach(function (e, i) {
      html += row([
        { v: i + 1, cls: 'pos' },
        { v: '<span class="tchip" style="background:' + e.team.color + '"></span>' + e.driver.name + ' <span style="color:#6f7889">' + e.driver.code + '</span>' },
        { v: e.team.name },
        { v: fmt(e.time), cls: 'num' },
        { v: i === 0 ? '—' : '+' + (e.time - p1).toFixed(3), cls: 'num' }
      ], e.isPlayer ? 'me' : '');
    });
    $('qualiTable').innerHTML = html;
  };

  UI.renderResults = function (race, title, sub, pointsMap) {
    $('resultTitle').textContent = title;
    $('resultSub').innerHTML = sub;
    var ord = race.results();
    var leader = ord[0];
    var html = head(['', '드라이버', '팀', '타이어', '피트', '베스트 랩', '결과', pointsMap ? '포인트' : '']);
    ord.forEach(function (c, i) {
      var res;
      if (c.retired) res = 'DNF';
      else if (c.finished) res = i === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - leader.finishTime).toFixed(3);
      else {
        var lapsDown = race.totalLaps - 1 - c.lap;
        if (lapsDown > 0) res = '+' + lapsDown + ' LAP';
        else {
          var ref = c.bestLap || leader.bestLap || 90;
          var dist = race.totalLaps * race.track.length - c.progress;
          res = '+' + Math.max(0, dist / (race.track.length / ref)).toFixed(3);
        }
      }
      var fl = race.fastestLap.car === c ? ' <span style="color:#c07bff">FL</span>' : '';
      if (c.penalty) fl += ' <span style="color:#ff6b6b" title="의무 피트스탑 미이행">+' + c.penalty + 's</span>';
      html += row([
        { v: i + 1, cls: 'pos' },
        { v: '<span class="tchip" style="background:' + c.team.color + '"></span>' + c.driver.name + fl },
        { v: c.team.name },
        { v: '<span style="color:' + c.tyre.color + '">' + c.tyre.short + '</span>' },
        { v: c.pitStops, cls: 'num' },
        { v: fmt(c.bestLap), cls: 'num' },
        { v: res, cls: 'num' },
        { v: pointsMap ? (pointsMap[i] ? '<span class="pts">+' + pointsMap[i] + '</span>' : '') : '' }
      ], c.isPlayer ? 'me' : '');
    });
    $('resultTable').innerHTML = html;
  };

  UI.renderChampionship = function (standings, teamStandings, sub, playerKey) {
    $('champSub').innerHTML = sub;
    var html = head(['', '드라이버', '팀', 'PTS']);
    standings.forEach(function (s, i) {
      html += row([
        { v: i + 1, cls: 'pos' },
        { v: '<span class="tchip" style="background:' + s.team.color + '"></span>' + s.driver.name },
        { v: s.team.name },
        { v: '<span class="pts">' + s.pts + '</span>', cls: 'num' }
      ], s.key === playerKey ? 'me' : '');
    });
    $('champDrivers').innerHTML = html;

    var html2 = head(['', '컨스트럭터', 'PTS']);
    teamStandings.forEach(function (s, i) {
      html2 += row([
        { v: i + 1, cls: 'pos' },
        { v: '<span class="tchip" style="background:' + s.team.color + '"></span>' + s.team.name },
        { v: '<span class="pts">' + s.pts + '</span>', cls: 'num' }
      ]);
    });
    $('champTeams').innerHTML = html2;
  };

  UI.buttons = function (containerId, defs) {
    var c = $(containerId);
    c.innerHTML = '';
    defs.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'btn ' + (d.cls || '');
      b.textContent = d.label;
      b.onclick = d.onClick;
      c.appendChild(b);
    });
  };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
