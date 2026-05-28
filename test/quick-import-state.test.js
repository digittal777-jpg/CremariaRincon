const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuickImportDraftMap,
  filterQuickImportFlagMap,
  getQuickImportAdjacentIndex,
  getQuickImportFilteredIndexes,
  getQuickImportItemStatus,
  getQuickImportProgressSummary,
  hasQuickImportDraftContent,
  normalizeQuickImportDraft,
  pickQuickImportVisibleIndex,
} = require("../public/js/quick-import-state.js");

const items = [
  { id: 1, name: "Queso Oaxaca", categoryLabel: "Quesos", unit: "kg" },
  { id: 2, name: "Jamon Virginia", categoryLabel: "Carnes", unit: "kg" },
  { id: 3, name: "Crema", categoryLabel: "Lacteos", unit: "lt" },
];

test("normalizeQuickImportDraft keeps strings and dirty flag", () => {
  assert.deepEqual(normalizeQuickImportDraft({ quantity: 2, note: null, dirty: 1 }), {
    quantity: "2",
    note: "",
    dirty: true,
  });
});

test("hasQuickImportDraftContent detects quantity or note", () => {
  assert.equal(hasQuickImportDraftContent({ quantity: "", note: "" }), false);
  assert.equal(hasQuickImportDraftContent({ quantity: "1.5", note: "" }), true);
  assert.equal(hasQuickImportDraftContent({ quantity: "", note: "revisar" }), true);
});

test("buildQuickImportDraftMap and filterQuickImportFlagMap prune stale entries", () => {
  assert.deepEqual(
    buildQuickImportDraftMap(items.slice(0, 2), {
      1: { quantity: "2", note: "", dirty: true },
      3: { quantity: "1", note: "viejo", dirty: false },
    }),
    {
      1: { quantity: "2", note: "", dirty: true },
    },
  );

  assert.deepEqual(
    filterQuickImportFlagMap(items.slice(0, 2), { 2: true, 3: true }),
    { 2: true },
  );
});

test("getQuickImportFilteredIndexes matches name, category and unit", () => {
  assert.deepEqual(getQuickImportFilteredIndexes(items, ""), [0, 1, 2]);
  assert.deepEqual(getQuickImportFilteredIndexes(items, "jamon"), [1]);
  assert.deepEqual(getQuickImportFilteredIndexes(items, "quesos"), [0]);
  assert.deepEqual(getQuickImportFilteredIndexes(items, "lt"), [2]);
});

test("pickQuickImportVisibleIndex and getQuickImportAdjacentIndex respect filtered order", () => {
  const visible = [1, 3, 6, 8];

  assert.equal(pickQuickImportVisibleIndex(visible, 6), 6);
  assert.equal(pickQuickImportVisibleIndex(visible, 4), 6);
  assert.equal(pickQuickImportVisibleIndex(visible, 9), 8);

  assert.equal(getQuickImportAdjacentIndex(visible, 3, 1), 6);
  assert.equal(getQuickImportAdjacentIndex(visible, 3, -1), 1);
  assert.equal(getQuickImportAdjacentIndex(visible, 8, 1), null);
  assert.equal(getQuickImportAdjacentIndex(visible, 99, -1), 8);
});

test("getQuickImportItemStatus prioritizes editing, saved, skipped and pending", () => {
  assert.equal(
    getQuickImportItemStatus({
      item: items[0],
      draftsByProductId: { 1: { quantity: "2", note: "", dirty: true } },
      savedByProductId: { 1: true },
      skippedByProductId: {},
    }),
    "editing",
  );

  assert.equal(
    getQuickImportItemStatus({
      item: items[1],
      draftsByProductId: {},
      savedByProductId: { 2: true },
      skippedByProductId: { 2: true },
    }),
    "saved",
  );

  assert.equal(
    getQuickImportItemStatus({
      item: items[2],
      draftsByProductId: {},
      savedByProductId: {},
      skippedByProductId: { 3: true },
    }),
    "skipped",
  );

  assert.equal(
    getQuickImportItemStatus({
      item: items[0],
      draftsByProductId: {},
      savedByProductId: {},
      skippedByProductId: {},
    }),
    "pending",
  );
});

test("getQuickImportProgressSummary counts visible, saved, skipped, editing and pending items", () => {
  assert.deepEqual(
    getQuickImportProgressSummary({
      items,
      filteredIndexes: [0, 2],
      draftsByProductId: {
        1: { quantity: "2", note: "", dirty: true },
        3: { quantity: "", note: "revisar", dirty: false },
      },
      savedByProductId: { 2: true },
      skippedByProductId: {},
    }),
    {
      total: 3,
      visible: 2,
      saved: 1,
      skipped: 0,
      editing: 2,
      pending: 0,
    },
  );
});
