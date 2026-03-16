// Расчёт простых прямоугольных ПВХ‑окон на системе KBE (упрощённо).
// Поддерживаемые схемы:
// - "fixed"                — глухое окно (рама + стеклопакет в раме)
// - "one_sash"             — окно с одной створкой (рама + створка + стеклопакет в створке)
// - "one_sash_left_fixed"  — окно с вертикальным импостом: слева створка, справа глухое
// - "fixed_left_one_sash"  — окно с вертикальным импостом: слева глухое, справа створка
// - "grid"                 — универсальная сетка (строки × столбцы, ячейки: глухое/створка/дверь)

import { SYSTEMS } from "./windowSystemKbe.js";
import {
  resolveRowHeights,
  resolveColumnWidths,
} from "./windowGridSchema.js";

/**
 * @typedef {"fixed" | "one_sash" | "one_sash_left_fixed" | "fixed_left_one_sash" | "grid"} WindowSchema
 */

/**
 * @typedef {import("./windowGridSchema.js").GridSchema} GridSchema
 */

/**
 * @typedef {Object} WindowCalcInput
 * @property {string} system - код системы, например "KBE_70"
 * @property {number} width  - габаритная ширина окна, мм
 * @property {number} height - габаритная высота окна, мм
 * @property {WindowSchema} schema - схема конструкции
 * @property {GridSchema=} gridSchema - для schema "grid": строки, столбцы, ячейки
 * @property {number=} leftPartWidthMm - ширина левой части (для схем с импостом), мм
 * @property {"left"|"right"=} openingSide - сторона открывания (петли), только для одной створки
 * @property {"turn_tilt"|"turn_only"|"tilt_only"=} openingType - тип открывания: П/О, только поворот, только откид
 * @property {number=} beadDeductionMm - технологический вычет для штапика, мм (по умолчанию 2)
 * @property {number=} profileAllowanceMm - припуск на каждый профиль, мм (по умолчанию 0)
 */

/**
 * @typedef {Object} ProfileCut
 * @property {string} element - идентификатор элемента (frame_top, sash_left и т.п.)
 * @property {number} length  - длина распила, мм
 * @property {string} profile - тип профиля ("frame" | "sash" и т.п.)
 */

/**
 * @typedef {Object} GlazingUnit
 * @property {string} element
 * @property {number} width
 * @property {number} height
 * @property {string} structure
 */

/**
 * Основная функция расчёта.
 * @param {WindowCalcInput} input
 * @returns {{
 *   type: WindowSchema,
 *   input: { width: number, height: number, system: string },
 *   profiles: ProfileCut[],
 *   sashes: ProfileCut[],
 *   glazingUnits: GlazingUnit[],
 *   reinforcement: ProfileCut[],
 *   hardware: any[],
 *   beads: ProfileCut[]
 * }}
 */
export function calculateWindow(input) {
  const system = SYSTEMS[input.system];
  if (!system) {
    throw new Error(`Unknown system: ${input.system}`);
  }

  const { width, height, schema } = input;

  validateSize(system, width, height);

  let result;
  if (schema === "fixed") {
    result = calculateFixedWindow(system, width, height, input.system);
  } else if (schema === "one_sash") {
    result = calculateOneSashWindow(system, width, height, input.system, input.openingSide, input.openingType);
  } else if (schema === "one_sash_left_fixed") {
    result = calculateOneSashLeftFixedWindow(
      system,
      width,
      height,
      input.system,
      input.leftPartWidthMm,
      input.openingSide,
      input.openingType
    );
  } else if (schema === "fixed_left_one_sash") {
    result = calculateFixedLeftOneSashWindow(
      system,
      width,
      height,
      input.system,
      input.leftPartWidthMm,
      input.openingSide,
      input.openingType
    );
  } else if (schema === "grid" && input.gridSchema) {
    result = calculateWindowGrid(system, width, height, input.gridSchema, input.system, {
      beadDeductionMm: input.beadDeductionMm,
      profileAllowanceMm: input.profileAllowanceMm,
    });
  } else {
    throw new Error(`Unsupported schema: ${schema}`);
  }

  const deduction = typeof input.beadDeductionMm === "number" && input.beadDeductionMm >= 0
    ? input.beadDeductionMm
    : 2;
  result.beads = computeBeads(result.glazingUnits || [], deduction);

  const allowance = typeof input.profileAllowanceMm === "number" && input.profileAllowanceMm > 0
    ? input.profileAllowanceMm
    : 0;
  if (allowance > 0) {
    if (result.profiles) {
      result.profiles = result.profiles.map((p) => ({
        ...p,
        length: p.length + allowance,
      }));
    }
    if (result.sashes) {
      result.sashes = result.sashes.map((p) => ({
        ...p,
        length: p.length + allowance,
      }));
    }
  }
  return result;
}

