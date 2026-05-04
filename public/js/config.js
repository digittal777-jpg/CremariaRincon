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

const STORAGE_KEYS = {
  cart: "cremeria.cart",
  shift: "cremeria.shift",
  cashierSession: "cremeria.cashier.session",
  snapshot: "cremeria.snapshot",
  queue: "cremeria.queue",
  adminToken: "cremeria.adminToken",
  registerEvents: "cremeria.registerEvents",  // Eventos de caja offline
};

const OFFLINE_DB_NAME = "cremeria-rincon-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_DB_STORE = "app_state";
const PRODUCT_RENDER_BATCH = 24;