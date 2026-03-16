/**
 * Универсальное описание схемы окна/балконного блока как сетки ячеек.
 * rows / columns задают размеры; cells[row][col] — тип ячейки и опции створки/двери.
 */

/**
 * @typedef {{ heightMm?: number, fraction?: number }} RowSpec
 * @typedef {{ widthMm?: number, fraction?: number }} ColumnSpec
 * @typedef {{ type: 'fixed'|'sash'|'door', openingSide?: 'left'|'right', openingType?: 'turn_tilt'|'turn_only'|'tilt_only' }} CellSpec
 *
 * @typedef {Object} GridSchema
 * @property {RowSpec[]} rows
 * @property {ColumnSpec[]} columns
 * @property {CellSpec[][]} cells - cells[rowIndex][colIndex]
 */

/**
 * Нормализует высоты строк: по fraction или по heightMm (сумма должна равняться totalHeight).
 */
export function resolveRowHeights(rows, totalHeightMm) {
  const hasFraction = rows.some((r) => r.fraction != null);
  if (hasFraction) {
    const sumF = rows.reduce((s, r) => s + (r.fraction ?? 0), 0);
    if (sumF <= 0) return rows.map(() => totalHeightMm / rows.length);
    return rows.map((r) => (r.fraction != null ? totalHeightMm * (r.fraction / sumF) : 0));
  }
  const fixed = rows.map((r) => r.heightMm ?? 0);
  const sum = fixed.reduce((a, b) => a + b, 0);
  if (sum <= 0) return rows.map(() => totalHeightMm / rows.length);
  return fixed;
}

/**
 * Нормализует ширины столбцов.
 */
export function resolveColumnWidths(columns, totalWidthMm) {
  const hasFraction = columns.some((c) => c.fraction != null);
  if (hasFraction) {
    const sumF = columns.reduce((s, c) => s + (c.fraction ?? 0), 0);
    if (sumF <= 0) return columns.map(() => totalWidthMm / columns.length);
    return columns.map((c) => (c.fraction != null ? totalWidthMm * (c.fraction / sumF) : 0));
  }
  const fixed = columns.map((c) => c.widthMm ?? 0);
  const sum = fixed.reduce((a, b) => a + b, 0);
  if (sum <= 0) return columns.map(() => totalWidthMm / columns.length);
  return fixed;
}

/** Пресеты: имя → GridSchema (без размеров, только структура; размеры подставятся из общих width/height) */
export const GRID_PRESETS = {
  /** Глухое окно */
  fixed: {
    rows: [{ fraction: 1 }],
    columns: [{ fraction: 1 }],
    cells: [[{ type: "fixed" }]],
  },

  /** Одна створка на всё окно */
  one_sash: {
    rows: [{ fraction: 1 }],
    columns: [{ fraction: 1 }],
    cells: [[{ type: "sash", openingSide: "right", openingType: "turn_tilt" }]],
  },

  /** Две колонки: створка слева, глухое справа */
  sash_left_fixed_right: {
    rows: [{ fraction: 1 }],
    columns: [{ fraction: 0.5 }, { fraction: 0.5 }],
    cells: [
      [
        { type: "sash", openingSide: "left", openingType: "turn_tilt" },
        { type: "fixed" },
      ],
    ],
  },

  /** Две колонки: глухое слева, створка справа */
  fixed_left_sash_right: {
    rows: [{ fraction: 1 }],
    columns: [{ fraction: 0.5 }, { fraction: 0.5 }],
    cells: [
      [
        { type: "fixed" },
        { type: "sash", openingSide: "right", openingType: "turn_tilt" },
      ],
    ],
  },

  /** Две створки */
  two_sashes: {
    rows: [{ fraction: 1 }],
    columns: [{ fraction: 0.5 }, { fraction: 0.5 }],
    cells: [
      [
        { type: "sash", openingSide: "right", openingType: "turn_tilt" },
        { type: "sash", openingSide: "left", openingType: "turn_tilt" },
      ],
    ],
  },

  /** Три створки */
  three_sashes: {
    rows: [{ fraction: 1 }],
    columns: [{ fraction: 1 / 3 }, { fraction: 1 / 3 }, { fraction: 1 / 3 }],
    cells: [
      [
        { type: "sash", openingSide: "right", openingType: "turn_tilt" },
        { type: "sash", openingSide: "left", openingType: "turn_tilt" },
        { type: "sash", openingSide: "left", openingType: "turn_tilt" },
      ],
    ],
  },

  /** Горизонтальный импост: верх глухой, низ створка */
  horizontal_impost_sash_bottom: {
    rows: [{ fraction: 0.5 }, { fraction: 0.5 }],
    columns: [{ fraction: 1 }],
    cells: [
      [{ type: "fixed" }],
      [{ type: "sash", openingSide: "right", openingType: "turn_tilt" }],
    ],
  },

  /** Балконный блок: окно (2 створки) сверху, дверь снизу */
  balcony_block: {
    rows: [{ fraction: 0.55 }, { fraction: 0.45 }],
    columns: [{ fraction: 0.5 }, { fraction: 0.5 }],
    cells: [
      [
        { type: "sash", openingSide: "right", openingType: "turn_tilt" },
        { type: "sash", openingSide: "left", openingType: "turn_tilt" },
      ],
      [
        { type: "door", openingSide: "right", openingType: "turn_tilt" },
        { type: "fixed" },
      ],
    ],
  },

  /** Балконный блок: окно 1 створка + дверь */
  balcony_simple: {
    rows: [{ fraction: 0.5 }, { fraction: 0.5 }],
    columns: [{ fraction: 1 }],
    cells: [
      [{ type: "sash", openingSide: "right", openingType: "turn_tilt" }],
      [{ type: "door", openingSide: "right", openingType: "turn_tilt" }],
    ],
  },
};