/** По каждому стеклопакету — 4 штапика: 2 по ширине, 2 по высоте (с вычетом) */
function computeBeads(glazingUnits, deductionMm) {
  /** @type {ProfileCut[]} */
  const beads = [];
  glazingUnits.forEach((g) => {
    const w = Math.max(0, g.width - deductionMm);
    const h = Math.max(0, g.height - deductionMm);
    beads.push({ element: `${g.element}_bead_w1`, profile: "bead", length: w });
    beads.push({ element: `${g.element}_bead_w2`, profile: "bead", length: w });
    beads.push({ element: `${g.element}_bead_h1`, profile: "bead", length: h });
    beads.push({ element: `${g.element}_bead_h2`, profile: "bead", length: h });
  });
  return beads;
}

function validateSize(system, width, height) {
  const { limits } = system;
  if (width < limits.minWidth || width > limits.maxWidth) {
    throw new Error(
      `Ширина ${width} мм вне диапазона ${limits.minWidth}–${limits.maxWidth} мм`
    );
  }
  if (height < limits.minHeight || height > limits.maxHeight) {
    throw new Error(
      `Высота ${height} мм вне диапазона ${limits.minHeight}–${limits.maxHeight} мм`
    );
  }
}

// 1. Глухое окно: только рама + стеклопакет в раме
function calculateFixedWindow(system, width, height, systemId) {
  const { frameProfile, glazingTechnology } = system;

  /** @type {ProfileCut[]} */
  const frameCuts = [
    { element: "frame_top", length: width, profile: "frame" },
    { element: "frame_bottom", length: width, profile: "frame" },
    { element: "frame_left", length: height, profile: "frame" },
    { element: "frame_right", length: height, profile: "frame" },
  ];

  // Световой размер под стеклопакет в раме
  const lightWidth = width - 2 * frameProfile.glazingRebate;
  const lightHeight = height - 2 * frameProfile.glazingRebate;

  // Размер стеклопакета с технологическим вычетом
  const glazingWidth = lightWidth - glazingTechnology.widthDeduction;
  const glazingHeight = lightHeight - glazingTechnology.heightDeduction;

  /** @type {GlazingUnit[]} */
  const glazingUnits = [
    {
      element: "main_glazing",
      width: glazingWidth,
      height: glazingHeight,
      structure: "4-16-4",
    },
  ];

  return {
    type: "fixed",
    input: { width, height, system: systemId },
    profiles: frameCuts,
    sashes: [],
    glazingUnits,
    reinforcement: frameCuts.map((p) => ({
      element: `arm_${p.element}`,
      profile: "frame_reinforcement",
      length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
    })),
    hardware: [],
  };
}

