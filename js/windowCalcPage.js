import { calculateWindow } from "./windowCalculator.js";

function setMessage(text, isError) {
  const el = document.getElementById("windowCalcMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#d32f2f" : "";
}

const SCHEMA_LABELS = {
  fixed: "Глухое",
  one_sash: "Одна створка",
  one_sash_left_fixed: "Створка слева + глухое справа",
  fixed_left_one_sash: "Глухое слева + створка справа",
};

// Русские названия элементов и типов профиля
function elementLabelRu(element) {
  if (!element) return "";
  const s = String(element);
  if (s.startsWith("arm_")) return "Арм. " + elementLabelRu(s.slice(4));
  const map = {
    frame_top: "Рама верх",
    frame_bottom: "Рама низ",
    frame_left: "Рама левая",
    frame_right: "Рама правая",
    impost_vertical: "Импост вертикальный",
    sash_top: "Створка верх",
    sash_bottom: "Створка низ",
    sash_left: "Створка левая",
    sash_right: "Створка правая",
    sash_top_left: "Створка верх (левая)",
    sash_bottom_left: "Створка низ (левая)",
    sash_right_impost_side: "Створка правая (импост)",
    sash_left_impost_side: "Створка левая (импост)",
    sash_top_right: "Створка верх (правая)",
    sash_bottom_right: "Створка низ (правая)",
    main_glazing: "Стеклопакет (глухой)",
    sash_glazing: "Стеклопакет створки",
    sash_glazing_left: "Стеклопакет створки левой",
    sash_glazing_right: "Стеклопакет створки правой",
    fixed_glazing_right: "Стеклопакет глухой (правый)",
    fixed_glazing_left: "Стеклопакет глухой (левый)",
    sash_1: "Створка 1",
  };
  return map[s] || s;
}

function profileLabelRu(profile) {
  const map = {
    frame: "Рама",
    sash: "Створка",
    impost: "Импост",
    frame_reinforcement: "Армирование рамы",
    sash_reinforcement: "Армирование створки",
    impost_reinforcement: "Армирование импоста",
    bead: "Штапик",
  };
  return map[profile] || profile;
}

function hardwareElementLabelRu(id) {
  const map = { sash_1: "Створка 1", sash_left: "Створка левая", sash_right: "Створка правая" };
  return map[id] || id;
}

function buildDiagramSvg({ widthMm, heightMm, schema, leftPartWidthMm, openingSide, openingType }) {
  const vbW = 760;
  const vbH = 260;
  const padL = 70;
  const padT = 24;
  const padR = 24;
  const padB = 52;

  // Область под рисунок окна; вписываем с сохранением пропорций widthMm : heightMm
  const maxW = vbW - padL - padR;
  const maxH = vbH - padT - padB;
  const aspect = widthMm / heightMm;
  let rectW; let rectH;
  if (aspect >= maxW / maxH) {
    rectW = maxW;
    rectH = maxW / aspect;
  } else {
    rectH = maxH;
    rectW = maxH * aspect;
  }
  const rectX = padL + (maxW - rectW) / 2;
  const rectY = padT + (maxH - rectH) / 2;

  const hasImpost = schema === "one_sash_left_fixed" || schema === "fixed_left_one_sash";
  const leftW = typeof leftPartWidthMm === "number" && Number.isFinite(leftPartWidthMm) && leftPartWidthMm > 0
    ? leftPartWidthMm
    : widthMm / 2;

  const impostX = hasImpost ? rectX + (leftW / widthMm) * rectW : null;

  const sashSide =
    schema === "one_sash" ? "full" :
    schema === "one_sash_left_fixed" ? "left" :
    schema === "fixed_left_one_sash" ? "right" :
    null;

  // Петли: слева true, справа false (сторона открывания = где ручка; петли с противоположной стороны)
  const hingeLeft =
    sashSide === "full" ? openingSide === "left" :
    sashSide === "left" ? openingSide === "left" :
    sashSide === "right" ? openingSide === "left" :
    false;

  // Прямоугольник створки внутри рамы
  let sx; let sy; let sw; let sh;
  if (sashSide === "full") {
    sx = rectX + 6; sy = rectY + 6; sw = rectW - 12; sh = rectH - 12;
  } else if (sashSide === "left" && impostX != null) {
    sx = rectX + 6; sy = rectY + 6; sw = (impostX - rectX) - 12; sh = rectH - 12;
  } else if (sashSide === "right" && impostX != null) {
    sx = impostX + 6; sy = rectY + 6; sw = (rectX + rectW - impostX) - 12; sh = rectH - 12;
  } else {
    sx = rectX; sy = rectY; sw = rectW; sh = rectH;
  }

  const lineStroke = 'stroke="#1f6feb" stroke-width="1.5"';
  // Открывание: шеврон от стороны петель к середине противоположной (как на фото — петли слева, галочка вправо)
  let openingChevron = "";
  if (sashSide != null && sw > 0 && sh > 0) {
    const midY = sy + sh / 2;
    if (hingeLeft) {
      openingChevron = `<line x1="${sx}" y1="${sy}" x2="${sx + sw}" y2="${midY}" fill="none" ${lineStroke} /><line x1="${sx}" y1="${sy + sh}" x2="${sx + sw}" y2="${midY}" fill="none" ${lineStroke} />`;
    } else {
      openingChevron = `<line x1="${sx + sw}" y1="${sy}" x2="${sx}" y2="${midY}" fill="none" ${lineStroke} /><line x1="${sx + sw}" y1="${sy + sh}" x2="${sx}" y2="${midY}" fill="none" ${lineStroke} />`;
    }
  }

  const showTilt = (openingType === "turn_tilt" || openingType === "tilt_only") && sashSide != null;
  // Откидывание: перевёрнутая V — от нижних углов створки к середине верха (верх откидывается)
  let tiltPath = "";
  if (showTilt) {
    const topCenterX = sx + sw / 2;
    const topY = sy;
    const bottomY = sy + sh;
    tiltPath = [
      `<line x1="${sx}" y1="${bottomY}" x2="${topCenterX}" y2="${topY}" fill="none" ${lineStroke} />`,
      `<line x1="${sx + sw}" y1="${bottomY}" x2="${topCenterX}" y2="${topY}" fill="none" ${lineStroke} />`,
    ].join("");
  }

  const safe = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const schemaLabel = SCHEMA_LABELS[schema] || schema;

  return `
  <svg class="diagram-svg" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема окна">
    <defs>
      <marker id="arrowEnd" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#6b7280" />
      </marker>
      <marker id="arrowStart" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
        <path d="M0,0 L8,4 L0,8 Z" fill="#6b7280" />
      </marker>
    </defs>

    <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" fill="#f9fafb" stroke="#111827" stroke-width="2" />

    ${
      hasImpost
        ? `<line x1="${impostX}" y1="${rectY}" x2="${impostX}" y2="${rectY + rectH}" stroke="#111827" stroke-width="2" />`
        : ""
    }

    ${
      sashSide === "full"
        ? `<rect x="${rectX + 6}" y="${rectY + 6}" width="${rectW - 12}" height="${rectH - 12}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 6" />`
        : sashSide === "left" && hasImpost
          ? `<rect x="${rectX + 6}" y="${rectY + 6}" width="${(impostX - rectX) - 12}" height="${rectH - 12}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 6" />`
          : sashSide === "right" && hasImpost
            ? `<rect x="${impostX + 6}" y="${rectY + 6}" width="${(rectX + rectW - impostX) - 12}" height="${rectH - 12}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 6" />`
            : ""
    }

    ${openingChevron}

    ${tiltPath}

    <line x1="${rectX}" y1="${rectY + rectH + 22}" x2="${rectX + rectW}" y2="${rectY + rectH + 22}" stroke="#6b7280" stroke-width="1.5" marker-start="url(#arrowStart)" marker-end="url(#arrowEnd)" />
    <text x="${rectX + rectW / 2}" y="${rectY + rectH + 40}" text-anchor="middle" font-size="13" fill="#374151">${safe(widthMm)} мм</text>

    <line x1="${rectX - 32}" y1="${rectY}" x2="${rectX - 32}" y2="${rectY + rectH}" stroke="#6b7280" stroke-width="1.5" marker-start="url(#arrowStart)" marker-end="url(#arrowEnd)" />
    <text x="${rectX - 46}" y="${rectY + rectH / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 ${rectX - 46} ${rectY + rectH / 2})">${safe(heightMm)} мм</text>

    ${
      hasImpost
        ? `
          <line x1="${rectX}" y1="${rectY + rectH + 6}" x2="${impostX}" y2="${rectY + rectH + 6}" stroke="#9ca3af" stroke-width="1.5" marker-start="url(#arrowStart)" marker-end="url(#arrowEnd)" />
          <text x="${rectX + (impostX - rectX) / 2}" y="${rectY + rectH + 18}" text-anchor="middle" font-size="12" fill="#6b7280">${safe(Math.round(leftW))} мм</text>
        `
        : ""
    }
  </svg>
  `;
}

function renderResult(calc) {
  const container = document.getElementById("windowCalcResultContainer");
  if (!container) return;

  // Очищаем предыдущий результат
  container.innerHTML = "";

  if (!calc) {
    const p = document.createElement("p");
    p.className = "results-empty-text";
    p.textContent =
      "Введите размеры и нажмите «Рассчитать», чтобы увидеть размеры распила и стеклопакета.";
    container.appendChild(p);
    return;
  }

  // Схематичная картинка
  const diagramBlock = document.createElement("div");
  diagramBlock.className = "results-block";

  const diagramTitle = document.createElement("p");
  diagramTitle.className = "results-title";
  diagramTitle.textContent = "Схема";
  diagramBlock.appendChild(diagramTitle);

  const diagramWrap = document.createElement("div");
  diagramWrap.className = "diagram-wrap";
  diagramWrap.innerHTML = buildDiagramSvg({
    widthMm: calc?.input?.width,
    heightMm: calc?.input?.height,
    schema: calc?.type,
    leftPartWidthMm: (() => {
      const el = document.getElementById("leftPartWidthMm");
      return el && el.value !== "" ? Number(el.value) : undefined;
    })(),
    openingSide: document.getElementById("winOpeningSide")?.value || "right",
    openingType: document.getElementById("winOpeningType")?.value || "turn_tilt",
  });
  diagramBlock.appendChild(diagramWrap);
  container.appendChild(diagramBlock);

  // Общая таблица «Профили и армирование»: профили, армирование, штапики
  const allProfiles = []
    .concat(calc.profiles || [])
    .concat(calc.sashes || []);
  const reinforcementList = calc.reinforcement || [];
  const beadsList = calc.beads || [];
  const quantityEl = document.getElementById("winQuantity");
  const quantityRaw = quantityEl && quantityEl.value !== "" ? Number(quantityEl.value) : 1;
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.round(quantityRaw) : 1;

  if (allProfiles.length || reinforcementList.length || beadsList.length) {
    const block = document.createElement("div");
    block.className = "results-block";

    const title = document.createElement("p");
    title.className = "results-title";
    title.textContent = "Профили и армирование";
    block.appendChild(title);

    const table = document.createElement("table");
    table.className = "results-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Элемент</th>
        <th>Длина, мм</th>
        <th>Кол-во</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    // Группируем по (тип, длина)
    const rowsMap = new Map();

    allProfiles.forEach((p) => {
      const type = profileLabelRu(p.profile);
      const len = p.length;
      const key = `${type}___${len}`;
      const prev = rowsMap.get(key);
      rowsMap.set(key, (prev || 0) + quantity);
    });

    reinforcementList.forEach((r) => {
      const type = profileLabelRu(r.profile);
      const len = r.length;
      const key = `${type}___${len}`;
      const prev = rowsMap.get(key);
      rowsMap.set(key, (prev || 0) + quantity);
    });

    beadsList.forEach((b) => {
      const type = profileLabelRu(b.profile);
      const len = b.length;
      const key = `${type}___${len}`;
      const prev = rowsMap.get(key);
      rowsMap.set(key, (prev || 0) + quantity);
    });

    const typeOrder = {
      "Рама": 1,
      "Армирование рамы": 2,
      "Импост": 3,
      "Армирование импоста": 4,
      "Створка": 5,
      "Армирование створки": 6,
      "Штапик": 7,
    };

    Array.from(rowsMap.entries())
      .sort((a, b) => {
        const [typeA, lenA] = a[0].split("___");
        const [typeB, lenB] = b[0].split("___");
        const orderA = typeOrder[typeA] ?? 99;
        const orderB = typeOrder[typeB] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return Number(lenA) - Number(lenB);
      })
      .forEach(([key, count]) => {
        const [type, len] = key.split("___");
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${type}</td>
          <td>${len}</td>
          <td>${count}</td>
        `;
        tbody.appendChild(tr);
      });
    table.appendChild(tbody);
    block.appendChild(table);
    container.appendChild(block);
  }

  // Таблица фурнитуры
  if (calc.hardware && calc.hardware.length) {
    const block = document.createElement("div");
    block.className = "results-block";

    const title = document.createElement("p");
    title.className = "results-title";
    title.textContent = "Фурнитура (створки)";
    block.appendChild(title);

    const table = document.createElement("table");
    table.className = "results-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Створка</th>
        <th>Код комплекта</th>
        <th>Описание</th>
        <th>Тип открывания</th>
        <th>Размер, мм</th>
        <th>Сторона петель</th>
        <th>Кол-во</th>
      </tr>
    `;
    table.appendChild(thead);

    const openingTypeLabels = { turn_tilt: "П/О", turn_only: "П", tilt_only: "О" };
    const tbody = document.createElement("tbody");
    const quantityElHw = document.getElementById("winQuantity");
    const quantityRawHw = quantityElHw && quantityElHw.value !== "" ? Number(quantityElHw.value) : 1;
    const quantityHw =
      Number.isFinite(quantityRawHw) && quantityRawHw > 0 ? Math.round(quantityRawHw) : 1;
    calc.hardware.forEach((h) => {
      const tr = document.createElement("tr");
      const sideLabel =
        h.side === "left" ? "лево" :
        h.side === "right" ? "право" :
        h.side || "";
      const typeLabel = openingTypeLabels[h.openingType] || h.openingType || "П/О";
      tr.innerHTML = `
        <td>${hardwareElementLabelRu(h.element)}</td>
        <td>${h.code}</td>
        <td>${h.name}</td>
        <td>${typeLabel}</td>
        <td>${h.width} × ${h.height}</td>
        <td>${sideLabel}</td>
        <td>${quantityHw}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    container.appendChild(block);
  }

  // Таблица стеклопакетов
  if (calc.glazingUnits && calc.glazingUnits.length) {
    const block = document.createElement("div");
    block.className = "results-block";

    const title = document.createElement("p");
    title.className = "results-title";
    title.textContent = "Стеклопакеты";
    block.appendChild(title);

    const table = document.createElement("table");
    table.className = "results-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Элемент</th>
        <th>Ширина, мм</th>
        <th>Высота, мм</th>
        <th>Структура</th>
        <th>Кол-во</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const quantityElGlass = document.getElementById("winQuantity");
    const quantityRawGlass =
      quantityElGlass && quantityElGlass.value !== "" ? Number(quantityElGlass.value) : 1;
    const quantityGlass =
      Number.isFinite(quantityRawGlass) && quantityRawGlass > 0 ? Math.round(quantityRawGlass) : 1;

    calc.glazingUnits.forEach((g) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${elementLabelRu(g.element)}</td>
        <td>${g.width}</td>
        <td>${g.height}</td>
        <td>${g.structure}</td>
        <td>${quantityGlass}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    container.appendChild(block);
  }

}

function setupForm() {
  const form = document.getElementById("windowCalcForm");
  if (!form) return;

  const schemaEl = document.getElementById("winSchema");
  const leftWrap = document.getElementById("leftPartWidthWrap");
  const leftInput = document.getElementById("leftPartWidthMm");
  const sashOptionsWrap = document.getElementById("sashOptionsWrap");
  const openingTypeWrap = document.getElementById("openingTypeWrap");
  const grid = document.getElementById("windowCalcGrid");

  function syncSashUi() {
    const schema = schemaEl?.value;
    const needsLeftWidth =
      schema === "one_sash_left_fixed" || schema === "fixed_left_one_sash";
    const hasSash =
      schema === "one_sash" || schema === "one_sash_left_fixed" || schema === "fixed_left_one_sash";

    if (leftWrap) leftWrap.classList.toggle("is-hidden", !needsLeftWidth);
    if (sashOptionsWrap) sashOptionsWrap.classList.toggle("is-hidden", !hasSash);
    if (openingTypeWrap) openingTypeWrap.classList.toggle("is-hidden", !hasSash);

    if (grid) {
      grid.classList.toggle("is-5-cols", needsLeftWidth || hasSash);
    }

    if (leftInput) {
      if (needsLeftWidth) {
        leftInput.setAttribute("required", "required");
      } else {
        leftInput.removeAttribute("required");
        leftInput.value = "";
      }
    }
  }

  if (schemaEl) {
    schemaEl.addEventListener("change", syncSashUi);
  }
  syncSashUi();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const widthEl = document.getElementById("winWidth");
    const heightEl = document.getElementById("winHeight");
    const schemaElLocal = document.getElementById("winSchema");
    const leftInputLocal = document.getElementById("leftPartWidthMm");

    if (!widthEl || !heightEl || !schemaElLocal) return;

    const width = Number(widthEl.value);
    const height = Number(heightEl.value);
    const schema = schemaElLocal.value;
    const leftPartWidthMm =
      leftInputLocal && leftInputLocal.value !== "" ? Number(leftInputLocal.value) : undefined;
    const quantityEl = document.getElementById("winQuantity");
    const quantityRaw = quantityEl && quantityEl.value !== "" ? Number(quantityEl.value) : 1;
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.round(quantityRaw) : 1;
    const openingSide = document.getElementById("winOpeningSide")?.value || "right";
    const openingType = document.getElementById("winOpeningType")?.value || "turn_tilt";

    const beadDeductionEl = document.getElementById("winBeadDeduction");
    const beadDeductionRaw =
      beadDeductionEl && beadDeductionEl.value !== "" ? Number(beadDeductionEl.value) : 2;
    const beadDeductionMm =
      Number.isFinite(beadDeductionRaw) && beadDeductionRaw >= 0 ? beadDeductionRaw : 2;

    const profileAllowanceEl = document.getElementById("winProfileAllowance");
    const profileAllowanceRaw =
      profileAllowanceEl && profileAllowanceEl.value !== "" ? Number(profileAllowanceEl.value) : 0;
    const profileAllowanceMm =
      Number.isFinite(profileAllowanceRaw) && profileAllowanceRaw >= 0 ? profileAllowanceRaw : 0;

    try {
      const calc = calculateWindow({
        system: "KBE_70",
        width,
        height,
        schema,
        leftPartWidthMm,
        openingSide,
        openingType,
        beadDeductionMm,
        profileAllowanceMm,
      });
      setMessage("", false);
      renderResult(calc);
    } catch (err) {
      console.error(err);
      setMessage(err.message || "Ошибка расчета", true);
    }
  });
}

function setupBackButton() {
  const btn = document.getElementById("backToOrdersBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

function init() {
  setupBackButton();
  setupForm();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

