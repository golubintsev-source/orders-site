// Direct Image API standard rates, USD per million tokens. Never guess usage when absent.
const RATES = {
  "gpt-image-2.5-sunburst": { imageInput: 4, imageOutput: 15, textInput: 2.5 },
  "gpt-image-2.5-flare": { imageInput: 4, imageOutput: 15, textInput: 2.5 },
};
let cachedRate = null;

function calculateImageCostRub(usage, usdRub, model) {
  const rates = RATES[model];
  const input = usage?.input_tokens_details;
  const output = usage?.output_tokens_details;
  if (!rates || !Number.isFinite(usdRub) || usdRub <= 0 ||
      !Number.isSafeInteger(input?.image_tokens) || input.image_tokens < 0 ||
      !Number.isSafeInteger(input?.text_tokens) || input.text_tokens < 0 ||
      !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) return null;
  // Image edits normally produce only image tokens. Unknown text-output pricing is not guessed.
  if (output && (!Number.isSafeInteger(output.image_tokens) || output.image_tokens < 0 ||
      !Number.isSafeInteger(output.text_tokens) || output.text_tokens !== 0)) return null;
  const imageOutput = output ? output.image_tokens : usage.output_tokens;
  return ((input.image_tokens * rates.imageInput +
    input.text_tokens * rates.textInput + imageOutput * rates.imageOutput) / 1_000_000) * usdRub;
}

async function getUsdRubRate() {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < 12 * 60 * 60 * 1000) return cachedRate.value;
  const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", {
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw new Error(`cbr_${response.status}`);
  const xml = await response.text();
  const usd = xml.match(/<Valute\b[^>]*ID="R01235"[^>]*>([\s\S]*?)<\/Valute>/i)?.[1];
  const value = Number(usd?.match(/<Value>([\d,]+)<\/Value>/i)?.[1]?.replace(",", "."));
  const nominal = Number(usd?.match(/<Nominal>(\d+)<\/Nominal>/i)?.[1]);
  if (!Number.isFinite(value) || !Number.isFinite(nominal) || value <= 0 || nominal <= 0) throw new Error("invalid_cbr_rate");
  cachedRate = { value: value / nominal, fetchedAt: Date.now() };
  return cachedRate.value;
}

module.exports = { calculateImageCostRub, getUsdRubRate };
