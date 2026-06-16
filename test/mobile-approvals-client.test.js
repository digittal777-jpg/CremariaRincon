const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMerchandiseRequestsContext(search = "", href = `https://pos.test/${search}`) {
  const source = fs.readFileSync(
    path.join(path.resolve(__dirname, ".."), "public", "js", "merchandise-requests.js"),
    "utf8",
  );
  let replacedUrl = null;
  const context = {
    URL,
    URLSearchParams,
    console,
    state: {
      merchandise: { items: [] },
      mobileApprovals: {},
      admin: {},
      cashier: {},
      store: {},
      products: [],
    },
    refs: {},
    window: {
      location: {
        search,
        href,
      },
      history: {
        replaceState(_state, _title, url) {
          replacedUrl = url;
        },
      },
    },
    document: {
      body: {
        classList: {
          toggle() {},
        },
      },
    },
  };
  context.globalThis = context;

  const vmContext = vm.createContext(context);
  new vm.Script(source, { filename: "public/js/merchandise-requests.js" }).runInContext(vmContext);

  return {
    context: vmContext,
    getReplacedUrl() {
      return replacedUrl;
    },
  };
}

test("approvals mobile location parser reads the deep link request id", () => {
  const { context } = loadMerchandiseRequestsContext(
    "?view=approvals&request=42",
    "https://pos.test/?view=approvals&request=42",
  );
  const state = context.getApprovalsMobileLocationState();

  assert.equal(state.active, true);
  assert.equal(state.requestId, 42);
});

test("approvals mobile location writer preserves view and clears request when returning to the list", () => {
  const loaded = loadMerchandiseRequestsContext(
    "?view=approvals&request=42",
    "https://pos.test/?view=approvals&request=42",
  );

  loaded.context.replaceApprovalsMobileLocation({ active: true, requestId: null });
  assert.equal(loaded.getReplacedUrl(), "/?view=approvals");

  loaded.context.replaceApprovalsMobileLocation({ active: false });
  assert.equal(loaded.getReplacedUrl(), "/");
});