// 2. Окно с одной створкой: рама + створка + стеклопакет в створке
function calculateOneSashWindow(system, width, height, systemId, openingSide, openingType) {
  const { frameProfile, sashProfile, clearances, glazingTechnology } = system;
  const hingeSide = openingSide === "left" ? "left" : "right";

  /** @type {ProfileCut[]} */
  const frameCuts = [
    { element: "frame_top", length: width, profile: "frame" },
    { element: "frame_bottom", length: width, profile: "frame" },
    { element: "frame_left", length: height, profile: "frame" },
    { element: "frame_right", length: height, profile: "frame" },
  ];

  // Габариты створки с учётом зазоров между рамой и створкой
  const sashWidth = width - clearances.sashGapHorizontal;
  const sashHeight = height - clearances.sashGapVertical;

  /** @type {ProfileCut[]} */
  const sashCuts = [
    { element: "sash_top", length: sashWidth, profile: "sash" },
    { element: "sash_bottom", length: sashWidth, profile: "sash" },
    { element: "sash_left", length: sashHeight, profile: "sash" },
    { element: "sash_right", length: sashHeight, profile: "sash" },
  ];

  // Световой размер под стеклопакет в створке
  const lightWidth = sashWidth - 2 * sashProfile.glazingRebate;
  const lightHeight = sashHeight - 2 * sashProfile.glazingRebate;

  const glazingWidth = lightWidth - glazingTechnology.widthDeduction;
  const glazingHeight = lightHeight - glazingTechnology.heightDeduction;

  /** @type {GlazingUnit[]} */
  const glazingUnits = [
    {
      element: "sash_glazing",
      width: glazingWidth,
      height: glazingHeight,
      structure: "4-16-4",
    },
  ];

  return {
    type: "one_sash",
    input: { width, height, system: systemId },
    profiles: frameCuts,
    sashes: sashCuts,
    glazingUnits,
    reinforcement: []
      .concat(
        frameCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "frame_reinforcement",
          length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
        }))
      )
      .concat(
        sashCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "sash_reinforcement",
          length: Math.max(0, p.length - 2 * (sashProfile.reinforcementInset || 0)),
        }))
      ),
    hardware: [
      pickSashHardware(system, {
        id: "sash_1",
        width: sashWidth,
        height: sashHeight,
        side: hingeSide,
      }, openingType),
    ],
  };
}

// 3. Окно с вертикальным импостом: слева створка, справа глухая часть
function calculateOneSashLeftFixedWindow(
  system,
  width,
  height,
  systemId,
  leftPartWidthMm,
  openingSide,
  openingType
) {
  const { frameProfile, sashProfile, impostProfile, clearances, glazingTechnology } = system;

  /** @type {ProfileCut[]} */
  const frameCuts = [
    { element: "frame_top", length: width, profile: "frame" },
    { element: "frame_bottom", length: width, profile: "frame" },
    { element: "frame_left", length: height, profile: "frame" },
    { element: "frame_right", length: height, profile: "frame" },
  ];

  // Вертикальный импост по высоте рамы
  /** @type {ProfileCut[]} */
  const impostCuts = [
    { element: "impost_vertical", length: height, profile: "impost" },
  ];

  // Позиция импоста задаётся шириной левой части.
  // Если не задано — делим пополам (как дефолт).
  const leftFieldWidth =
    typeof leftPartWidthMm === "number" && Number.isFinite(leftPartWidthMm) && leftPartWidthMm > 0
      ? leftPartWidthMm
      : width / 2;

  const rightFieldWidth = width - leftFieldWidth;

  // Минимумы по секциям — чтобы расчёт не уходил в отрицательные размеры
  const minFieldWidth = 200;
  if (leftFieldWidth < minFieldWidth) {
    throw new Error(`Левая часть слишком узкая: ${leftFieldWidth} мм (мин ${minFieldWidth} мм)`);
  }
  if (rightFieldWidth < minFieldWidth) {
    throw new Error(
      `Правая часть слишком узкая: ${rightFieldWidth} мм (мин ${minFieldWidth} мм)`
    );
  }

  // Левая створка: учитываем суммарный зазор между рамой и створкой по горизонтали
  const sashWidth = leftFieldWidth - clearances.sashGapHorizontal;
  const sashHeight = height - clearances.sashGapVertical;

  /** @type {ProfileCut[]} */
  const sashCuts = [
    { element: "sash_top_left", length: sashWidth, profile: "sash" },
    { element: "sash_bottom_left", length: sashWidth, profile: "sash" },
    { element: "sash_left", length: sashHeight, profile: "sash" },
    { element: "sash_right_impost_side", length: sashHeight, profile: "sash" },
  ];

  // Стеклопакет в створке (левая половина)
  const lightWidthSash = sashWidth - 2 * sashProfile.glazingRebate;
  const lightHeightSash = sashHeight - 2 * sashProfile.glazingRebate;

  const glazingWidthSash = lightWidthSash - glazingTechnology.widthDeduction;
  const glazingHeightSash = lightHeightSash - glazingTechnology.heightDeduction;

  // Глухая часть справа: опирается на раму и импост
  const lightWidthFixed =
    rightFieldWidth - frameProfile.glazingRebate - impostProfile.glazingRebate;
  const lightHeightFixed = height - 2 * frameProfile.glazingRebate;

  const glazingWidthFixed = lightWidthFixed - glazingTechnology.widthDeduction;
  const glazingHeightFixed = lightHeightFixed - glazingTechnology.heightDeduction;

  /** @type {GlazingUnit[]} */
  const glazingUnits = [
    {
      element: "sash_glazing_left",
      width: glazingWidthSash,
      height: glazingHeightSash,
      structure: "4-16-4",
    },
    {
      element: "fixed_glazing_right",
      width: glazingWidthFixed,
      height: glazingHeightFixed,
      structure: "4-16-4",
    },
  ];

  return {
    type: "one_sash_left_fixed",
    input: { width, height, system: systemId },
    profiles: frameCuts.concat(impostCuts),
    sashes: sashCuts,
    glazingUnits,
    reinforcement: []
      .concat(
        frameCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "frame_reinforcement",
          length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
        }))
      )
      .concat(
        sashCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "sash_reinforcement",
          length: Math.max(0, p.length - 2 * (sashProfile.reinforcementInset || 0)),
        }))
      )
      .concat(
        impostCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "impost_reinforcement",
          length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
        }))
      ),
    hardware: [
      pickSashHardware(system, {
        id: "sash_left",
        width: sashWidth,
        height: sashHeight,
        side: "right",
      }),
    ],
  };
}

