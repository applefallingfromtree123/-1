/* =========================================================================
 * F1 THE GAME - Teams, drivers, tyres, rules
 * ========================================================================= */
(function (global) {
  'use strict';

  /* pace: 1.0 = 기준. 값이 클수록 빠르다 (엔진 출력 / 그립에 반영)
     drivers.skill: AI 주행 수준 (0~1), tyre: 타이어 관리, agg: 공격성 */
  var TEAMS = [
    {
      id: 'mclaren', name: 'McLaren', full: '맥라렌',
      color: '#ff8000', accent: '#0b1a2b', pace: 1.000,
      drivers: [
        { num: 4, code: 'NOR', name: '랜도 노리스', skill: 0.985, tyre: 0.93, agg: 0.78 },
        { num: 81, code: 'PIA', name: '오스카 피아스트리', skill: 0.982, tyre: 0.96, agg: 0.72 }
      ]
    },
    {
      id: 'ferrari', name: 'Ferrari', full: '페라리',
      color: '#e8002d', accent: '#f5e600', pace: 0.988,
      drivers: [
        { num: 16, code: 'LEC', name: '샤를 르클레르', skill: 0.980, tyre: 0.90, agg: 0.82 },
        { num: 44, code: 'HAM', name: '루이스 해밀턴', skill: 0.975, tyre: 0.97, agg: 0.74 }
      ]
    },
    {
      id: 'redbull', name: 'Red Bull Racing', full: '레드불 레이싱',
      color: '#2540a8', accent: '#e2001a', pace: 0.992,
      drivers: [
        { num: 1, code: 'VER', name: '막스 페르스타펜', skill: 0.995, tyre: 0.95, agg: 0.88 },
        { num: 22, code: 'TSU', name: '츠노다 유키', skill: 0.945, tyre: 0.86, agg: 0.80 }
      ]
    },
    {
      id: 'mercedes', name: 'Mercedes', full: '메르세데스',
      color: '#00d7b6', accent: '#1b1b1b', pace: 0.985,
      drivers: [
        { num: 63, code: 'RUS', name: '조지 러셀', skill: 0.978, tyre: 0.92, agg: 0.76 },
        { num: 12, code: 'ANT', name: '키미 안토넬리', skill: 0.952, tyre: 0.88, agg: 0.79 }
      ]
    },
    {
      id: 'aston', name: 'Aston Martin', full: '애스턴 마틴',
      color: '#00594f', accent: '#cedc00', pace: 0.972,
      drivers: [
        { num: 14, code: 'ALO', name: '페르난도 알론소', skill: 0.968, tyre: 0.98, agg: 0.84 },
        { num: 18, code: 'STR', name: '랜스 스트롤', skill: 0.930, tyre: 0.87, agg: 0.70 }
      ]
    },
    {
      id: 'williams', name: 'Williams', full: '윌리엄스',
      color: '#1868db', accent: '#ffffff', pace: 0.970,
      drivers: [
        { num: 23, code: 'ALB', name: '알렉스 알본', skill: 0.958, tyre: 0.93, agg: 0.73 },
        { num: 55, code: 'SAI', name: '카를로스 사인츠', skill: 0.962, tyre: 0.91, agg: 0.77 }
      ]
    },
    {
      id: 'rb', name: 'Racing Bulls', full: '레이싱 불스',
      color: '#5e8fde', accent: '#e2001a', pace: 0.966,
      drivers: [
        { num: 30, code: 'LAW', name: '리암 로슨', skill: 0.940, tyre: 0.86, agg: 0.81 },
        { num: 6, code: 'HAD', name: '이자크 아자르', skill: 0.944, tyre: 0.89, agg: 0.75 }
      ]
    },
    {
      id: 'haas', name: 'Haas', full: '하스',
      color: '#b6babd', accent: '#e8002d', pace: 0.962,
      drivers: [
        { num: 31, code: 'OCO', name: '에스테반 오콘', skill: 0.942, tyre: 0.90, agg: 0.74 },
        { num: 87, code: 'BEA', name: '올리버 베어먼', skill: 0.936, tyre: 0.85, agg: 0.78 }
      ]
    },
    {
      id: 'alpine', name: 'Alpine', full: '알핀',
      color: '#0090ff', accent: '#ff87bc', pace: 0.958,
      drivers: [
        { num: 10, code: 'GAS', name: '피에르 가슬리', skill: 0.948, tyre: 0.88, agg: 0.79 },
        { num: 43, code: 'COL', name: '프랑코 콜라핀토', skill: 0.925, tyre: 0.83, agg: 0.76 }
      ]
    },
    {
      id: 'sauber', name: 'Kick Sauber', full: '킥 자우버',
      color: '#00e701', accent: '#1b1b1b', pace: 0.955,
      drivers: [
        { num: 27, code: 'HUL', name: '니코 휠켄베르크', skill: 0.946, tyre: 0.92, agg: 0.72 },
        { num: 5, code: 'BOR', name: '가브리엘 보르톨레토', skill: 0.922, tyre: 0.84, agg: 0.74 }
      ]
    }
  ];

  /* 타이어 컴파운드
     grip: 그립 배수 · wear: 마모 속도 · warm: 작동 온도 도달 계수
     세 단계의 페이스 간격이 고르고, 대신 수명 차이가 크도록 맞춰져 있다.
     desc / paceDelta / stint 는 선택 화면 안내용이며, 실버스톤 실측값 기준이다. */
  var TYRES = {
    soft:   { id: 'soft',   label: '소프트', short: 'S', color: '#ff2b2b',
              grip: 1.045, wear: 1.65, warm: 1.30,
              desc: '가장 빠름', paceDelta: -0.6, stint: 7 },
    medium: { id: 'medium', label: '미디엄', short: 'M', color: '#f5d20a',
              grip: 1.014, wear: 1.00, warm: 1.02,
              desc: '균형 — 기준 컴파운드', paceDelta: 0, stint: 10 },
    hard:   { id: 'hard',   label: '하드',   short: 'H', color: '#e8e8e8',
              grip: 0.994, wear: 0.60, warm: 0.88,
              desc: '오래감 · 워밍업 느림', paceDelta: 0.8, stint: 15 }
  };
  var TYRE_ORDER = ['soft', 'medium', 'hard'];

  var POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  var DIFFICULTY = {
    rookie:   { id: 'rookie',   label: '루키',       ai: 0.880, assist: 1.00 },
    amateur:  { id: 'amateur',  label: '아마추어',   ai: 0.925, assist: 1.00 },
    pro:      { id: 'pro',      label: '프로',       ai: 0.962, assist: 1.00 },
    legend:   { id: 'legend',   label: '레전드',     ai: 1.000, assist: 1.00 }
  };

  function allDrivers() {
    var out = [];
    for (var i = 0; i < TEAMS.length; i++) {
      for (var j = 0; j < TEAMS[i].drivers.length; j++) {
        out.push({ team: TEAMS[i], driver: TEAMS[i].drivers[j] });
      }
    }
    return out;
  }

  global.F1DATA = {
    TEAMS: TEAMS, TYRES: TYRES, TYRE_ORDER: TYRE_ORDER,
    POINTS: POINTS, DIFFICULTY: DIFFICULTY, allDrivers: allDrivers
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.F1DATA;
})(typeof window !== 'undefined' ? window : globalThis);
