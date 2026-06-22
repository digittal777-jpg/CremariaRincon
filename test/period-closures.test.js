const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

function runIsolatedProjectScript(source) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: ROOT_DIR,
    env: process.env,
    encoding: "utf8",
    timeout: 120000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(String(result.stdout || "{}").trim() || "{}");
}

test("period helpers resolve monday-sunday weeks and month boundaries", () => {
  const payload = runIsolatedProjectScript(`
    const { getStoreWeekRange, getStoreMonthRange, listStoreDateKeysInRange } = require("./src/utils/helpers");
    console.log(JSON.stringify({
      sundayWeek: getStoreWeekRange("2026-01-04"),
      crossMonthWeek: getStoreWeekRange("2026-02-01"),
      decemberMonth: getStoreMonthRange("2025-12-31"),
      weekKeys: listStoreDateKeysInRange("2025-12-29", "2026-01-04"),
    }));
  `);

  assert.deepEqual(payload.sundayWeek, {
    periodType: "week",
    anchorDateKey: "2026-01-04",
    startDateKey: "2025-12-29",
    endDateKey: "2026-01-04",
  });
  assert.deepEqual(payload.crossMonthWeek, {
    periodType: "week",
    anchorDateKey: "2026-02-01",
    startDateKey: "2026-01-26",
    endDateKey: "2026-02-01",
  });
  assert.deepEqual(payload.decemberMonth, {
    periodType: "month",
    anchorDateKey: "2025-12-31",
    startDateKey: "2025-12-01",
    endDateKey: "2025-12-31",
  });
  assert.equal(payload.weekKeys.length, 7);
  assert.equal(payload.weekKeys[0], "2025-12-29");
  assert.equal(payload.weekKeys[6], "2026-01-04");
});

test("period helpers reject impossible date keys instead of rolling them into another period", () => {
  const payload = runIsolatedProjectScript(`
    const { createStoreDateFromKey, getStoreWeekRange } = require("./src/utils/helpers");

    function captureError(action) {
      try {
        action();
        return null;
      } catch (error) {
        return {
          message: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    }

    console.log(JSON.stringify({
      invalidDate: captureError(() => createStoreDateFromKey("2026-02-31")),
      invalidWeek: captureError(() => getStoreWeekRange("2026-02-31")),
    }));
  `);

  assert.equal(payload.invalidDate?.statusCode, 400);
  assert.match(payload.invalidDate?.message || "", /YYYY-MM-DD/i);
  assert.equal(payload.invalidWeek?.statusCode, 400);
  assert.match(payload.invalidWeek?.message || "", /fecha ancla/i);
});

