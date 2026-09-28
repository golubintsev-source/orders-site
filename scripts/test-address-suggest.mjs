import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const handler = require("../api/address-suggest.js");
const source = await readFile(new URL("../js/clientAutocomplete.js", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../api/address-suggest.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../style.css", import.meta.url), "utf8");
const swSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

const items = handler.mapDadataSuggestions({
  suggestions: [
    {
      value: "г Волгоград, ул Мира, д 10",
      data: { city_with_type: "г Волгоград", postal_code: "400066" },
    },
    {
      value: "г Волгоград, ул Мира, д 10",
      data: { city_with_type: "г Волгоград" },
    },
    {
      value: "г Волгоград, пр-кт им В.И. Ленина, д 5",
      data: { city_with_type: "г Волгоград" },
    },
  ],
});

assert.deepEqual(items, [
  {
    value: "г Волгоград, ул Мира, д 10",
    title: "г Волгоград, ул Мира, д 10",
  },
  {
    value: "г Волгоград, пр-кт им В.И. Ленина, д 5",
    title: "г Волгоград, пр-кт им В.И. Ленина, д 5",
  },
]);
assert.match(source, /fetch\(`\/api\/address-suggest\?\$\{params\}`/);
assert.match(source, /Authorization: `Bearer \$\{token\}`/);
assert.match(source, /mergeAddressSuggestions\(localItems, remoteItems\)/);
assert.match(source, /ADDRESS_DEBOUNCE_MS = 280/);
assert.match(apiSource, /env\("DADATA_API_KEY"\)/);
assert.match(apiSource, /suggestions\.dadata\.ru\/suggestions\/api\/4_1\/rs\/suggest\/address/);
assert.match(apiSource, /locations_boost: \[\{ kladr_id: VOLGOGRAD_KLADR_ID \}\]/);
assert.doesNotMatch(source, /address-suggestion-subtitle/);
assert.doesNotMatch(apiSource, /postal_code/);
assert.match(styleSource, /#addressSuggestions \.client-suggestion-text[\s\S]*white-space: normal/);
assert.match(swSource, /orders-site-static-v62/);

console.log("address suggest tests: ok");
