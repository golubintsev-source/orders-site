/** Звук пользователя при открытии переписки с финансовым директором. */
const coinSound = typeof Audio === "undefined" ? null : new Audio("/audio/zvuk-monety.mp3?v=1");
if (coinSound) coinSound.preload = "auto";

export function playFinanceChime() {
  if (!coinSound) return;
  try {
    coinSound.currentTime = 0;
    const playback = coinSound.play();
    if (playback?.catch) void playback.catch((error) => {
      console.warn("Не удалось воспроизвести звук монет:", error);
    });
  } catch (error) {
    console.warn("Не удалось воспроизвести звук монет:", error);
  }
}
