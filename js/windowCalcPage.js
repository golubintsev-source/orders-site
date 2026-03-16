import { calculateWindow } from "./windowCalculator.js";

function setMessage(text, isError) {
  const el = document.getElementById("windowCalcMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#d32f2f" : "";
}

function buildDiagramSvg({ widthMm, heightMm, schema, leftPartWidthMm, openingSide }) {
  // Геометрия SVG
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

  // Ручка створки: для одной створки — по выбору стороны открывания; для импостных — по схеме
  const hingeLeft = (sashSide === "full" && openingSide === "left") || sashSide === "left";
  const handleX =
    sashSide === "full"
      ? hingeLeft ? rectX + 16 : rectX + rectW - 16
      : sashSide === "left" ? (impostX != null ? impostX - 16 : rectX + rectW / 2 - 16)
      : sashSide === "right" ? (impostX != null ? impostX + 16 : rectX + rectW / 2 + 16)
      : null;
  const handleY = rectY + rectH / 2;

  const safe = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  return `
  <svg class="diagram-svg" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема окна">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#6b7280" />
      </marker>
    </defs>

    <!-- Рама -->
    <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" fill="#f9fafb" stroke="#111827" stroke-width="2" />

    <!-- Импост -->
    ${
      hasImpost
        ? `<line x1="${impostX}" y1="${rectY}" x2="${impostX}" y2="${rectY + rectH}" stroke="#111827" stroke-width="2" />`
        : ""
    }

    <!-- Условная створка (пунктирный контур) -->
    ${
      sashSide === "full"
        ? `<rect x="${rectX + 6}" y="${rectY + 6}" width="${rectW - 12}" height="${rectH - 12}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 6" />`
        : sashSide === "left" && hasImpost
          ? `<rect x="${rectX + 6}" y="${rectY + 6}" width="${(impostX - rectX) - 12}" height="${rectH - 12}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 6" />`
          : sashSide === "right" && hasImpost
            ? `<rect x="${impostX + 6}" y="${rectY + 6}" width="${(rectX + rectW - impostX) - 12}" height="${rectH - 12}" fill="none" stroke="#1f6feb" stroke-width="2" stroke-dasharray="6 6" />`
            : ""
    }

    <!-- Ручка -->
    ${
      handleX != null
        ? `<circle cx="${handleX}" cy="${handleY}" r="5" fill="#1f6feb" />`
        : ""
    }

    <!-- Размер: общая ширина -->
    <line x1="${rectX}" y1="${rectY + rectH + 22}" x2="${rectX + rectW}" y2="${rectY + rectH + 22}" stroke="#6b7280" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)" />
    <text x="${rectX + rectW / 2}" y="${rectY + rectH + 40}" text-anchor="middle" font-size="13" fill="#374151">${safe(widthMm)} мм</text>

    <!-- Размер: общая высота -->
    <line x1="${rectX - 32}" y1="${rectY}" x2="${rectX - 32}" y2="${rectY + rectH}" stroke="#6b7280" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)" />
    <text x="${rectX - 46}" y="${rectY + rectH / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 ${rectX - 46} ${rectY + rectH / 2})">${safe(heightMm)} мм</text>

    <!-- Размер: левая часть до импоста -->
    ${
      hasImpost
        ? `
          <line x1="${rectX}" y1="${rectY + rectH + 6}" x2="${impostX}" y2="${rectY + rectH + 6}" stroke="#9ca3af" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="${rectX + (impostX - rectX) / 2}" y="${rectY + rectH + 18}" text-anchor="middle" font-size="12" fill="#6b7280">левая часть: ${safe(Math.round(leftW))} мм</text>
        `
        : ""
    }

    <!-- Подпись схемы -->
    <text x="${rectX}" y="${rectY - 6}" text-anchor="start" font-size="12" fill="#6b7280">${safe(schema)}</text>
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
        <td>${p.element}</td>
        <td>${p.profile}</td>
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
        <td>${r.element}</td>
        <td>${r.profile}</td>
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
        <td>${h.element}</td>
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
        <td>${g.element}</td>
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
    const showOpeningSide = schema === "one_sash";

    if (leftWrap) leftWrap.classList.toggle("is-hidden", !needsLeftWidth);
    if (sashOptionsWrap) sashOptionsWrap.classList.toggle("is-hidden", !showOpeningSide);
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