// 4. Окно с вертикальным импостом: слева глухая часть, справа створка
// leftPartWidthMm — ширина левой (глухой) секции до импоста.
function calculateFixedLeftOneSashWindow(
  system,
  width,
  height,
  systemId,
  leftPartWidthMm,
  openingSide,
  openingType
) {
  const { frameProfile, sashProfile, impostProfile, clearances, glazingTechnology } = system;

  /** @type {ProfileCut[]} */
  const frameCuts = [
    { element: "frame_top", length: width, profile: "frame" },
    { element: "frame_bottom", length: width, profile: "frame" },
    { element: "frame_left", length: height, profile: "frame" },
    { element: "frame_right", length: height, profile: "frame" },
  ];

  /** @type {ProfileCut[]} */
  const impostCuts = [
    { element: "impost_vertical", length: height, profile: "impost" },
  ];

  const leftFieldWidth =
    typeof leftPartWidthMm === "number" && Number.isFinite(leftPartWidthMm) && leftPartWidthMm > 0
      ? leftPartWidthMm
      : width / 2;

  const rightFieldWidth = width - leftFieldWidth;

  const minFieldWidth = 200;
  if (leftFieldWidth < minFieldWidth) {
    throw new Error(`Левая часть слишком узкая: ${leftFieldWidth} мм (мин ${minFieldWidth} мм)`);
  }
  if (rightFieldWidth < minFieldWidth) {
    throw new Error(
      `Правая часть слишком узкая: ${rightFieldWidth} мм (мин ${minFieldWidth} мм)`
    );
  }

  // Правая створка
  const sashWidth = rightFieldWidth - clearances.sashGapHorizontal;
  const sashHeight = height - clearances.sashGapVertical;

  /** @type {ProfileCut[]} */
  const sashCuts = [
    { element: "sash_top_right", length: sashWidth, profile: "sash" },
    { element: "sash_bottom_right", length: sashWidth, profile: "sash" },
    { element: "sash_left_impost_side", length: sashHeight, profile: "sash" },
    { element: "sash_right", length: sashHeight, profile: "sash" },
  ];

  // Стеклопакет в левой глухой части
  const lightWidthFixedLeft =
    leftFieldWidth - frameProfile.glazingRebate - impostProfile.glazingRebate;
  const lightHeightFixedLeft = height - 2 * frameProfile.glazingRebate;

  const glazingWidthFixedLeft = lightWidthFixedLeft - glazingTechnology.widthDeduction;
  const glazingHeightFixedLeft = lightHeightFixedLeft - glazingTechnology.heightDeduction;

  // Стеклопакет в правой створке
  const lightWidthSash = sashWidth - 2 * sashProfile.glazingRebate;
  const lightHeightSash = sashHeight - 2 * sashProfile.glazingRebate;

  const glazingWidthSash = lightWidthSash - glazingTechnology.widthDeduction;
  const glazingHeightSash = lightHeightSash - glazingTechnology.heightDeduction;

  /** @type {GlazingUnit[]} */
  const glazingUnits = [
    {
      element: "fixed_glazing_left",
      width: glazingWidthFixedLeft,
      height: glazingHeightFixedLeft,
      structure: "4-16-4",
    },
    {
      element: "sash_glazing_right",
      width: glazingWidthSash,
      height: glazingHeightSash,
      structure: "4-16-4",
    },
  ];

  return {
    type: "fixed_left_one_sash",
    input: { width, height, system: systemId },
    profiles: frameCuts.concat(impostCuts),
    sashes: sashCuts,
    glazingUnits,
    reinforcement: []
      .concat(
        frameCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "frame_reinforcement",
          length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
        }))
      )
      .concat(
        sashCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "sash_reinforcement",
          length: Math.max(0, p.length - 2 * (sashProfile.reinforcementInset || 0)),
        }))
      )
      .concat(
        impostCuts.map((p) => ({
          element: `arm_${p.element}`,
          profile: "impost_reinforcement",
          length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
        }))
      ),
    hardware: [
      pickSashHardware(system, {
        id: "sash_right",
        width: sashWidth,
        height: sashHeight,
        side: openingSide === "right" ? "right" : "left",
      }, openingType),
    ],
  };
}

