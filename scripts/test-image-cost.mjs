import test from "node:test";
import assert from "node:assert/strict";
import costModule from "../server/image-cost.js";

const { calculateImageCostRub, getUsdRubRate } = costModule;

test("image edit includes image input, text input, and image output", () => {
  const usage = {
    input_tokens_details: { image_tokens: 1000, text_tokens: 200 },
    output_tokens: 4000,
    output_tokens_details: { image_tokens: 4000, text_tokens: 0 },
  };
  assert.equal(calculateImageCostRub(usage, 80, "gpt-image-2.5-sunburst"), 5.16);
  assert.equal(calculateImageCostRub({ ...usage, output_tokens_details: undefined }, 80, "gpt-image-2.5-sunburst"), 5.16);
});

test("missing or ambiguous usage never displays a fabricated price", () => {
  assert.equal(calculateImageCostRub(undefined, 80, "gpt-image-2.5-sunburst"), null);
  assert.equal(calculateImageCostRub({ input_tokens_details: { image_tokens: 1, text_tokens: 1 }, output_tokens: 2,
    output_tokens_details: { image_tokens: 1, text_tokens: 1 } }, 80, "gpt-image-2.5-sunburst"), null);
  assert.equal(calculateImageCostRub({ input_tokens_details: { image_tokens: 1, text_tokens: 1 }, output_tokens: 2 }, 80, "unknown"), null);
});

test("CBR exchange rate honors the currency nominal", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => '<ValCurs><Valute ID="R01235"><Nominal>10</Nominal><Value>821,9110</Value></Valute></ValCurs>' });
  try { assert.ok(Math.abs((await getUsdRubRate()) - 82.1911) < 1e-8); }
  finally { global.fetch = originalFetch; }
});
