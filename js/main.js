/* =========================================================================
 * F1 THE GAME - main
 * 인트로 -> 메뉴 -> 모드별 진행 -> 레이스 루프
 * ========================================================================= */
(function (global) {
  'use strict';

  var F1 = global.F1DATA;
  var UI = global.UI;
  var fmt = global.fmtTime;
  var $ = function (id) { return document.getElementById(id); };

  var App = {
    mode: null,
    team: null,
    driver: null,
    spec: null,
    laps: 5,
    difficulty: 'pro',
    tyre: 'medium',
    guide: true,
    race: null,
    renderer: null,
    paused: false,
    history: [],
    gp: null
  };
  global.App = App;

  var input = { up: false, down: false, left: false, right: false, space: false, shift: false };

  /* ================= 인트로 ================= */
  var introTimers = [];
  function runIntro() {
    var pres = $('introPresent'), title = $('introTitle');
    pres.classList.add('show');
    introTimers.push(setTimeout(function () {
      pres.classList.remove('show');
      title.classList.add('show');
      global.SFX.init();
      global.SFX.beep(180, 0.5, 0.12);
    }, 3100));
    introTimers.push(setTimeout(endIntro, 6300));
  }
  function endIntro() {
    introTimers.forEach(clearTimeout);
    introTimers = [];
    if (UI.screen === 'intro') go('menu');
  }

  /* ================= 화면 이동 ================= */
  function go(id, push) {
    if (push !== false && UI.screen !== id) App.history.push(UI.screen);
    UI.show(id);
  }
  function back() {
    var prev = App.history.pop() || 'menu';
    UI.show(prev);
  }

  /* ================= 트랙 캐시 ================= */
  function trackFor(spec) { return global.Geometry.getTrack(spec); }

  /* ================= 랩타임 추정 (예선 시뮬레이션용) ================= */
  function estimateLap(spec) {
    var t = trackFor(spec);
    var total = 0;
    var prevV = 90;
    for (var i = 0; i < t.n; i++) {
      var v = global.AIUtil.cornerSpeed(t.raceK[i], 1.0);
      v = Math.min(v, spec.id === 'monza' ? 94 : 89);
      // 가속 한계 반영 (이전 지점 속도에서 급격히 못 올라감)
      v = Math.min(v, Math.sqrt(prevV * prevV + 2 * 11 * t.spacing));
      prevV = v;
      total += t.spacing / Math.max(v, 12);
    }
    return total * 1.045;
  }

  /* ================= 예선 ================= */
  function simulateQuali() {
    var ref = estimateLap(App.spec);
    var penalty = { rookie: 0.004, amateur: 0.016, pro: 0.030, legend: 0.048 }[App.difficulty];
    var entries = [];
    F1.TEAMS.forEach(function (team) {
      team.drivers.forEach(function (d) {
        var isPlayer = (team === App.team && d === App.driver);
        var factor = 1 + (1 - team.pace) * 2.15 + (isPlayer ? penalty : (1 - d.skill) * 0.95);
        var t = ref * factor + (Math.random() - 0.5) * 0.45;
        entries.push({ team: team, driver: d, isPlayer: isPlayer, time: t });
      });
    });
    entries.sort(function (a, b) { return a.time - b.time; });
    return entries;
  }

  /* ================= 레이스 시작 ================= */
  function startRace(entries) {
    var laps = App.mode === 'gp' ? App.spec.gpLaps : App.laps;
    var grid = entries.map(function (e, i) {
      var compound;
      if (e.isPlayer) compound = App.tyre;
      else compound = i < 10 ? (Math.random() < 0.65 ? 'soft' : 'medium')
                             : (Math.random() < 0.55 ? 'medium' : 'hard');
      return { team: e.team, driver: e.driver, isPlayer: e.isPlayer, compound: compound };
    });

    App.race = new global.Race({
      spec: App.spec,
      mode: 'race',
      laps: laps,
      difficulty: F1.DIFFICULTY[App.difficulty],
      mandatoryPit: laps >= 3,
      grid: grid,
      playerNextCompound: App.tyre === 'soft' ? 'hard' : (App.tyre === 'hard' ? 'medium' : 'hard')
    });
    enterGame();
  }

  function startPractice() {
    App.race = new global.Race({
      spec: App.spec,
      mode: 'practice',
      laps: 999,
      difficulty: F1.DIFFICULTY[App.difficulty],
      mandatoryPit: false,
      grid: [{ team: App.team, driver: App.driver, isPlayer: true, compound: App.tyre }],
      playerNextCompound: 'soft'
    });
    enterGame();
  }

  function enterGame() {
    go('game');
    App.paused = false;
    $('pause').classList.remove('active');
    if (!App.renderer) App.renderer = new global.Renderer3D($('canvas'));
    App.renderer.showLine = App.guide;
    App.renderer.particles.length = 0;
    resize();
    App.renderer.prepare(App.race);
    App.renderer.reset();
    App.renderer.cam.shake = 0;
    App.race.sfxHook = function (power) {
      global.SFX.crash(power);
      App.renderer.cam.shake = Math.min(16, power * 0.55);
    };
    lastLight = -1;
    lastPitStops = 0;
    accum = 0;
    global.SFX.init();
    global.SFX.resume();
    UI.setLights(App.race.mode === 'practice' ? -1 : 0);
    if (App.race.mode === 'practice') UI.big('연습 주행 시작', '#7dffb0');
  }

  /* ================= 게임 루프 ================= */
  var lastTs = 0, accum = 0, lastLight = -1, lastPitStops = 0;
  var STEP = 1 / 120;

  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    var race = App.race;
    if (!race || UI.screen !== 'game') return;

    if (!App.paused) {
      accum += dt;
      var guard = 0;
      while (accum >= STEP && guard++ < 6) {
        race.update(STEP, input);
        accum -= STEP;
      }
      App.renderer.updateParticles(dt, race);

      // 라이트 시퀀스
      if (race.state === 'lights') {
        if (race.lights !== lastLight) {
          lastLight = race.lights;
          UI.setLights(race.lights);
          if (race.lights > 0) global.SFX.beep(660, 0.18, 0.2);
        }
      } else if (lastLight !== -2) {
        lastLight = -2;
        UI.setLights(-1);
        if (race.mode !== 'practice') {
          UI.big('LIGHTS OUT', '#ff3b30');
          global.SFX.beep(1200, 0.5, 0.25);
        }
      }

      // 피트스탑 완료 연출
      if (race.player && race.player.pitStops !== lastPitStops) {
        lastPitStops = race.player.pitStops;
        UI.big('PIT STOP ' + race.player.tyre.label, race.player.tyre.color);
      }

      if (race.state === 'over') { showResults(); return; }
      if (race.player && race.player.retired && race.mode !== 'practice' && race.state !== 'over') {
        race.state = 'over';
      }
    }

    var follow = race.player || race.cars[0];
    App.renderer.draw(race, follow, dt);

    // 미니맵
    var ctx = App.renderer.ctx;
    ctx.save();
    ctx.scale(App.renderer.dpr, App.renderer.dpr);
    App.renderer.drawMinimap(ctx, race, App.renderer.w - 190, 22, 168);
    ctx.restore();

    UI.updateHUD(race, App);
    global.SFX.engine(follow, !App.paused);
  }

  /* ================= 결과 ================= */
  function showResults() {
    var race = App.race;
    global.SFX.engine(null, false);
    var ord = race.results();
    var player = race.player;
    var pmap = {};

    if (App.mode === 'gp') {
      var pts = F1.POINTS;
      var scoring = ord.filter(function (c) { return !c.retired; });
      scoring.forEach(function (c, i) {
        if (i < pts.length) {
          var key = c.team.id + ':' + c.driver.num;
          App.gp.points[key] = (App.gp.points[key] || 0) + pts[i];
          App.gp.teamPts[c.team.id] = (App.gp.teamPts[c.team.id] || 0) + pts[i];
          pmap[ord.indexOf(c)] = pts[i];
        }
      });
    }

    var posText = player.retired ? 'DNF' : (player.position + '위');
    var sub = App.spec.flag + ' ' + App.spec.name + ' · ' + race.totalLaps + '랩 · ' +
      '내 결과 <b style="color:#fff">' + posText + '</b>' +
      (race.fastestLap.car ? ' · 패스티스트 랩 ' + race.fastestLap.car.driver.code + ' ' + fmt(race.fastestLap.time) : '');

    UI.renderResults(race, App.mode === 'gp' ? ('라운드 ' + (App.gp.round + 1) + ' 결과') : '레이스 결과',
      sub, App.mode === 'gp' ? pmap : null);

    var btns = [];
    if (App.mode === 'gp') {
      btns.push({ label: '챔피언십 순위', cls: 'primary', onClick: showChampionship });
    } else {
      btns.push({
        label: '다시 하기', cls: 'primary', onClick: function () {
          startRace(simulateQuali());
        }
      });
      btns.push({ label: '다른 서킷', onClick: function () { openTrackSelect(); } });
      btns.push({ label: '메인 메뉴', cls: 'ghost', onClick: toMenu });
    }
    UI.buttons('resultBtns', btns);
    go('result');
  }

  function standingsArrays() {
    var list = [];
    F1.TEAMS.forEach(function (team) {
      team.drivers.forEach(function (d) {
        var key = team.id + ':' + d.num;
        list.push({ key: key, team: team, driver: d, pts: App.gp.points[key] || 0 });
      });
    });
    list.sort(function (a, b) { return b.pts - a.pts; });
    var teams = F1.TEAMS.map(function (t) {
      return { team: t, pts: App.gp.teamPts[t.id] || 0 };
    }).sort(function (a, b) { return b.pts - a.pts; });
    return { drivers: list, teams: teams };
  }

  function showChampionship() {
    var s = standingsArrays();
    var round = App.gp.round + 1;
    var done = round >= global.TRACKS.length;
    var key = App.team.id + ':' + App.driver.num;
    var myPos = s.drivers.findIndex(function (d) { return d.key === key; }) + 1;
    var sub = '라운드 ' + round + ' / ' + global.TRACKS.length + ' 종료 · 내 순위 ' +
      '<b style="color:#fff">' + myPos + '위 ' + (App.gp.points[key] || 0) + 'pt</b>';
    var btns = [];
    if (!done) {
      btns.push({
        label: '다음 라운드 — ' + global.TRACKS[round].flag + ' ' + global.TRACKS[round].name,
        cls: 'primary',
        onClick: function () { App.gp.round = round; startGPRound(); }
      });
    } else {
      var champ = s.drivers[0];
      sub = '<b style="color:#ffcc33;font-size:15px">🏆 시즌 종료 — 월드 챔피언 ' +
        champ.driver.name + ' (' + champ.team.name + ') ' + champ.pts + 'pt</b><br>' +
        '컨스트럭터 챔피언 ' + s.teams[0].team.name + ' ' + s.teams[0].pts + 'pt · ' +
        '내 최종 순위 <b style="color:#fff">' + myPos + '위</b>';
    }
    UI.renderChampionship(s.drivers, s.teams, sub, key);
    btns.push({ label: '메인 메뉴', cls: done ? 'primary' : 'ghost', onClick: toMenu });
    UI.buttons('champBtns', btns);
    go('champ');
  }

  function startGPRound() {
    App.spec = global.TRACKS[App.gp.round];
    App.laps = App.spec.gpLaps;
    var entries = simulateQuali();
    UI.renderQuali(entries, App.spec);
    $('qualiSub').textContent = '라운드 ' + (App.gp.round + 1) + ' · ' + App.spec.flag + ' ' + App.spec.name +
      ' · ' + App.spec.gpLaps + '랩';
    App.pendingEntries = entries;
    go('quali');
  }

  function toMenu() {
    App.race = null;
    App.history = [];
    global.SFX.engine(null, false);
    UI.show('menu');
  }

  /* ================= 메뉴 플로우 ================= */
  function openTeamSelect() {
    UI.buildTeams(function (team) {
      App.team = team;
      UI.buildDrivers(team, function (d) {
        App.driver = d;
        if (App.mode === 'gp') openSetup();
        else openTrackSelect();
      });
      go('driverSelect');
    });
    $('teamSelectSub').textContent = App.mode === 'gp'
      ? '그랜드 프릭스 — 이 팀으로 5개 라운드를 치른다'
      : '2026 시즌 10개 팀 · 20명의 드라이버';
    go('teamSelect');
  }

  function openTrackSelect() {
    UI.buildTracks(function (spec) {
      App.spec = spec;
      openSetup();
    }, false);
    go('trackSelect');
  }

  function openSetup() {
    var isGP = App.mode === 'gp';
    var isPr = App.mode === 'practice';
    $('setupSub').textContent = isGP
      ? '그랜드 프릭스 · ' + global.TRACKS.length + '라운드 챔피언십 (랩 수는 서킷별 고정)'
      : (App.spec.flag + ' ' + App.spec.name + ' · ' + (App.spec.realLength / 1000).toFixed(3) + 'km');

    var lapOpts = [3, 5, 8, 12].map(function (v) { return { label: v + '랩', value: v }; });
    if (isGP || isPr) {
      $('optLaps').parentElement.style.display = 'none';
    } else {
      $('optLaps').parentElement.style.display = '';
      if ([3, 5, 8, 12].indexOf(App.laps) < 0) App.laps = 5;
      UI.buildOptions('optLaps', lapOpts, App.laps, function (v) { App.laps = v; });
    }

    UI.buildOptions('optDiff', Object.keys(F1.DIFFICULTY).map(function (k) {
      return { label: F1.DIFFICULTY[k].label, value: k };
    }), App.difficulty, function (v) { App.difficulty = v; });

    UI.buildOptions('optTyre', F1.TYRE_ORDER.map(function (k) {
      return { label: F1.TYRES[k].label, value: k };
    }), App.tyre, function (v) { App.tyre = v; });

    UI.buildOptions('optLine', [
      { label: '켜기', value: true }, { label: '끄기', value: false }
    ], App.guide, function (v) {
      App.guide = v;
      if (App.renderer) App.renderer.showLine = v;
    });

    $('setupNote').innerHTML = isPr
      ? '연습장은 순위도 제한 시간도 없다. 피트레인에 들어가 박스에 정지하면 타이어를 교체할 수 있다.'
      : '레이스 중 <b>최소 1회 피트인</b>이 필요하다. 타이어가 닳으면 랩타임이 1초 이상 무너진다.';

    $('toQuali').textContent = isPr ? '주행 시작' : (isGP ? '시즌 시작' : '예선으로');
    go('setup');
  }

  function toQuali() {
    if (App.mode === 'practice') { startPractice(); return; }
    if (App.mode === 'gp') {
      App.gp = { round: 0, points: {}, teamPts: {} };
      startGPRound();
      return;
    }
    var entries = simulateQuali();
    UI.renderQuali(entries, App.spec);
    App.pendingEntries = entries;
    go('quali');
  }

  /* ================= 입력 ================= */
  var KEY = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'space', ShiftLeft: 'shift', ShiftRight: 'shift'
  };

  function onKey(e, down) {
    if (UI.screen === 'intro' && down) { endIntro(); return; }
    var k = KEY[e.code];
    if (k) { input[k] = down; e.preventDefault(); }
    if (!down) return;

    if (UI.screen !== 'game') return;
    if (e.code === 'Escape') togglePause();
    if (e.code === 'KeyM') {
      var on = global.SFX.toggle();
      UI.big(on ? 'SOUND ON' : 'MUTE', '#9aa3b2');
    }
    if (e.code === 'KeyL') {
      App.guide = !App.guide;
      App.renderer.showLine = App.guide;
      UI.big(App.guide ? '가이드 ON' : '가이드 OFF', '#37c6ff');
    }
    if (e.code === 'KeyC') UI.big('카메라 — ' + App.renderer.cycleCamera(), '#7dd3ff');
    if (e.code === 'KeyR') resetToTrack();
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      var c = { Digit1: 'soft', Digit2: 'medium', Digit3: 'hard' }[e.code];
      App.race.playerNextCompound = c;
      UI.big('다음 타이어 ' + F1.TYRES[c].label, F1.TYRES[c].color);
    }
  }

  function resetToTrack() {
    var race = App.race, p = race.player;
    if (!p || p.pitState === 'stopped') return;
    var t = race.track, i = p.trackIdx;
    var pt = t.race[i];
    p.x = pt[0]; p.y = pt[1];
    p.heading = Math.atan2(t.T[i][1], t.T[i][0]);
    var v = Math.min(p.speed, 22);
    p.vx = Math.cos(p.heading) * v; p.vy = Math.sin(p.heading) * v;
    p.spinTimer = 0;
    UI.big('트랙 복귀', '#ffcc33');
  }

  function togglePause() {
    App.paused = !App.paused;
    $('pause').classList.toggle('active', App.paused);
    if (!App.paused) { lastTs = performance.now(); global.SFX.resume(); }
    else global.SFX.engine(null, false);
  }

  /* ================= 리사이즈 ================= */
  function resize() {
    if (!App.renderer) return;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    App.renderer.resize(global.innerWidth, global.innerHeight, dpr);
  }

  /* ================= 부팅 ================= */
  function boot() {
    UI.init();

    document.querySelectorAll('.menu-item').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mode');
        global.SFX.init(); global.SFX.resume();
        if (m === 'help') { go('help'); return; }
        App.mode = m;
        openTeamSelect();
      });
    });

    document.querySelectorAll('[data-back]').forEach(function (b) {
      b.addEventListener('click', back);
    });

    $('toQuali').addEventListener('click', toQuali);
    $('toRace').addEventListener('click', function () { startRace(App.pendingEntries); });
    $('pauseResume').addEventListener('click', togglePause);
    $('pauseRestart').addEventListener('click', function () {
      App.paused = false;
      $('pause').classList.remove('active');
      if (App.mode === 'practice') startPractice();
      else startRace(simulateQuali());
    });
    $('pauseQuit').addEventListener('click', function () {
      App.paused = false;
      $('pause').classList.remove('active');
      toMenu();
    });

    global.addEventListener('keydown', function (e) { onKey(e, true); });
    global.addEventListener('keyup', function (e) { onKey(e, false); });
    global.addEventListener('resize', resize);
    global.addEventListener('blur', function () {
      input.up = input.down = input.left = input.right = input.space = input.shift = false;
    });

    runIntro();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
