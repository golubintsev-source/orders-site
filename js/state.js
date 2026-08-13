export const state = {
  /** true — список заказов сейчас из localStorage (последний снимок + офлайн-очередь), не с сервера */
  ordersFromCache: false,
  /** true — последний пинг БД завершился ошибкой или таймаутом (офлайн-режим данных) */
  dbUnavailable: false,
  currentUser: null,
  currentRole: "user",
  editingOrderId: null,
  /** режим только просмотра (меню «Посмотреть»); взаимно исключается с editingOrderId */
  viewingOrderId: null,
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
  /** выбранные статусы; пустой = все. При загрузке orders.js выставляется «все кроме Заказ закрыт» */
  statusFilterSelected: [],
  /** выбранные типы заказа (ключи как в ORDER_TYPE_FILTER_KEYS); пустой = все */
  orderTypeFilterSelected: [],
  /** колонка «Опл.»: да / нет / Без суммы; пустой массив = все */
  paidFilterSelected: [],
  /** фильтр колонки «Дата» заказа: YYYY-MM-DD или null; границы включительно */
  orderDateFilterFrom: null,
  orderDateFilterTo: null,
  /** оплата монтажнику уже проведена по этой заявке — поля суммы и «кто оплатил» не включать */
  installerPaymentDone: false,
  /** стоимость монтажа 1м² по умолчанию (из настроек) */
  defaultInstallerRatePerM2: 1400,
  /** ФИО водителя для доставки (из app_settings) */
  driverName: "",
  /** Имя и отчество редакторов (из app_settings) */
  editors: [],
  /** корректировки баланса по участникам (целые, из app_settings) */
  balanceAdjustments: { Дима: 0, Вова: 0, Касса: 0, Безнал: 0 },
  /** заказ, для которого открыт раздел «Задачи» (id из orders) */
  tasksOrderId: null,
  /** раздел, с которого открыли форму заказа (просмотр/редактирование); после сохранения/отмены — вернуться сюда */
  orderFormReturnSectionId: null,
};