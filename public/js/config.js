const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const quantityFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
});

const timeFormatter = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
});

const CATEGORY_ORDER = ["all", "quesos", "carnes", "piezas", "general"];
const CATEGORY_LABELS = {
  all: "Todo",
  quesos: "Quesos",
  carnes: "Carnes",
  piezas: "Piezas",
  general: "General",
};
const PAYMENT_METHOD_OPTIONS = [
  { value: "Efectivo", label: "Efectivo", kind: "cash" },
  { value: "Tarjeta", label: "Tarjeta", kind: "non_cash" },
  { value: "Transferencia", label: "Transferencia", kind: "non_cash" },
  { value: "Fiado", label: "Fiado", kind: "credit", requiresCustomer: true },
];
const RECEIVED_PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_OPTIONS.filter(
  (option) => option.kind !== "credit",
);

const STORAGE_KEYS = {
  cart: "cremeria.cart",
  shift: "cremeria.shift",
  routeMode: "cremeria.routeMode",
  routeRegisterCollapsed: "cremeria.routeRegisterCollapsed",
  cashierSession: "cremeria.cashier.session",
  cashierOfflineProfiles: "cremeria.cashier.offlineProfiles",
  snapshot: "cremeria.snapshot",
  preparedSnapshots: "cremeria.preparedSnapshots",
  receivablesCache: "cremeria.receivablesCache",
  queue: "cremeria.queue",
  offlineSales: "cremeria.offlineSales",
  offlineReceivablePayments: "cremeria.offlineReceivablePayments",
  registerEvents: "cremeria.registerEvents",  // Eventos de caja offline
  deviceId: "cremeria.deviceId",
};

const OFFLINE_DB_NAME = "cremeria-rincon-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_DB_STORE = "app_state";
const CASHIER_SESSION_STORAGE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PRODUCT_RENDER_BATCH = 24;
