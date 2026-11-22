/** Короткая россыпь монет при открытии чата; запускается в обработчике нажатия. */
let audioContext;

export function playFinanceChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    const ctx = audioContext;
    const start = ctx.currentTime + 0.02;

    // Удары сбиваются в группы, как монеты, падающие на другие монеты.
    const impacts = [0, 0.055, 0.13, 0.19, 0.27, 0.30, 0.38, 0.47,
      0.52, 0.61, 0.67, 0.76, 0.84, 0.94, 1.04, 1.17];
    const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.035), ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;

    for (const [index, delay] of impacts.entries()) {
      const at = start + delay;
      const strength = (0.75 + Math.random() * 0.5) * (1 - index / impacts.length * 0.43);
      const pitch = 1550 + Math.random() * 1400;
      const ring = 0.13 + Math.random() * 0.15;

      // Неравномерные обертоны и резкий удар создают металлический стук без мелодии.
      for (const [ratio, level] of [[1, 0.034], [1.57, 0.016], [2.42, 0.007]]) {
        const tone = ctx.createOscillator();
        const gain = ctx.createGain();
        tone.type = "sine";
        tone.frequency.setValueAtTime(pitch * ratio, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(level * strength, at + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        tone.connect(gain);
        gain.connect(ctx.destination);
        tone.start(at);
        tone.stop(at + ring + 0.01);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      }

      const strike = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const strikeGain = ctx.createGain();
      strike.buffer = noise;
      filter.type = "highpass";
      filter.frequency.value = 1800 + Math.random() * 1200;
      strikeGain.gain.setValueAtTime(0.0001, at);
      strikeGain.gain.exponentialRampToValueAtTime(0.027 * strength, at + 0.002);
      strikeGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      strike.connect(filter);
      filter.connect(strikeGain);
      strikeGain.connect(ctx.destination);
      strike.start(at);
      strike.stop(at + 0.035);
      strike.onended = () => { strike.disconnect(); filter.disconnect(); strikeGain.disconnect(); };
    }
  } catch (error) {
    console.warn("Звук монет недоступен:", error);
  }
}
