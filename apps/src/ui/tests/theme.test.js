import test from "node:test";
import assert from "node:assert/strict";

import { createThemeController } from "../theme.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) {
      this.values.add(name);
      return true;
    }
    this.values.delete(name);
    return false;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeButton {
  constructor() {
    this.type = "button";
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.classList = new FakeClassList();
  }
}

class FakeThemePanel {
  constructor() {
    this.buttons = [];
    this.innerHTML = "";
  }

  appendChild(button) {
    this.buttons.push(button);
  }

  querySelectorAll(selector) {
    if (selector === "button[data-theme]") {
      return this.buttons;
    }
    return [];
  }
}

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

test("createThemeController registers dark theme and keeps fallback logic", () => {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const themePanel = new FakeThemePanel();
  const themeToggle = { textContent: "" };

  globalThis.document = {
    body: { dataset: {} },
    createElement(tagName) {
      assert.equal(tagName, "button");
      return new FakeButton();
    },
  };
  globalThis.localStorage = createStorage();

  try {
    const controller = createThemeController({
      dom: {
        themePanel,
        themeToggle,
      },
    });

    controller.renderThemeButtons();
    assert.equal(themePanel.buttons.some((button) => button.dataset.theme === "dark"), true);

    controller.setTheme("dark");
    assert.equal(globalThis.document.body.dataset.theme, "dark");
    assert.equal(globalThis.localStorage.getItem("codexmanager.ui.theme"), "dark");
    assert.match(themeToggle.textContent, /暗夜黑/);
    assert.equal(themePanel.buttons.find((button) => button.dataset.theme === "dark")?.classList.contains("is-active"), true);

    controller.setTheme("unknown-theme");
    assert.equal(globalThis.document.body.dataset.theme, "tech");
    assert.equal(globalThis.localStorage.getItem("codexmanager.ui.theme"), "tech");
  } finally {
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
  }
});
