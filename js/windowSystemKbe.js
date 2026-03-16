// Упрощённая модель профильной системы KBE 70
// Все численные значения можно позже откорректировать под реальные техкарты.

export const KBE_70 = {
  id: "KBE_70",
  name: "KBE 70 (упрощённая модель)",

  frameProfile: {
    // Глубина фальца под стеклопакет (от наружного габарита рамы до опоры стеклопакета), мм
    glazingRebate: 18,
    // Зазор под уплотнение и монтаж стеклопакета, мм (по одной стороне)
    glazingGap: 3,
    // Отступ армирования от края профиля с каждой стороны, мм (очень упрощённо)
    reinforcementInset: 100,
  },

  sashProfile: {
    glazingRebate: 18,
    glazingGap: 3,
    reinforcementInset: 120,
  },

  // Импост (упрощённо: по глубине фальца считаем как раму)
  impostProfile: {
    glazingRebate: 18,
  },

  clearances: {
    // Суммарный зазор между рамой и створкой по ширине и высоте, мм
    sashGapHorizontal: 8,
    sashGapVertical: 8,
  },

  glazingTechnology: {
    // Суммарный технологический вычет по ширине/высоте от светового размера створки или рамы, мм
    widthDeduction: 10,
    heightDeduction: 10,
  },

  limits: {
    minWidth: 400,
    minHeight: 400,
    maxWidth: 3000,
    maxHeight: 2600,
  },

  // Упрощённая конфигурация фурнитуры (П/О — поворотно-откидная, П — поворот, О — откидная)
  hardware: {
    sizeClasses: [
      { id: "small", maxWidth: 800, maxHeight: 1300 },
      { id: "medium", maxWidth: 1000, maxHeight: 1800 },
      { id: "large", maxWidth: 1300, maxHeight: 2300 },
    ],
    sets: {
      small: {
        turn_tilt: { code: "SASH_PK_SMALL_PO", name: "Комплект фурнитуры малый П/О" },
        turn_only: { code: "SASH_PK_SMALL_P", name: "Комплект фурнитуры малый П" },
        tilt_only: { code: "SASH_PK_SMALL_O", name: "Комплект фурнитуры малый О" },
      },
      medium: {
        turn_tilt: { code: "SASH_PK_MEDIUM_PO", name: "Комплект фурнитуры средний П/О" },
        turn_only: { code: "SASH_PK_MEDIUM_P", name: "Комплект фурнитуры средний П" },
        tilt_only: { code: "SASH_PK_MEDIUM_O", name: "Комплект фурнитуры средний О" },
      },
      large: {
        turn_tilt: { code: "SASH_PK_LARGE_PO", name: "Комплект фурнитуры большой П/О" },
        turn_only: { code: "SASH_PK_LARGE_P", name: "Комплект фурнитуры большой П" },
        tilt_only: { code: "SASH_PK_LARGE_O", name: "Комплект фурнитуры большой О" },
      },
      oversize: {
        turn_tilt: { code: "SASH_PK_OVERSIZE_PO", name: "Комплект фурнитуры нестандартный П/О (проверить)" },
        turn_only: { code: "SASH_PK_OVERSIZE_P", name: "Комплект фурнитуры нестандартный П (проверить)" },
        tilt_only: { code: "SASH_PK_OVERSIZE_O", name: "Комплект фурнитуры нестандартный О (проверить)" },
      },
    },
  },
};

export const SYSTEMS = {
  KBE_70,
};