/**
 * Универсальный расчёт по сетке: рама, вертикальные и горизонтальные импосты,
 * по ячейкам — глухие (стеклопакет в раме), створки или двери (профиль створки, стеклопакет, армирование, фурнитура).
 * @param {object} system - объект системы (KBE_70 и т.д.)
 * @param {number} width - габаритная ширина, мм
 * @param {number} height - габаритная высота, мм
 * @param {GridSchema} gridSchema - строки, столбцы, ячейки
 * @param {string} systemId - код системы
 * @param {{ beadDeductionMm?: number, profileAllowanceMm?: number }} options
 */
export function calculateWindowGrid(system, width, height, gridSchema, systemId, options = {}) {
  const { frameProfile, sashProfile, impostProfile, clearances, glazingTechnology } = system;
  const { rows, columns, cells } = gridSchema;

  if (!rows?.length || !columns?.length || !cells?.length) {
    throw new Error("Сетка должна содержать строки, столбцы и ячейки");
  }

  const rowHeights = resolveRowHeights(rows, height);
  const colWidths = resolveColumnWidths(columns, width);

  const nRows = rowHeights.length;
  const nCols = colWidths.length;

  if (cells.length !== nRows || cells.some((row) => row.length !== nCols)) {
    throw new Error("Массив ячеек должен соответствовать числу строк и столбцов");
  }

  validateSize(system, width, height);

  /** @type {ProfileCut[]} */
  const frameCuts = [
    { element: "frame_top", length: width, profile: "frame" },
    { element: "frame_bottom", length: width, profile: "frame" },
    { element: "frame_left", length: height, profile: "frame" },
    { element: "frame_right", length: height, profile: "frame" },
  ];

  /** @type {ProfileCut[]} */
  const impostCuts = [];

  for (let c = 0; c < nCols - 1; c++) {
    impostCuts.push({
      element: `impost_vertical_${c + 1}`,
      length: height,
      profile: "impost",
    });
  }
  for (let r = 0; r < nRows - 1; r++) {
    impostCuts.push({
      element: `impost_horizontal_${r + 1}`,
      length: width,
      profile: "impost",
    });
  }

  /** @type {ProfileCut[]} */
  const sashCuts = [];
  /** @type {GlazingUnit[]} */
  const glazingUnits = [];
  /** @type {ProfileCut[]} */
  const reinforcement = [];
  /** @type {any[]} */
  const hardware = [];

  const frameRebate = frameProfile.glazingRebate;
  const impostRebate = impostProfile.glazingRebate;

  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const cell = cells[r][c];
      const cellW = colWidths[c];
      const cellH = rowHeights[r];
      const leftRebate = c === 0 ? frameRebate : impostRebate;
      const rightRebate = c === nCols - 1 ? frameRebate : impostRebate;
      const topRebate = r === 0 ? frameRebate : impostRebate;
      const bottomRebate = r === nRows - 1 ? frameRebate : impostRebate;

      const cellId = `cell_${r}_${c}`;

      if (cell.type === "fixed") {
        const lightW = cellW - leftRebate - rightRebate;
        const lightH = cellH - topRebate - bottomRebate;
        const gW = lightW - glazingTechnology.widthDeduction;
        const gH = lightH - glazingTechnology.heightDeduction;
        glazingUnits.push({
          element: `${cellId}_glazing`,
          width: Math.max(0, gW),
          height: Math.max(0, gH),
          structure: "4-16-4",
        });
        continue;
      }

      if (cell.type === "sash" || cell.type === "door") {
        const sashWidth = cellW - clearances.sashGapHorizontal;
        const sashHeight = cellH - clearances.sashGapVertical;
        if (sashWidth < 100 || sashHeight < 100) {
          throw new Error(`Ячейка ${r + 1}×${c + 1}: слишком малый размер створки/двери`);
        }
        const prefix = cell.type === "door" ? "door" : "sash";
        sashCuts.push(
          { element: `${cellId}_${prefix}_top`, length: sashWidth, profile: "sash" },
          { element: `${cellId}_${prefix}_bottom`, length: sashWidth, profile: "sash" },
          { element: `${cellId}_${prefix}_left`, length: sashHeight, profile: "sash" },
          { element: `${cellId}_${prefix}_right`, length: sashHeight, profile: "sash" }
        );
        const lightW = sashWidth - 2 * sashProfile.glazingRebate;
        const lightH = sashHeight - 2 * sashProfile.glazingRebate;
        const gW = lightW - glazingTechnology.widthDeduction;
        const gH = lightH - glazingTechnology.heightDeduction;
        glazingUnits.push({
          element: `${cellId}_glazing`,
          width: Math.max(0, gW),
          height: Math.max(0, gH),
          structure: "4-16-4",
        });
        const inset = sashProfile.reinforcementInset || 0;
        reinforcement.push(
          { element: `arm_${cellId}_${prefix}_top`, profile: "sash_reinforcement", length: Math.max(0, sashWidth - 2 * inset) },
          { element: `arm_${cellId}_${prefix}_bottom`, profile: "sash_reinforcement", length: Math.max(0, sashWidth - 2 * inset) },
          { element: `arm_${cellId}_${prefix}_left`, profile: "sash_reinforcement", length: Math.max(0, sashHeight - 2 * inset) },
          { element: `arm_${cellId}_${prefix}_right`, profile: "sash_reinforcement", length: Math.max(0, sashHeight - 2 * inset) }
        );
        const side = cell.openingSide === "left" ? "left" : "right";
        const openingType = cell.openingType === "turn_only" || cell.openingType === "tilt_only" ? cell.openingType : "turn_tilt";
        hardware.push(
          pickSashHardware(
            system,
            { id: cellId, width: sashWidth, height: sashHeight, side },
            openingType
          )
        );
      }
    }
  }

  reinforcement.push(
    ...frameCuts.map((p) => ({
      element: `arm_${p.element}`,
      profile: "frame_reinforcement",
      length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
    })),
    ...impostCuts.map((p) => ({
      element: `arm_${p.element}`,
      profile: "impost_reinforcement",
      length: Math.max(0, p.length - 2 * (frameProfile.reinforcementInset || 0)),
    }))
  );

  return {
    type: "grid",
    input: { width, height, system: systemId, gridSchema },
    profiles: frameCuts.concat(impostCuts),
    sashes: sashCuts,
    glazingUnits,
    reinforcement,
    hardware,
  };
}

// Подбор условного комплекта фурнитуры для створки по размерам и типу открывания
function pickSashHardware(system, sashInfo, openingType) {
  const hw = system.hardware;
  const type = openingType === "turn_only" || openingType === "tilt_only" ? openingType : "turn_tilt";

  if (!hw || !hw.sizeClasses || !hw.sets) {
    return {
      element: sashInfo.id,
      code: "HW_UNKNOWN",
      name: "Фурнитура (настроить в системе)",
      openingType: type,
      width: sashInfo.width,
      height: sashInfo.height,
      side: sashInfo.side,
    };
  }

  const { width, height } = sashInfo;
  const sizeClass =
    hw.sizeClasses.find((c) => width <= c.maxWidth && height <= c.maxHeight)?.id || "oversize";
  const setRow = hw.sets[sizeClass] || hw.sets.oversize;
  const set = setRow && typeof setRow === "object" && setRow[type]
    ? setRow[type]
    : setRow?.turn_tilt || { code: "HW_?", name: "Фурнитура" };

  return {
    element: sashInfo.id,
    code: set.code,
    name: set.name,
    sizeClass,
    openingType: type,
    width,
    height,
    side: sashInfo.side,
  };
}

