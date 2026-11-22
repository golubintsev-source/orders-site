/** Два негромких «дзинь» при открытии чата. Звук создаётся в момент нажатия. */
let audioContext;

export function playFinanceChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    const start = audioContext.currentTime + 0.02;
    // Слегка расстроенные обертоны дают тембр монет, короткое затухание — мягкий звон.
    for (const [delay, frequency] of [[0, 988], [0.42, 1319]]) {
      for (const [multiple, volume] of [[1, 0.07], [2.01, 0.025], [2.73, 0.013]]) {
        const oscillator = audioContext.createOscillator();
        const envelope = audioContext.createGain();
        const at = start + delay;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * multiple, at);
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(volume, at + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 1.03);
        oscillator.connect(envelope);
        envelope.connect(audioContext.destination);
        oscillator.start(at);
        oscillator.stop(at + 1.05);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      }
    }
  } catch (error) {
    console.warn("Звук финансового директора недоступен:", error);
  }
}