test("weekly preview aggregates sales, cuts, audits and warnings across branches", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-period-preview-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const receivables = require("./src/services/receivables");
    const { getPeriodClosurePreview } = require("./src/services/periodClosures");

    const db = getDb();
    const now = nowIso();

    function toIso(dateKey, hour = 18) {
      const [year, month, day] = String(dateKey).split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString();
    }

    function insertProduct(name, price, branch, unit = "pza") {
      const result = db.prepare(\`
        INSERT INTO products (
          name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
        ) VALUES (?, ?, 0, 'general', ?, 4, ?, 40, 0, 1, 1, 0, ?, ?, ?)
      \`).run(name, price, unit, unit === "kg" ? 1 : 2, branch, now, now);
      return Number(result.lastInsertRowid);
    }

    function stampRecord(tableName, recordId, dateKey, hour = 18) {
      db.prepare(\`UPDATE \${tableName} SET created_at = ? WHERE id = ?\`).run(toIso(dateKey, hour), recordId);
    }

    function insertRegisterEvent(row) {
      const result = db.prepare(\`
        INSERT INTO register_events (
          event_type,
          shift,
          cashier,
          branch,
          over_withdrawal_amount,
          opening_amount,
          counted_amount,
          withdrawals_amount,
          expected_cash,
          difference_amount,
          cash_sales,
          non_cash_sales,
          total_sales,
          notes,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`).run(
        row.eventType,
        row.shift,
        row.cashier,
        row.branch,
        row.overWithdrawalAmount || 0,
        row.openingAmount || 0,
        row.countedAmount || 0,
        row.withdrawalsAmount || 0,
        row.expectedCash || 0,
        row.differenceAmount || 0,
        row.cashSales || 0,
        row.nonCashSales || 0,
        row.totalSales || 0,
        row.notes || null,
        toIso(row.dateKey, row.hour || 18),
      );
      return Number(result.lastInsertRowid);
    }

    const carrizalProductId = insertProduct("Queso semanal", 100, "carrizal", "pza");
    const miradoresProductId = insertProduct("Crema semanal", 50, "miradores", "pza");
    const auditProductId = insertProduct("Queso kg auditado", 100, "carrizal", "kg");
    const auditMiradoresProductId = insertProduct("Crema kg auditada", 60, "miradores", "kg");

    const saleA = sales.createSale({
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 100,
      items: [{
        productId: carrizalProductId,
        productName: "Queso semanal",
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      }],
    });
    stampRecord("sales", saleA.id, "2026-06-15", 18);

    const saleB = sales.createSale({
      shift: "Manana",
      cashier: "Pedro",
      branch: "carrizal",
      paymentMethod: "Tarjeta",
      receivedAmount: 80,
      items: [{
        productId: carrizalProductId,
        productName: "Queso semanal",
        quantity: 1,
        unitPrice: 80,
        lineTotal: 80,
      }],
    });
    stampRecord("sales", saleB.id, "2026-06-16", 15);

    const saleC = sales.createSale({
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Cliente corte",
      receivedAmount: 20,
      receivedPaymentMethod: "Efectivo",
      items: [{
        productId: carrizalProductId,
        productName: "Queso semanal",
        quantity: 1,
        unitPrice: 120,
        lineTotal: 120,
      }],
    });
    stampRecord("sales", saleC.id, "2026-06-17", 18);

    const creditPayment = receivables.createReceivablePayment({
      saleId: saleC.id,
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      amount: 30,
      paymentMethod: "Transferencia",
    });
    stampRecord("credit_payments", creditPayment.id, "2026-06-17", 17);

    const saleD = sales.createSale({
      shift: "Tarde",
      cashier: "Maria",
      branch: "miradores",
      paymentMethod: "Transferencia",
      receivedAmount: 50,
      items: [{
        productId: miradoresProductId,
        productName: "Crema semanal",
        quantity: 1,
        unitPrice: 50,
        lineTotal: 50,
      }],
    });
    stampRecord("sales", saleD.id, "2026-06-19", 18);

    insertRegisterEvent({
      eventType: "start",
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      openingAmount: 200,
      countedAmount: 200,
      expectedCash: 200,
      dateKey: "2026-06-15",
      hour: 14,
    });
    insertRegisterEvent({
      eventType: "quick_cut",
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      withdrawalsAmount: 50,
      dateKey: "2026-06-15",
      hour: 20,
      notes: "Retiro caja lunes",
    });
    insertRegisterEvent({
      eventType: "final_cut",
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      differenceAmount: -5,
      dateKey: "2026-06-15",
      hour: 21,
    });
    insertRegisterEvent({
      eventType: "start",
      branch: "carrizal",
      shift: "Manana",
      cashier: "Pedro",
      openingAmount: 100,
      countedAmount: 100,
      expectedCash: 100,
      dateKey: "2026-06-16",
      hour: 13,
    });
    insertRegisterEvent({
      eventType: "final_cut",
      branch: "carrizal",
      shift: "Manana",
      cashier: "Pedro",
      differenceAmount: 0,
      dateKey: "2026-06-16",
      hour: 20,
    });
    insertRegisterEvent({
      eventType: "start",
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      openingAmount: 150,
      countedAmount: 150,
      expectedCash: 150,
      dateKey: "2026-06-17",
      hour: 14,
    });
    insertRegisterEvent({
      eventType: "quick_cut",
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      withdrawalsAmount: 20,
      dateKey: "2026-06-17",
      hour: 19,
      notes: "Retiro caja miercoles",
    });
    insertRegisterEvent({
      eventType: "final_cut",
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      differenceAmount: 2,
      dateKey: "2026-06-17",
      hour: 21,
    });
    insertRegisterEvent({
      eventType: "start",
      branch: "miradores",
      shift: "Tarde",
      cashier: "Maria",
      openingAmount: 90,
      countedAmount: 90,
      expectedCash: 90,
      dateKey: "2026-06-19",
      hour: 15,
    });

    const completedSession = db.prepare(\`
      INSERT INTO weighted_audit_sessions (
        branch,
        shift,
        audited_date_key,
        status,
        created_by,
        completed_by,
        notes,
        source_cashier,
        template_locked,
        created_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    \`).run(
      "carrizal",
      "Tarde",
      "2026-06-17",
      "completed",
      "admin",
      "admin",
      "Auditoria cerrada",
      "Juan",
      toIso("2026-06-17", 21),
      toIso("2026-06-17", 22),
    );
    const completedSessionId = Number(completedSession.lastInsertRowid);
    db.prepare(\`
      INSERT INTO weighted_audit_items (
        session_id,
        product_id,
        product_name,
        unit,
        pos_stock,
        counted_stock,
        difference,
        direction,
        reason,
        unit_price,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      completedSessionId,
      auditProductId,
      "Queso kg auditado",
      "kg",
      10,
      8.5,
      -1.5,
      "shortage",
      "Merma semanal",
      100,
      toIso("2026-06-17", 22),
      toIso("2026-06-17", 22),
    );
    db.prepare(\`
      INSERT INTO weighted_audit_items (
        session_id,
        product_id,
        product_name,
        unit,
        pos_stock,
        counted_stock,
        difference,
        direction,
        reason,
        unit_price,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      completedSessionId,
      auditMiradoresProductId,
      "Crema kg auditada",
      "kg",
      5,
      5.5,
      0.5,
      "surplus",
      "Sobrante semanal",
      60,
      toIso("2026-06-17", 22),
      toIso("2026-06-17", 22),
    );

    const pendingSession = db.prepare(\`
      INSERT INTO weighted_audit_sessions (
        branch,
        shift,
        audited_date_key,
        status,
        created_by,
        notes,
        source_cashier,
        template_locked,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    \`).run(
      "miradores",
      "Tarde",
      "2026-06-19",
      "pending",
      "admin",
      "Pendiente",
      "Maria",
      toIso("2026-06-19", 20),
    );
    const pendingSessionId = Number(pendingSession.lastInsertRowid);
    db.prepare(\`
      INSERT INTO weighted_audit_items (
        session_id,
        product_id,
        product_name,
        unit,
        pos_stock,
        counted_stock,
        difference,
        direction,
        reason,
        unit_price,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      pendingSessionId,
      auditMiradoresProductId,
      "Crema kg auditada",
      "kg",
      4,
      null,
      null,
      null,
      null,
      60,
      toIso("2026-06-19", 20),
      toIso("2026-06-19", 20),
    );

    const preview = getPeriodClosurePreview({
      branch: "all",
      periodType: "week",
      anchorDateKey: "2026-06-18",
    });

    console.log(JSON.stringify({
      summary: preview.summary,
      warnings: preview.warnings,
      canSave: preview.canSave,
      missingFinalCutGroups: preview.missingFinalCutGroups,
      byBranch: preview.breakdowns.byBranch,
      byShift: preview.breakdowns.byShift,
      periodStartDateKey: preview.periodStartDateKey,
      periodEndDateKey: preview.periodEndDateKey,
    }));
  `);

  assert.equal(payload.periodStartDateKey, "2026-06-15");
  assert.equal(payload.periodEndDateKey, "2026-06-21");
  assert.equal(payload.summary.tickets, 4);
  assert.equal(payload.summary.totalSales, 350);
  assert.equal(payload.summary.cashSales, 120);
  assert.equal(payload.summary.cardSales, 80);
  assert.equal(payload.summary.transferSales, 80);
  assert.equal(payload.summary.creditSales, 70);
  assert.equal(payload.summary.creditCollections, 50);
  assert.equal(payload.summary.openingAmount, 540);
  assert.equal(payload.summary.withdrawalsAmount, 70);
  assert.equal(payload.summary.expectedCash, 590);
  assert.equal(payload.summary.quickCuts, 2);
  assert.equal(payload.summary.finalCuts, 3);
  assert.equal(payload.summary.finalCutDifferenceTotal, -3);
  assert.equal(payload.summary.weightedAuditPendingSessions, 1);
  assert.equal(payload.summary.weightedAuditCompletedSessions, 1);
  assert.equal(payload.summary.weightedAuditIncidentItems, 2);
  assert.equal(payload.summary.weightedAuditShortageKg, 1.5);
  assert.equal(payload.summary.weightedAuditSurplusKg, 0.5);
  assert.equal(payload.summary.weightedAuditVarianceValue, -120);
  assert.equal(payload.canSave, false);
  assert.ok(payload.warnings.some((warning) => warning.code === "weighted_audit_pending"));
  assert.ok(payload.warnings.some((warning) => warning.code === "missing_final_cut"));
  assert.equal(payload.missingFinalCutGroups.length, 1);
  assert.equal(payload.missingFinalCutGroups[0].branch, "miradores");
  assert.equal(payload.byBranch.length, 2);
  assert.equal(payload.byShift.length, 2);
});

