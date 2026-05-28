const { getDb, nowIso } = require("../db");
const {
  STORE_TIME_ZONE,
  createHttpError,
  getBranchRecord,
  listConfiguredBranches,
  normalizeText,
} = require("../utils/helpers");

const db = getDb();

function normalizeBranchCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function buildBranchNameFromCode(code) {
  return String(code || "")
    .split("-")
    .filter(Boolean)
    .map((fragment) => fragment.charAt(0).toUpperCase() + fragment.slice(1))
    .join(" ");
}

function mapBranch(row) {
  return {
    code: row.code,
    name: row.name,
    timezone: row.timezone || STORE_TIME_ZONE,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function listBranches(options = {}) {
  return listConfiguredBranches({ includeInactive: options.includeInactive === true }).map((branch) => ({
    code: branch.code,
    name: branch.name,
    timezone: branch.timezone,
    active: Boolean(branch.active),
    sortOrder: Number(branch.sortOrder || 0),
  }));
}

function getBranchByCode(code, options = {}) {
  const normalizedCode = normalizeBranchCode(code);
  if (!normalizedCode) {
    return null;
  }

  const row = db.prepare(`
    SELECT code, name, timezone, active, sort_order, created_at, updated_at
    FROM branches
    WHERE code = ?
  `).get(normalizedCode);

  if (!row) {
    return null;
  }

  if (!options.includeInactive && !row.active) {
    return null;
  }

  return mapBranch(row);
}

function ensureAtLeastOneActiveBranch(nextActiveCode = null) {
  const activeBranches = db.prepare("SELECT code FROM branches WHERE active = 1 ORDER BY sort_order ASC, name COLLATE NOCASE").all();
  if (activeBranches.length > 1) {
    return;
  }

  if (activeBranches.length === 1 && activeBranches[0].code === nextActiveCode) {
    throw createHttpError("Debe quedar al menos una sucursal activa.", 409);
  }
}

function renameBranchReferences(currentCode, nextCode) {
  if (currentCode === nextCode) {
    return;
  }

  const statements = [
    "UPDATE products SET branch = ? WHERE branch = ?",
    "UPDATE sales SET branch = ? WHERE branch = ?",
    "UPDATE inventory_movements SET branch = ? WHERE branch = ?",
    "UPDATE register_events SET branch = ? WHERE branch = ?",
    "UPDATE cashiers SET branch = ? WHERE branch = ?",
    "UPDATE weighted_audit_sessions SET branch = ? WHERE branch = ?",
    "UPDATE merchandise_requests SET branch = ? WHERE branch = ?",
    "UPDATE admin_audit_logs SET branch = ? WHERE branch = ?",
  ];

  statements.forEach((statement) => {
    db.prepare(statement).run(nextCode, currentCode);
  });
}

function createBranch(payload = {}) {
  const code = normalizeBranchCode(payload.code || "");
  const name = normalizeText(payload.name || "", 80);
  const timezone = normalizeText(payload.timezone || STORE_TIME_ZONE, 64) || STORE_TIME_ZONE;
  const active = payload.active === undefined ? true : Boolean(payload.active);
  const sortOrder = Number.isFinite(Number(payload.sortOrder))
    ? Number(payload.sortOrder)
    : listConfiguredBranches({ includeInactive: true }).length;

  if (!code) {
    throw createHttpError("El codigo de sucursal es requerido.");
  }
  if (code === "all") {
    throw createHttpError("El codigo \"all\" esta reservado.");
  }
  if (!name) {
    throw createHttpError("El nombre de la sucursal es requerido.");
  }
  if (getBranchByCode(code, { includeInactive: true })) {
    throw createHttpError("Ya existe una sucursal con ese codigo.", 409);
  }

  const now = nowIso();
  db.prepare(`
    INSERT INTO branches (code, name, timezone, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, name, timezone, active ? 1 : 0, sortOrder, now, now);

  return getBranchByCode(code, { includeInactive: true });
}

function updateBranch(currentCode, payload = {}) {
  const current = getBranchByCode(currentCode, { includeInactive: true });
  if (!current) {
    throw createHttpError("La sucursal no existe.", 404);
  }

  const nextCode = payload.code === undefined
    ? current.code
    : normalizeBranchCode(payload.code);
  const nextName = payload.name === undefined
    ? current.name
    : normalizeText(payload.name || "", 80);
  const nextTimezone = payload.timezone === undefined
    ? current.timezone
    : normalizeText(payload.timezone || "", 64) || STORE_TIME_ZONE;
  const nextActive = payload.active === undefined
    ? current.active
    : Boolean(payload.active);
  const nextSortOrder = payload.sortOrder === undefined
    ? current.sortOrder
    : Number.isFinite(Number(payload.sortOrder))
      ? Number(payload.sortOrder)
      : current.sortOrder;

  if (!nextCode) {
    throw createHttpError("El codigo de sucursal no es valido.");
  }
  if (nextCode === "all") {
    throw createHttpError("El codigo \"all\" esta reservado.");
  }
  if (!nextName) {
    throw createHttpError("El nombre de la sucursal es requerido.");
  }
  if (nextCode !== current.code && getBranchByCode(nextCode, { includeInactive: true })) {
    throw createHttpError("Ya existe otra sucursal con ese codigo.", 409);
  }
  if (!nextActive && current.active) {
    ensureAtLeastOneActiveBranch(current.code);
  }

  const now = nowIso();
  db.transaction(() => {
    if (nextCode !== current.code) {
      renameBranchReferences(current.code, nextCode);
      db.prepare("UPDATE branches SET code = ? WHERE code = ?").run(nextCode, current.code);
    }

    db.prepare(`
      UPDATE branches
      SET name = ?, timezone = ?, active = ?, sort_order = ?, updated_at = ?
      WHERE code = ?
    `).run(nextName, nextTimezone, nextActive ? 1 : 0, nextSortOrder, now, nextCode);
  })();

  return getBranchByCode(nextCode, { includeInactive: true });
}

function ensureBranchesExist(branchCodes = []) {
  const created = [];

  branchCodes.forEach((branchCode, index) => {
    const normalizedCode = normalizeBranchCode(branchCode);
    if (!normalizedCode || getBranchByCode(normalizedCode, { includeInactive: true })) {
      return;
    }

    created.push(
      createBranch({
        code: normalizedCode,
        name: buildBranchNameFromCode(normalizedCode),
        timezone: STORE_TIME_ZONE,
        active: true,
        sortOrder: listConfiguredBranches({ includeInactive: true }).length + index,
      }),
    );
  });

  return created;
}

module.exports = {
  buildBranchNameFromCode,
  createBranch,
  ensureBranchesExist,
  getBranchByCode,
  listBranches,
  normalizeBranchCode,
  updateBranch,
};
