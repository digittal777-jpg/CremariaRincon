const crypto = require("node:crypto");
const { getDb, nowIso } = require("../db");
const { normalizeText, normalizeBranch } = require("../utils/helpers");

const db = getDb();

function hashCashierPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyCashierPassword(name, branch, password) {
  const normalizedBranch = normalizeBranch(branch);
  console.log("verifyCashierPassword - name:", name, "branch:", branch, "normalized:", normalizedBranch);
  
  const stored = db.prepare(`
    SELECT password_hash
    FROM cashiers
    WHERE name = ? AND branch = ? AND active = 1
  `).get(name, normalizedBranch);

  console.log("Stored record:", stored ? "found" : "not found");

  if (!stored) {
    return false;
  }

  try {
    const parsed = JSON.parse(stored.password_hash);
    const candidate = hashCashierPassword(password, parsed.salt);
    return crypto.timingSafeEqual(
      Buffer.from(candidate.hash, "hex"),
      Buffer.from(parsed.hash, "hex"),
    );
  } catch (_error) {
    console.error("Error verifying password:", _error.message);
    return false;
  }
}

function authenticateCashier(name, branch, password) {
  console.log("authenticateCashier - name:", name, "branch:", branch);
  if (!verifyCashierPassword(name, branch, password)) {
    console.log("Password verification failed");
    return null;
  }

  const normalizedBranch = normalizeBranch(branch);
  const row = db.prepare(`
    SELECT id, name, branch
    FROM cashiers
    WHERE name = ? AND branch = ? AND active = 1
  `).get(name, normalizedBranch);

  console.log("Auth row:", row);

  return row
    ? {
        id: row.id,
        name: row.name,
        branch: row.branch,
      }
    : null;
}

function createCashier(payload) {
  const name = normalizeText(payload.name || "", 60);
  const branch = normalizeBranch(payload.branch || "");
  const password = String(payload.password || "").trim();

  console.log("createCashier - raw branch:", payload.branch, "normalized:", branch);

  if (!name) {
    throw new Error("El nombre del cajero es requerido.");
  }

  if (!branch) {
    throw new Error("La sucursal del cajero es requerida.");
  }

  if (!password || password.length < 4) {
    throw new Error("La contrasena debe tener al menos 4 caracteres.");
  }

  const passwordHash = JSON.stringify(hashCashierPassword(password));
  const now = nowIso();

  console.log("Creating cashier:", { name, branch, passwordLength: password.length });

  try {
    const result = db.prepare(`
      INSERT INTO cashiers (name, branch, password_hash, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(name, branch, passwordHash, now, now);

    console.log("Cashier created with id:", result.lastInsertRowid);

    return {
      id: Number(result.lastInsertRowid),
      name,
      branch,
      active: true,
    };
  } catch (error) {
    console.error("Error creating cashier:", error.message, error.code);
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new Error("Ya existe un cajero con ese nombre en esa sucursal.");
    }
    if (error.code === "SQLITE_CONSTRAINT_NOTNULL") {
      throw new Error("La sucursal es requerida.");
    }
    throw error;
  }
}

function listCashiers(branch = null) {
  const rows = branch
    ? db.prepare(`
      SELECT id, name, branch, active, created_at, updated_at
      FROM cashiers
      WHERE branch = ?
      ORDER BY name COLLATE NOCASE
    `).all(branch)
    : db.prepare(`
      SELECT id, name, branch, active, created_at, updated_at
      FROM cashiers
      ORDER BY branch, name COLLATE NOCASE
    `).all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    branch: row.branch,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function updateCashier(cashierId, payload) {
  const current = db.prepare(`
    SELECT id, name, branch, active
    FROM cashiers
    WHERE id = ?
  `).get(cashierId);

  if (!current) {
    throw new Error("No encontre el cajero que quieres editar.");
  }

  const nextName = normalizeText(payload.name || current.name, 60) || current.name;
  const nextBranch = normalizeBranch(payload.branch || current.branch);
  const nextActive = payload.active === undefined ? current.active : payload.active ? 1 : 0;
  const now = nowIso();

  db.prepare(`
    UPDATE cashiers
    SET name = ?, branch = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextBranch, nextActive, now, cashierId);

  if (payload.password && payload.password.length >= 4) {
    const passwordHash = JSON.stringify(hashCashierPassword(payload.password));
    db.prepare(`
      UPDATE cashiers
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, cashierId);
  }

  return {
    id: cashierId,
    name: nextName,
    branch: nextBranch,
    active: Boolean(nextActive),
  };
}

function deleteCashier(cashierId) {
  const current = db.prepare(`
    SELECT id, name
    FROM cashiers
    WHERE id = ?
  `).get(cashierId);

  if (!current) {
    throw new Error("No encontre el cajero que quieres eliminar.");
  }

  const now = nowIso();
  db.prepare(`
    UPDATE cashiers
    SET active = 0, updated_at = ?
    WHERE id = ?
  `).run(now, cashierId);

  return { id: cashierId, name: current.name, deleted: true };
}

function initializeTestCashiers() {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM cashiers").get().count;
  if (existingCount > 0) {
    return;
  }

  const testCashiers = [
    { name: "Juan", branch: "carrizal", password: "1234" },
    { name: "Maria", branch: "miradores", password: "1234" },
    { name: "Pedro", branch: "carrizal", password: "1234" },
  ];

  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO cashiers (name, branch, password_hash, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `);

  testCashiers.forEach((cashier) => {
    const passwordHash = JSON.stringify(hashCashierPassword(cashier.password));
    insert.run(cashier.name, normalizeBranch(cashier.branch), passwordHash, now, now);
  });
}

module.exports = {
  authenticateCashier,
  createCashier,
  deleteCashier,
  hashCashierPassword,
  initializeTestCashiers,
  listCashiers,
  updateCashier,
  verifyCashierPassword,
};