test("weekly preview filters sync health by branch and keeps unattributed sync pending only for all", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-period-sync-scope-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { recordClientSyncHealth } = require("./src/services/backups");
    const { getPeriodClosurePreview } = require("./src/services/periodClosures");

    recordClientSyncHealth({
      deviceId: "tablet-miradores",
      branch: "miradores",
      pendingQueueCount: 2,
      blockedQueueCount: 1,
      registerEventsCount: 1,
    });
    recordClientSyncHealth({
      deviceId: "tablet-sin-branch",
      pendingQueueCount: 1,
      blockedQueueCount: 0,
      registerEventsCount: 0,
    });

    const carrizalPreview = getPeriodClosurePreview({
      branch: "carrizal",
      periodType: "week",
      anchorDateKey: "2026-06-18",
    });
    const allPreview = getPeriodClosurePreview({
      branch: "all",
      periodType: "week",
      anchorDateKey: "2026-06-18",
    });

    console.log(JSON.stringify({
      carrizalWarnings: carrizalPreview.warnings,
      carrizalCanSave: carrizalPreview.canSave,
      allWarnings: allPreview.warnings,
      allCanSave: allPreview.canSave,
    }));
  `);

  assert.equal(payload.carrizalCanSave, true);
  assert.equal(payload.carrizalWarnings.some((warning) => warning.code === "sync_pending"), false);
  assert.equal(payload.allCanSave, false);
  assert.equal(payload.allWarnings.some((warning) => warning.code === "sync_pending"), true);
});

test("saved weekly closures become stale when new live warnings appear even if totals did not move", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-period-live-warnings-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const { recordClientSyncHealth } = require("./src/services/backups");
    const {
      getPeriodClosureById,
      getPeriodClosurePreview,
      listPeriodClosures,
      savePeriodClosure,
    } = require("./src/services/periodClosures");

    const db = getDb();
    const now = nowIso();

    function toIso(dateKey, hour = 18) {
      const [year, month, day] = String(dateKey).split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString();
    }

    const productId = Number(db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES ('Producto estable', 50, 0, 'general', 'pza', 4, 2, 20, 0, 1, 1, 0, 'carrizal', ?, ?)
    \`).run(now, now).lastInsertRowid);

    const sale = sales.createSale({
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 50,
      items: [{
        productId,
        productName: "Producto estable",
        quantity: 1,
        unitPrice: 50,
        lineTotal: 50,
      }],
    });
    db.prepare("UPDATE sales SET created_at = ? WHERE id = ?").run(toIso("2026-06-15", 18), sale.id);

    db.prepare(\`
      INSERT INTO register_events (
        event_type,
        shift,
        cashier,
        branch,
        over_withdrawal_amount,
        opening_amount,
        counted_amount,
        withdrawals_amount,
        expected_cash,
        difference_amount,
        cash_sales,
        non_cash_sales,
        total_sales,
        notes,
        created_at
      ) VALUES
        ('start', 'Tarde', 'Juan', 'carrizal', 0, 100, 100, 0, 100, 0, 0, 0, 0, NULL, ?),
        ('final_cut', 'Tarde', 'Juan', 'carrizal', 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, ?)
    \`).run(
      toIso("2026-06-15", 14),
      toIso("2026-06-15", 21),
    );

    const saved = savePeriodClosure({
      branch: "carrizal",
      periodType: "week",
      anchorDateKey: "2026-06-18",
      notes: "Snapshot estable",
      createdBy: "diana",
    });

    recordClientSyncHealth({
      deviceId: "tablet-carrizal",
      branch: "carrizal",
      pendingQueueCount: 2,
      blockedQueueCount: 1,
      registerEventsCount: 1,
      online: true,
    });

    const closure = getPeriodClosureById(saved.id);
    const closureList = listPeriodClosures({
      branch: "carrizal",
      periodType: "week",
    });
    const preview = getPeriodClosurePreview({
      branch: "carrizal",
      periodType: "week",
      anchorDateKey: "2026-06-18",
    });

    console.log(JSON.stringify({
      savedWarnings: saved.warnings,
      closure,
      listedClosure: closureList[0],
      matchingClosure: preview.matchingClosure,
      previewWarnings: preview.warnings,
    }));
  `);

  assert.equal(Array.isArray(payload.savedWarnings) ? payload.savedWarnings.length : -1, 0);
  assert.equal(payload.closure.isStale, true);
  assert.equal(payload.closure.liveCanSave, false);
  assert.equal(Array.isArray(payload.closure.warnings) ? payload.closure.warnings.length : -1, 0);
  assert.ok(Array.isArray(payload.closure.liveWarnings));
  assert.ok(payload.closure.liveWarnings.some((warning) => warning.code === "sync_pending"));
  assert.equal(payload.listedClosure.isStale, true);
  assert.ok(payload.listedClosure.liveWarnings.some((warning) => warning.code === "sync_pending"));
  assert.equal(payload.matchingClosure.isStale, true);
  assert.ok(payload.matchingClosure.liveWarnings.some((warning) => warning.code === "sync_pending"));
  assert.ok(payload.previewWarnings.some((warning) => warning.code === "sync_pending"));
});

