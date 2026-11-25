/**
 * Festive Sports Day Sound Synthesizer (Web Audio API - Zero external audio assets needed)
 */
(function (global) {
  let ctx = null;
  let muted = false;

  function ensureCtx() {
    if (muted) return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, type, duration, vol = 0.15, delay = 0, slideTo = null) {
    const c = ensureCtx();
    if (!c) return;
    const start = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    }
    gain.gain.setValueAtTime(Math.max(0.001, vol), start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noiseBurst(duration = 0.25, vol = 0.2, delay = 0) {
    const c = ensureCtx();
    if (!c) return;
    const start = c.currentTime + delay;
    const bufSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.35));
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    src.connect(gain);
    gain.connect(c.destination);
    src.start(start);
  }

  const SoundFX = {
    unlock() {
      ensureCtx();
    },
    setMuted(val) {
      muted = !!val;
    },
    isMuted() {
      return muted;
    },
    // Countdown beep (3, 2, 1)
    beep() {
      tone(660, 'triangle', 0.16, 0.2);
    },
    // Sports day whistle + start chime!
    whistleStart() {
      const c = ensureCtx();
      if (!c) return;
      // Trill whistle effect
      for (let i = 0; i < 8; i++) {
        tone(i % 2 === 0 ? 2650 : 2850, 'sine', 0.06, 0.16, i * 0.05);
      }
      tone(880, 'triangle', 0.25, 0.2, 0.05, 1320);
    },
    // Player tap beanbag sound (alternating pitch for left/right!)
    tap(side) {
      const f = side === 'left' ? 440 : 554.37;
      tone(f, 'sine', 0.065, 0.11, 0, f * 1.25);
    },
    // Soft beanbag thud on projector gourd
    gourdHit() {
      tone(190 + Math.random() * 90, 'triangle', 0.05, 0.06, 0, 95);
    },
    // Gourd cracking open + celebratory fanfare!
    gourdBurstFanfare() {
      noiseBurst(0.45, 0.32, 0);
      tone(140, 'sawtooth', 0.3, 0.22, 0, 55);
      // Trumpet fanfare: C5 - E5 - G5 - C6!
      const notes = [
        [523.25, 0.12, 0.15],
        [659.25, 0.25, 0.15],
        [783.99, 0.38, 0.15],
        [1046.5, 0.52, 0.55]
      ];
      for (const [f, d, len] of notes) {
        tone(f, 'triangle', len, 0.22, d);
        tone(f * 0.5, 'sawtooth', len, 0.08, d);
      }
    },
    // Personal winner chime on phone/laptop
    winChime() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, idx) => {
        tone(f, 'triangle', 0.28, 0.18, idx * 0.09);
      });
    }
  };

  global.SoundFX = SoundFX;
})(typeof window !== 'undefined' ? window : globalThis);

