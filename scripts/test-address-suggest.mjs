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
      data: {
        region_with_type: "Волгоградская обл",
        city_with_type: "г Волгоград",
        street_with_type: "ул Мира",
        house_type: "д",
        house: "10",
        flat_type: "кв",
        flat: "7",
        postal_code: "400066",
      },
    },
    {
      value: "г Волгоград, ул Мира, д 10",
      data: {
        city_with_type: "г Волгоград",
        street_with_type: "ул Мира",
        house_type: "д",
        house: "10",
        flat_type: "кв",
        flat: "7",
      },
    },
    {
      value: "г Волгоград, пр-кт им В.И. Ленина, д 5",
      data: {
        city_with_type: "г Волгоград",
        street_with_type: "пр-кт им В.И. Ленина",
        house_type: "д",
        house: "5",
        block_type: "корп",
        block: "2",
      },
    },
  ],
});

assert.deepEqual(items, [
  {
    value: "ул Мира, д 10, кв 7, г Волгоград, Волгоградская обл",
    title: "ул Мира, д 10, кв 7, г Волгоград, Волгоградская обл",
  },
  {
    value: "пр-кт им В.И. Ленина, д 5, корп 2, г Волгоград",
    title: "пр-кт им В.И. Ленина, д 5, корп 2, г Волгоград",
  },
]);
assert.equal(
  handler.formatDadataAddress({
    value: "г Волгоград, ул Рабоче-Крестьянская, д 20, стр 1, кв 14",
    data: {
      city_with_type: "г Волгоград",
      street_with_type: "ул Рабоче-Крестьянская",
      house_type: "д",
      house: "20",
      block_type: "стр",
      block: "1",
      flat_type: "кв",
      flat: "14",
    },
  }),
  "ул Рабоче-Крестьянская, д 20, стр 1, кв 14, г Волгоград",
);
assert.equal(
  handler.formatDadataAddress({
    value: "Волгоградская обл, Городищенский р-н, село Виновка, тер. СНТ Серебряные родники",
    data: {
      region_with_type: "Волгоградская обл",
      area_with_type: "Городищенский р-н",
      settlement_with_type: "село Виновка",
    },
  }),
  "село Виновка, тер. СНТ Серебряные родники, Городищенский р-н, Волгоградская обл",
);
assert.equal(
  handler.formatDadataAddress({
    value: "Волгоградская обл, г Камышин, ул Ленина, д 12",
    data: {
      region_with_type: "Волгоградская обл",
      city_with_type: "г Камышин",
      street_with_type: "ул Ленина",
      house_type: "д",
      house: "12",
    },
  }),
  "г Камышин, ул Ленина, д 12, Волгоградская обл",
);
assert.equal(
  handler.formatDadataAddress({
    value: "г Волжский, ул Мира, д 25, Волгоградская обл",
    data: {
      region_with_type: "Волгоградская обл",
      city_with_type: "г Волжский",
      street_with_type: "ул Мира",
      house_type: "д",
      house: "25",
    },
  }),
  "г Волжский, ул Мира, д 25, Волгоградская обл",
);
assert.equal(
  handler.formatDadataAddress({
    value: "город Волжский, пр-кт Ленина, д 3",
    data: {
      city_with_type: "город Волжский",
      street_with_type: "пр-кт Ленина",
      house_type: "д",
      house: "3",
    },
  }),
  "город Волжский, пр-кт Ленина, д 3",
);
assert.equal(
  handler.formatDadataAddress({
    value: "Волгоградская область, Среднеахтубинский район, рп Средняя Ахтуба, ул Октябрьская, д 8",
    data: {
      region_with_type: "Волгоградская область",
      area_with_type: "Среднеахтубинский район",
      settlement_with_type: "рп Средняя Ахтуба",
    },
  }),
  "рп Средняя Ахтуба, ул Октябрьская, д 8, Среднеахтубинский район, Волгоградская область",
);
assert.equal(
  handler.formatDadataAddress({
    value: "Ростовская обл, г Ростов-на-Дону, ул Пушкинская, д 1",
    data: {
      region_with_type: "Ростовская обл",
      city_with_type: "г Ростов-на-Дону",
      street_with_type: "ул Пушкинская",
      house_type: "д",
      house: "1",
    },
  }),
  "Ростовская обл, г Ростов-на-Дону, ул Пушкинская, д 1",
);
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
assert.match(swSource, /orders-site-static-v67/);

console.log("address suggest tests: ok");
