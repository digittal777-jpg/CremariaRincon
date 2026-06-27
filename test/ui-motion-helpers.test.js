const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadUiHelpersContext({ reduceMotion = false } = {}) {
  const rootDir = path.resolve(__dirname, "..");
  const context = {
    console,
    Intl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Blob,
    URL,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    RegExp,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout,
    clearTimeout,
    navigator: { onLine: true, maxTouchPoints: 0 },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    window: {
      setTimeout,
      clearTimeout,
      requestAnimationFrame(callback) {
        callback();
      },
      matchMedia(query) {
        return {
          media: query,
          matches: reduceMotion && query === "(prefers-reduced-motion: reduce)",
        };
      },
    },
    document: {
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/helpers.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__uiMotionTestApi = {
      pulseElement,
      setModalOpen,
    };
  `).runInContext(vmContext);

  return vmContext.__uiMotionTestApi;
}

function createClassList() {
  const activeClasses = new Set();
  return {
    add(name) {
      activeClasses.add(name);
    },
    remove(name) {
      activeClasses.delete(name);
    },
    toggle(name, force) {
      if (force) {
        activeClasses.add(name);
        return true;
      }

      activeClasses.delete(name);
      return false;
    },
    contains(name) {
      return activeClasses.has(name);
    },
  };
}

test("setModalOpen syncs visibility state for animated modals", () => {
  const api = loadUiHelpersContext();
  const modal = {
    classList: createClassList(),
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };

  api.setModalOpen(modal, true);
  assert.equal(modal.classList.contains("open"), true);
  assert.equal(modal.attributes["aria-hidden"], "false");

  api.setModalOpen(modal, false);
  assert.equal(modal.classList.contains("open"), false);
  assert.equal(modal.attributes["aria-hidden"], "true");
});

test("pulseElement adds and later removes the motion class", async () => {
  const api = loadUiHelpersContext();
  const element = {
    classList: createClassList(),
  };

  api.pulseElement(element, "is-bumping", { durationMs: 5 });
  assert.equal(element.classList.contains("is-bumping"), true);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(element.classList.contains("is-bumping"), false);
});

test("pulseElement skips animations when reduced motion is preferred", async () => {
  const api = loadUiHelpersContext({ reduceMotion: true });
  const element = {
    classList: createClassList(),
  };

  api.pulseElement(element, "is-bumping", { durationMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(element.classList.contains("is-bumping"), false);
});
