// audio.js - Web Audio API 사운드 엔진
//
// 이전에는 7개 메서드가 전부 "osc 만들고 gain 만들고 연결하고 start/stop" 하는
// 동일한 10줄 보일러플레이트를 복붙하고 있었다.
// 여기서는 tone()/sequence() 두 프리미티브만 두고 각 효과음은 파라미터로 기술한다.

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) this.ctx = new AudioCtx();
    return this.ctx;
  }

  /**
   * 단일 톤 재생.
   * @param {object} o
   *   type      오실레이터 파형
   *   from/to   주파수 (to를 주면 exponential 스윕)
   *   gain      시작 볼륨
   *   duration  길이(초)
   *   delay     시작 지연(초)
   */
  tone({ type = 'sine', from = 440, to = null, gain = 0.2, duration = 0.2, delay = 0 }) {
    if (this.muted) return;
    const ctx = this.init();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const end = start + duration;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(to, end);

    gainNode.gain.setValueAtTime(gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.01, end);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(start);
    osc.stop(end);
  }

  /** 주파수 배열을 일정 간격으로 이어서 재생 (아르페지오) */
  sequence(freqs, { type = 'sine', gain = 0.15, step = 0.05, duration = 0.2, typeOfFirst = null } = {}) {
    if (this.muted) return;
    freqs.forEach((f, i) => {
      this.tone({
        type: (i === 0 && typeOfFirst) ? typeOfFirst : type,
        from: f,
        gain,
        duration,
        delay: i * step
      });
    });
  }

  playDraw() {
    this.tone({ type: 'sine', from: 520, to: 880, gain: 0.12, duration: 0.08 });
  }

  playSlash() {
    this.tone({ type: 'sawtooth', from: 600, to: 100, gain: 0.25, duration: 0.18 });
  }

  playShield() {
    this.tone({ type: 'sine', from: 220, to: 440, gain: 0.2, duration: 0.25 });
  }

  playCrit() {
    this.tone({ type: 'sawtooth', from: 800, to: 150, gain: 0.3, duration: 0.22 });
  }

  playMagic() {
    this.sequence([523, 659, 784, 1046], { type: 'sine', gain: 0.1, step: 0.04, duration: 0.2 });
  }

  playSummon() {
    this.sequence([110, 164, 220, 330, 440], { type: 'sine', typeOfFirst: 'sawtooth', gain: 0.18, step: 0.06, duration: 0.35 });
  }

  playVictory() {
    this.sequence([523, 659, 784, 1046, 1318], { type: 'triangle', gain: 0.2, step: 0.08, duration: 0.4 });
  }
}

const rawAudio = new SoundEngine();

// 아직 정의되지 않은 효과음을 호출해도 터지지 않도록 no-op으로 흡수한다.
export const audio = new Proxy(rawAudio, {
  get(target, prop) {
    if (prop in target) {
      return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
    }
    return () => {};
  }
});

export function toggleMute() {
  audio.muted = !audio.muted;
  const icon = document.getElementById('sound-icon');
  if (!icon) return;
  if (audio.muted) {
    icon.setAttribute('data-lucide', 'volume-x');
    icon.classList.add('text-red-400');
  } else {
    icon.setAttribute('data-lucide', 'volume-2');
    icon.classList.remove('text-red-400');
  }
  if (window.lucide) window.lucide.createIcons();
}
