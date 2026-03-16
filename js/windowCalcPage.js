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
  const padB = 48;

  const rectX = padL;
  const rectY = padT;
  const rectW = vbW - padL - padR;
  const rectH = vbH - padT - padB;

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

  // Ручка: для одной створки и для импостных — по выбранной стороне открывания
  const hingeLeft =
    sashSide === "full" ? openingSide === "left" :
    sashSide === "left" ? openingSide === "left" :
    sashSide === "right" ? openingSide === "left" :
    false;
  const handleX =
    sashSide === "full"
      ? hingeLeft ? rectX + 16 : rectX + rectW - 16
      : sashSide === "left"
        ? hingeLeft ? rectX + 16 : (impostX != null ? impostX - 16 : rectX + rectW / 2 - 16)
        : sashSide === "right"
          ? hingeLeft ? (impostX != null ? impostX + 16 : rectX + rectW / 2 + 16) : rectX + rectW - 16
          : null;
  const handleY = rectY + rectH / 2;

  const showTilt = (openingType === "turn_tilt" || openingType === "tilt_only") && sashSide != null;
  // Откидывание: перевёрнутая V — от нижних углов створки к середине верха (верх откидывается)
  const tiltStroke = 'stroke="#1f6feb" stroke-width="1.5"';
  let tiltPath = "";
  if (showTilt) {
    let sx; let sy; let sw; let sh;
    if (sashSide === "full") {
      sx = rectX + 6; sy = rectY + 6; sw = rectW - 12; sh = rectH - 12;
    } else if (sashSide === "left" && impostX != null) {
      sx = rectX + 6; sy = rectY + 6; sw = (impostX - rectX) - 12; sh = rectH - 12;
    } else if (sashSide === "right" && impostX != null) {
      sx = impostX + 6; sy = rectY + 6; sw = (rectX + rectW - impostX) - 12; sh = rectH - 12;
    } else { sx = rectX; sy = rectY; sw = rectW; sh = rectH; }
    const topCenterX = sx + sw / 2;
    const topY = sy;
    const bottomY = sy + sh;
    tiltPath = [
      `<line x1="${sx}" y1="${bottomY}" x2="${topCenterX}" y2="${topY}" fill="none" ${tiltStroke} />`,
      `<line x1="${sx + sw}" y1="${bottomY}" x2="${topCenterX}" y2="${topY}" fill="none" ${tiltStroke} />`,
    ].join("");
  }

  const safe = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const schemaLabel = SCHEMA_LABELS[schema] || schema;

  return `
  <svg class="diagram-svg" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема окна">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
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

    ${tiltPath}

    ${
      handleX != null
        ? `<circle cx="${handleX}" cy="${handleY}" r="5" fill="#1f6feb" />`
        : ""
    }

    <line x1="${rectX}" y1="${rectY + rectH + 22}" x2="${rectX + rectW}" y2="${rectY + rectH + 22}" stroke="#6b7280" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)" />
    <text x="${rectX + rectW / 2}" y="${rectY + rectH + 40}" text-anchor="middle" font-size="13" fill="#374151">${safe(widthMm)} мм</text>

    <line x1="${rectX - 32}" y1="${rectY}" x2="${rectX - 32}" y2="${rectY + rectH}" stroke="#6b7280" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)" />
    <text x="${rectX - 46}" y="${rectY + rectH / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 ${rectX - 46} ${rectY + rectH / 2})">${safe(heightMm)} мм</text>

    ${
      hasImpost
        ? `
          <line x1="${rectX}" y1="${rectY + rectH + 6}" x2="${impostX}" y2="${rectY + rectH + 6}" stroke="#9ca3af" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="${rectX + (impostX - rectX) / 2}" y="${rectY + rectH + 18}" text-anchor="middle" font-size="12" fill="#6b7280">левая часть: ${safe(Math.round(leftW))} мм</text>
        `
        : ""
    }

    <text x="${rectX}" y="${rectY - 6}" text-anchor="start" font-size="12" fill="#6b7280">${safe(schemaLabel)}</text>
    ${showTilt ? `<text x="${rectX + rectW - 85}" y="${rectY + rectH + 52}" text-anchor="start" font-size="12" fill="#374151">ОТКИДНОЕ</text>` : ""}
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

  // Таблица профилей (рама + створка)
  if ((calc.profiles && calc.profiles.length) || (calc.sashes && calc.sashes.length)) {
    const block = document.createElement("div");
    block.className = "results-block";

    const title = document.createElement("p");
    title.className = "results-title";
    title.textContent = "Профили (распил, мм)";
    block.appendChild(title);

    const table = document.createElement("table");
    table.className = "results-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Элемент</th>
        <th>Тип профиля</th>
        <th>Длина, мм</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    const allProfiles = []
      .concat(calc.profiles || [])
      .concat(calc.sashes || []);

    allProfiles.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${elementLabelRu(p.element)}</td>
        <td>${profileLabelRu(p.profile)}</td>
        <td>${p.length}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    block.appendChild(table);
    container.appendChild(block);
  }

  // Таблица армирования (металл)
  if (calc.reinforcement && calc.reinforcement.length) {
    const block = document.createElement("div");
    block.className = "results-block";

    const title = document.createElement("p");
    title.className = "results-title";
    title.textContent = "Армирование (металл)";
    block.appendChild(title);

    const table = document.createElement("table");
    table.className = "results-table";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Элемент</th>
        <th>Тип</th>
        <th>Длина, мм</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    calc.reinforcement.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${elementLabelRu(r.element)}</td>
        <td>${profileLabelRu(r.profile)}</td>
        <td>${r.length}</td>
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
      </tr>
    `;
    table.appendChild(thead);

    const openingTypeLabels = { turn_tilt: "П/О", turn_only: "П", tilt_only: "О" };
    const tbody = document.createElement("tbody");
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
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    calc.glazingUnits.forEach((g) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${elementLabelRu(g.element)}</td>
        <td>${g.width}</td>
        <td>${g.height}</td>
        <td>${g.structure}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    container.appendChild(block);
  }

  // Сырой JSON (для проверки логики)
  const jsonBlock = document.createElement("pre");
  jsonBlock.className = "results-raw-json";
  jsonBlock.textContent = JSON.stringify(calc, null, 2);
  container.appendChild(jsonBlock);
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
    const openingSide = document.getElementById("winOpeningSide")?.value || "right";
    const openingType = document.getElementById("winOpeningType")?.value || "turn_tilt";

    try {
      const calc = calculateWindow({
        system: "KBE_70",
        width,
        height,
        schema,
        leftPartWidthMm,
        openingSide,
        openingType,
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