test("saving the same weekly closure updates one snapshot, detects stale data and supports store-week export", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-period-save-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const { exportWorkbookReport } = require("./src/services/export");
    const {
      getPeriodClosureById,
      listPeriodClosures,
      savePeriodClosure,
    } = require("./src/services/periodClosures");
    (async () => {
      const db = getDb();
      const now = nowIso();

      function toIso(dateKey, hour = 18) {
        const [year, month, day] = String(dateKey).split("-").map(Number);
        return new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString();
      }

      function insertProduct(name, price) {
        const result = db.prepare(\`
          INSERT INTO products (
            name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
          ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 40, 0, 1, 1, 0, 'carrizal', ?, ?)
        \`).run(name, price, now, now);
        return Number(result.lastInsertRowid);
      }

      function stampSale(saleId, dateKey) {
        db.prepare("UPDATE sales SET created_at = ? WHERE id = ?").run(toIso(dateKey), saleId);
      }

      function insertRegisterEvent(row) {
        db.prepare(\`
          INSERT INTO register_events (
            event_type,
            shift,
            cashier,
            branch,
            over_withdrawal_amount,
            opening_amount,
            counted_amount,
            withdrawals_amount,
            expected_cash,
            difference_amount,
            cash_sales,
            non_cash_sales,
            total_sales,
            notes,
            created_at
          ) VALUES (?, ?, ?, 'carrizal', 0, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
        \`).run(
          row.eventType,
          row.shift,
          row.cashier,
          row.openingAmount || 0,
          row.countedAmount || 0,
          row.withdrawalsAmount || 0,
          row.expectedCash || 0,
          row.differenceAmount || 0,
          row.notes || null,
          toIso(row.dateKey, row.hour || 18),
        );
      }

      function countSheetRows(workbook, sheetName) {
        const sheet = workbook.getWorksheet(sheetName);
        let count = 0;
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber <= 4) {
            return;
          }
          if (row.getCell(1).value) {
            count += 1;
          }
        });
        return count;
      }

      const productId = insertProduct("Producto export semanal", 90);
      const saleWeekOne = sales.createSale({
        shift: "Tarde",
        cashier: "Juan",
        branch: "carrizal",
        paymentMethod: "Efectivo",
        receivedAmount: 90,
        items: [{
          productId,
          productName: "Producto export semanal",
          quantity: 1,
          unitPrice: 90,
          lineTotal: 90,
        }],
      });
      stampSale(saleWeekOne.id, "2026-06-15");

      const saleWeekTwo = sales.createSale({
        shift: "Tarde",
        cashier: "Juan",
        branch: "carrizal",
        paymentMethod: "Efectivo",
        receivedAmount: 110,
        items: [{
          productId,
          productName: "Producto export semanal",
          quantity: 1,
          unitPrice: 110,
          lineTotal: 110,
        }],
      });
      stampSale(saleWeekTwo.id, "2026-06-17");

      const saleOutsideWeek = sales.createSale({
        shift: "Tarde",
        cashier: "Juan",
        branch: "carrizal",
        paymentMethod: "Tarjeta",
        receivedAmount: 130,
        items: [{
          productId,
          productName: "Producto export semanal",
          quantity: 1,
          unitPrice: 130,
          lineTotal: 130,
        }],
      });
      stampSale(saleOutsideWeek.id, "2026-06-23");

      insertRegisterEvent({
        eventType: "start",
        shift: "Tarde",
        cashier: "Juan",
        openingAmount: 150,
        countedAmount: 150,
        expectedCash: 150,
        dateKey: "2026-06-15",
        hour: 14,
      });
      insertRegisterEvent({
        eventType: "final_cut",
        shift: "Tarde",
        cashier: "Juan",
        differenceAmount: 0,
        dateKey: "2026-06-15",
        hour: 21,
      });
      insertRegisterEvent({
        eventType: "start",
        shift: "Tarde",
        cashier: "Juan",
        openingAmount: 160,
        countedAmount: 160,
        expectedCash: 160,
        dateKey: "2026-06-17",
        hour: 14,
      });
      insertRegisterEvent({
        eventType: "final_cut",
        shift: "Tarde",
        cashier: "Juan",
        differenceAmount: 1,
        dateKey: "2026-06-17",
        hour: 21,
      });

      const firstSave = savePeriodClosure({
        branch: "carrizal",
        periodType: "week",
        anchorDateKey: "2026-06-18",
        notes: "Primer cierre",
        createdBy: "diana",
      });
      const secondSave = savePeriodClosure({
        branch: "carrizal",
        periodType: "week",
        anchorDateKey: "2026-06-18",
        notes: "Cierre ajustado",
        createdBy: "eva",
      });

      const closures = listPeriodClosures({
        branch: "carrizal",
        periodType: "week",
      });

      db.prepare("UPDATE sales SET total = ? WHERE id = ?").run(125, saleWeekTwo.id);
      const staleClosure = getPeriodClosureById(firstSave.id);

      const weekReport = await exportWorkbookReport({
        branch: "carrizal",
        scope: "store-week",
        baseDate: "2026-06-18",
      });
      const dayReport = await exportWorkbookReport({
        branch: "carrizal",
        scope: "store-day",
        baseDate: "2026-06-17",
      });
      const allTimeReport = await exportWorkbookReport({
        branch: "carrizal",
        scope: "all-time",
      });

      console.log(JSON.stringify({
        firstSave,
        secondSave,
        closuresCount: closures.length,
        staleClosure,
        weekSalesRows: countSheetRows(weekReport.workbook, "Ventas Detalle"),
        daySalesRows: countSheetRows(dayReport.workbook, "Ventas Detalle"),
        allTimeSalesRows: countSheetRows(allTimeReport.workbook, "Ventas Detalle"),
        weekScope: weekReport.scope,
        weekExportDateKey: weekReport.exportDateKey,
      }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `);

  assert.equal(payload.firstSave.id, payload.secondSave.id);
  assert.equal(payload.firstSave.createdBy, "diana");
  assert.equal(payload.secondSave.createdBy, "diana");
  assert.equal(payload.secondSave.notes, "Cierre ajustado");
  assert.equal(payload.closuresCount, 1);
  assert.equal(payload.staleClosure.isStale, true);
  assert.equal(payload.weekScope, "store-week");
  assert.equal(payload.weekSalesRows, 2);
  assert.equal(payload.daySalesRows, 1);
  assert.equal(payload.allTimeSalesRows, 3);
  assert.equal(payload.weekExportDateKey, "2026-06-15_a_2026-06-21");
});
