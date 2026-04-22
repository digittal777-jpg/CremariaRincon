// Settings service - maneja configuraciones de la aplicación

const { getDb, nowIso } = require("../db");
const { getSetting } = require("../utils/helpers");

const db = getDb();

function listSettings() {
  const rows = db.prepare("SELECT key, value FROM app_settings").all();
  const settings = {};
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
}

function updateSettings(updates) {
  const now = nowIso();
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((items) => {
    Object.entries(items).forEach(([key, value]) => {
      upsert.run(key, String(value), now);
    });
  });

  transaction(updates);
  return listSettings();
}

module.exports = {
  listSettings,
  updateSettings,
  getSetting,
};