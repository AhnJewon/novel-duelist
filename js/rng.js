// rng.js - 결정론적 난수 생성기
//
// 왜 필요한가:
//   전투에 Math.random()이 9곳 있었다 — 덱 셔플, 손패 파기 대상, 소환수 선택 등.
//   나중에 P2P 대전을 붙이면 양쪽 클라이언트가 **같은 시드로 같은 결과**를 내야
//   한다(락스텝). Math.random()은 그게 불가능하다.
//
// 지금 당장의 이득:
//   같은 시드로 전투를 재현할 수 있다. "이 상황에서 버그가 난다"를 그대로 되살릴 수 있다.
//
// ⚠️ 전투 로직의 무작위는 **전부 여기를 거쳐야 한다.** Math.random()을 직접 쓰면
//    그 지점에서 동기화가 깨진다. (카드 생성·이미지 등 전투 밖은 상관없다)

/** mulberry32 — 작고 빠르며 분포가 균일하다. 32비트 시드 하나로 재현된다. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRng {
  constructor(seed) {
    this.seed = (seed >>> 0) || 1;
    this._next = mulberry32(this.seed);
    this.calls = 0;   // 동기화 검증용 — 양쪽 클라이언트의 호출 횟수가 같아야 한다
  }

  /** 0 이상 1 미만 */
  next() {
    this.calls++;
    return this._next();
  }

  /** min 이상 max 이하 정수 */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 0 이상 n 미만 정수 (배열 인덱스용) */
  index(n) {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }

  /** 배열에서 하나 고르기 */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[this.index(arr.length)];
  }

  /**
   * Fisher-Yates 셔플 — 새 배열을 돌려준다.
   * ⚠️ `sort(() => 0.5 - random())`은 쓰지 마세요.
   *    분포가 균일하지 않고 엔진마다 결과가 달라 동기화가 깨집니다.
   *    (기존 코드가 전부 그 방식이었다)
   */
  shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.index(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** 확률 p로 true */
  chance(p) {
    return this.next() < p;
  }

  /** 현재 상태 스냅샷 (동기화 검증/디버깅용) */
  snapshot() {
    return { seed: this.seed, calls: this.calls };
  }
}

// 전투 전역 인스턴스. initBattle()이 매 전투마다 새 시드로 교체한다.
let _battleRng = new SeededRng(1);

/** 전투 시작 시 호출. 시드를 주지 않으면 시계 기반으로 새로 만든다. */
export function seedBattleRng(seed = null) {
  const s = (seed === null || seed === undefined)
    ? (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0
    : seed >>> 0;
  _battleRng = new SeededRng(s);
  return s;
}

/** 현재 전투 RNG */
export function battleRng() {
  return _battleRng;
}

/** 지금 전투의 시드 (상대에게 넘기거나 로그에 남길 때) */
export function currentBattleSeed() {
  return _battleRng.seed;
}
