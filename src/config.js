const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "cremaria-rincon.sqlite");
const PORT = Number(process.env.PORT || 3100);
const STORE_NAME = "Cremeria El Rincon";
const STORE_TIME_ZONE = process.env.POS_TIMEZONE || "America/Mexico_City";
const STORE_SHIFTS = ["Manana", "Tarde"];
const STORE_BRANCHES = ["carrizal", "miradores"];
const EXPORT_LOOKBACK_DAYS = Math.max(0, Number(process.env.POS_EXPORT_LOOKBACK_DAYS || 14));
const ENABLE_DB_INSTALL_BACKUP = process.env.POS_DB_INSTALL_BACKUP === "true";
const STORE_BRANCH_LABELS = {
  carrizal: "Carrizal",
  miradores: "Miradores",
};
const SALES_PULSE_START_HOUR = 8;
const SALES_PULSE_END_HOUR = 20;
const PROJECT_WORKBOOK_PATH = path.join(ROOT_DIR, "Queseria El rincon V1.5.xlsx");
const CUSTOM_WORKBOOK_PATH = process.env.POS_WORKBOOK_PATH
  ? path.resolve(ROOT_DIR, process.env.POS_WORKBOOK_PATH)
  : null;
const DEFAULT_WORKBOOK_PATHS = [
  CUSTOM_WORKBOOK_PATH,
  PROJECT_WORKBOOK_PATH,
  path.join(process.env.USERPROFILE || "", "Downloads", "Queseria El rincon V1.5.xlsx"),
].filter(Boolean);

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DB_PATH,
  PORT,
  STORE_NAME,
  STORE_TIME_ZONE,
  STORE_SHIFTS,
  STORE_BRANCHES,
  EXPORT_LOOKBACK_DAYS,
  ENABLE_DB_INSTALL_BACKUP,
  STORE_BRANCH_LABELS,
  SALES_PULSE_START_HOUR,
  SALES_PULSE_END_HOUR,
  DEFAULT_WORKBOOK_PATHS,
};
