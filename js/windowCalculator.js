// Расчёт простых прямоугольных ПВХ‑окон на системе KBE (упрощённо).
// Поддерживаемые схемы:
// - "fixed"                — глухое окно (рама + стеклопакет в раме)
// - "one_sash"             — окно с одной створкой (рама + створка + стеклопакет в створке)
// - "one_sash_left_fixed"  — окно с вертикальным импостом: слева створка, справа глухое
// - "fixed_left_one_sash"  — окно с вертикальным импостом: слева глухое, справа створка

import { SYSTEMS } from "./windowSystemKbe.js";

/**
 * @typedef {"fixed" | "one_sash" | "one_sash_left_fixed" | "fixed_left_one_sash"} WindowSchema
 */

/**
 * @typedef {Object} WindowCalcInput
 * @property {string} system - код системы, например "KBE_70"
 * @property {number} width  - габаритная ширина окна, мм
 * @property {number} height - габаритная высота окна, мм
 * @property {WindowSchema} schema - схема конструкции
 * @property {number=} leftPartWidthMm - ширина левой части (для схем с импостом), мм
 * @property {"left"|"right"=} openingSide - сторона открывания (петли), только для одной створки
 * @property {"turn_tilt"|"turn_only"|"tilt_only"=} openingType - тип открывания: П/О, только поворот, только откид
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
 *   hardware: any[]
 * }}
 */
export function calculateWindow(input) {
  const system = SYSTEMS[input.system];
  if (!system) {
    throw new Error(`Unknown system: ${input.system}`);
  }

  const { width, height, schema } = input;

  validateSize(system, width, height);

  if (schema === "fixed") {
    return calculateFixedWindow(system, width, height, input.system);
  }
  if (schema === "one_sash") {
    return calculateOneSashWindow(system, width, height, input.system, input.openingSide, input.openingType);
  }
  if (schema === "one_sash_left_fixed") {
    return calculateOneSashLeftFixedWindow(
      system,
      width,
      height,
      input.system,
      input.leftPartWidthMm,
      input.openingSide,
      input.openingType
    );
  }
  if (schema === "fixed_left_one_sash") {
    return calculateFixedLeftOneSashWindow(
      system,
      width,
      height,
      input.system,
      input.leftPartWidthMm,
      input.openingSide,
      input.openingType
    );
  }

  throw new Error(`Unsupported schema: ${schema}`);
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

