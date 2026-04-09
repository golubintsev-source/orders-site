export const state = {
  currentUser: null,
  currentRole: "user",
  editingOrderId: null,
  editingOrderDescription: null,
  initialPaymentStatus: null,
  /** снапшот числовых полей (сумм) при открытии заказа на редактирование */
  initialOrderSums: null,
  /** снапшот "кому/кто" полей для фиксации дельт в расчетах */
  initialOrderParticipants: null,
  /** полный снимок getFormData() после загрузки заказа в форму (для истории изменений) */
  initialOrderSnapshot: null,
  allOrders: [],
  filesCountMap: {},
  /** выбранные статусы для фильтра; пустой массив = показывать все */
  statusFilterSelected: [],
  /** выбранные типы заказа (ключи как в ORDER_TYPE_FILTER_KEYS); пустой = все */
  orderTypeFilterSelected: [],
  /** колонка «Опл.»: да / нет / Без суммы; пустой массив = все */
  paidFilterSelected: [],
  /** оплата монтажнику уже проведена по этой заявке — поля суммы и «кто оплатил» не включать */
  installerPaymentDone: false,
  /** стоимость монтажа 1м² по умолчанию (из настроек) */
  defaultInstallerRatePerM2: 1400,
  /** корректировки баланса по участникам (целые, из app_settings) */
  balanceAdjustments: { Дима: 0, Вова: 0, Касса: 0, Безнал: 0 },
  /** заказ, для которого открыт раздел «Задачи» (id из orders) */
  tasksOrderId: null,
};