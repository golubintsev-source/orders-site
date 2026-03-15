export const state = {
  currentUser: null,
  currentRole: "user",
  editingOrderId: null,
  editingOrderDescription: null,
  initialPaymentStatus: null,
  allOrders: [],
  filesCountMap: {},
  /** выбранные статусы для фильтра; пустой массив = показывать все */
  statusFilterSelected: [],
};