(function attachQuickImportStateHelpers(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.quickImportStateHelpers = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function createQuickImportStateHelpers() {
  function getQuickImportItemId(item) {
    const normalizedId = Number(item?.id ?? item?.productId ?? item?.product_id);
    return Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null;
  }

  function normalizeQuickImportDraft(draft = {}) {
    return {
      quantity: draft?.quantity == null ? "" : String(draft.quantity),
      note: draft?.note == null ? "" : String(draft.note),
      dirty: Boolean(draft?.dirty),
    };
  }

  function hasQuickImportDraftContent(draft = {}) {
    const normalizedDraft = normalizeQuickImportDraft(draft);
    return normalizedDraft.quantity.trim() !== "" || normalizedDraft.note.trim() !== "";
  }

  function buildQuickImportDraftMap(items = [], existingDrafts = {}) {
    return items.reduce((nextDrafts, item) => {
      const productId = getQuickImportItemId(item);
      if (productId == null || !existingDrafts[productId]) {
        return nextDrafts;
      }

      nextDrafts[productId] = normalizeQuickImportDraft(existingDrafts[productId]);
      return nextDrafts;
    }, {});
  }

  function filterQuickImportFlagMap(items = [], flagMap = {}) {
    return items.reduce((nextFlags, item) => {
      const productId = getQuickImportItemId(item);
      if (productId != null && flagMap[productId]) {
        nextFlags[productId] = true;
      }
      return nextFlags;
    }, {});
  }

  function buildQuickImportSearchText(item = {}) {
    return [
      item.name,
      item.productName,
      item.categoryLabel,
      item.category,
      item.unit,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase())
      .join(" ");
  }

  function getQuickImportFilteredIndexes(items = [], search = "") {
    const normalizedSearch = String(search || "").trim().toLowerCase();

    return items.reduce((indexes, item, index) => {
      if (!normalizedSearch || buildQuickImportSearchText(item).includes(normalizedSearch)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }

  function pickQuickImportVisibleIndex(indexes = [], preferredIndex = 0) {
    if (indexes.length === 0) {
      return null;
    }

    if (indexes.includes(preferredIndex)) {
      return preferredIndex;
    }

    const nextHigherIndex = indexes.find((index) => index > preferredIndex);
    return nextHigherIndex != null ? nextHigherIndex : indexes[indexes.length - 1];
  }

  function getQuickImportAdjacentIndex(indexes = [], currentIndex = 0, direction = 1) {
    if (indexes.length === 0) {
      return null;
    }

    const currentPosition = indexes.indexOf(currentIndex);
    if (currentPosition === -1) {
      return direction > 0 ? indexes[0] : indexes[indexes.length - 1];
    }

    const nextPosition = currentPosition + direction;
    if (nextPosition < 0 || nextPosition >= indexes.length) {
      return null;
    }

    return indexes[nextPosition];
  }

  function getQuickImportItemStatus(options = {}) {
    const productId = getQuickImportItemId(options.item);
    const draftsByProductId = options.draftsByProductId || {};
    const savedByProductId = options.savedByProductId || {};
    const skippedByProductId = options.skippedByProductId || {};
    const draft =
      productId == null
        ? normalizeQuickImportDraft()
        : normalizeQuickImportDraft(draftsByProductId[productId]);

    if (draft.dirty && hasQuickImportDraftContent(draft)) {
      return "editing";
    }

    if (productId != null && savedByProductId[productId]) {
      return "saved";
    }

    if (productId != null && skippedByProductId[productId]) {
      return "skipped";
    }

    if (hasQuickImportDraftContent(draft)) {
      return "editing";
    }

    return "pending";
  }

  function getQuickImportProgressSummary(options = {}) {
    const items = Array.isArray(options.items) ? options.items : [];
    const filteredIndexes = Array.isArray(options.filteredIndexes)
      ? options.filteredIndexes
      : items.map((_item, index) => index);
    let saved = 0;
    let skipped = 0;
    let editing = 0;

    items.forEach((item, index) => {
      const status = getQuickImportItemStatus({
        item,
        index,
        draftsByProductId: options.draftsByProductId,
        savedByProductId: options.savedByProductId,
        skippedByProductId: options.skippedByProductId,
      });

      if (status === "saved") {
        saved += 1;
      } else if (status === "skipped") {
        skipped += 1;
      } else if (status === "editing") {
        editing += 1;
      }
    });

    const total = items.length;
    return {
      total,
      visible: filteredIndexes.length,
      saved,
      skipped,
      editing,
      pending: Math.max(0, total - saved - skipped - editing),
    };
  }

  return {
    buildQuickImportDraftMap,
    filterQuickImportFlagMap,
    getQuickImportAdjacentIndex,
    getQuickImportFilteredIndexes,
    getQuickImportItemId,
    getQuickImportItemStatus,
    getQuickImportProgressSummary,
    hasQuickImportDraftContent,
    normalizeQuickImportDraft,
    pickQuickImportVisibleIndex,
  };
});
