const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { advancePosition, hasReachedEnd, keepReadingPlace, clearOldStorage, prepareScript, parseEmphasis, estimateScrollSeconds, formatDuration, elapsedAt, formatElapsed, DEFAULTS, OLD_STORAGE_KEYS } = require("./app.js");

function createReadingSession(speed, { maxScroll = 3200, script = "A long script", storage } = {}) {
  const elements = new Map();
  let onStyle = () => {};
  const element = () => ({
    hidden: false,
    textContent: "",
    value: "",
    children: [],
    style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); onStyle(name, value); } },
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    click() { if (!this.disabled) this.listeners.get("click")?.(); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    focus() {},
    getBoundingClientRect() { return { height: 1000 }; },
  });
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  getElementById("reading-view").hidden = true;
  const reader = getElementById("reader");
  reader.scrollHeight = 800 + maxScroll;
  reader.clientHeight = 800;
  let actualScroll = 0;
  Object.defineProperty(reader, "scrollTop", {
    get() { return actualScroll; },
    set(value) { actualScroll = Math.round(value); },
  });

  let now = 0;
  let frame = null;
  let storageWrites = 0;
  const timers = [];
  const saved = storage ?? new Map();
  const window = {
    listeners: new Map(),
    innerHeight: 800,
    performance: { now: () => now },
    localStorage: {
      getItem() { throw new Error("Stored scripts must not be read"); },
      setItem() { storageWrites += 1; },
      removeItem: (key) => saved.delete(key),
    },
    requestAnimationFrame: (callback) => { frame = callback; return 1; },
    cancelAnimationFrame: () => { frame = null; },
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
  };
  const historyEntries = [null];
  let historyIndex = 0;
  window.history = {
    state: null,
    replaceState(state) {
      historyEntries[historyIndex] = state;
      this.state = state;
    },
    pushState(state) {
      historyEntries.splice(historyIndex + 1);
      historyEntries.push(state);
      historyIndex += 1;
      this.state = state;
    },
    back() {
      if (historyIndex === 0) return;
      historyIndex -= 1;
      this.state = historyEntries[historyIndex];
      window.listeners.get("popstate")?.({ state: this.state });
    },
    forward() {
      if (historyIndex === historyEntries.length - 1) return;
      historyIndex += 1;
      this.state = historyEntries[historyIndex];
      window.listeners.get("popstate")?.({ state: this.state });
    },
  };
  const document = {
    listeners: new Map(),
    getElementById,
    documentElement: element(),
    createTextNode: (text) => ({ textContent: text }),
    createElement: element,
    addEventListener(name, handler) { this.listeners.set(name, handler); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), { document, window, HTMLElement: Object });

  function input(id, value) {
    const target = getElementById(id);
    target.value = String(value);
    target.listeners.get("input")?.({ target });
  }
  if (script) input("script-input", script);
  if (speed !== DEFAULTS.speed) input("editor-speed", speed);

  return {
    reader,
    get: getElementById,
    saved,
    storageWrites: () => storageWrites,
    historyState: () => window.history.state,
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    input,
    toggle(id, checked) {
      const target = getElementById(id);
      target.checked = checked;
      target.listeners.get("change")?.({ target });
    },
    cssVar: (name) => document.documentElement.style.values.get(name),
    runTimers() { while (timers.length) timers.shift()(); },
    onStyleChange(handler) { onStyle = handler; },    show() { window.listeners.get("pageshow")(); },
    leave() { window.listeners.get("pagehide")(); },
    key(code, target = reader) {
      let prevented = false;
      document.listeners.get("keydown")({ code, target, preventDefault() { prevented = true; } });
      return prevented;
    },
    hide() {
      document.hidden = true;
      document.listeners.get("visibilitychange")();
    },
    click: (id) => getElementById(id).click(),
    frames(count) {
      for (let i = 0; i < count; i += 1) {
        now += 1000 / 60;
        const callback = frame;
        assert.ok(callback, "playback should schedule each frame");
        frame = null;
        callback(now);
      }
    },
  };
}

test("scroll advances smoothly and stops at the end", () => {
  assert.equal(advancePosition(10, 35, .05, 100), 11.75);
  assert.equal(advancePosition(98, 35, .05, 100), 99.75);
  assert.equal(advancePosition(99, 35, .05, 100), 100);
});

test("low speeds accumulate movement even when the browser rounds each scroll position", () => {
  for (const speed of [10, 25, 29, 35]) {
    const session = createReadingSession(speed);
    session.click("open-reader");
    session.click("play-button");
    session.frames(60);
    assert.ok(Math.abs(session.reader.scrollTop - speed) <= 1, `${speed} px/s should move about ${speed} px in one second`);
  }
});

test("resuming after manual scrolling starts from the new position", () => {
  const session = createReadingSession(10);
  session.click("open-reader");
  session.click("play-button");
  session.frames(60);
  session.click("play-button");
  session.reader.scrollTop = 100;
  session.click("play-button");
  session.frames(60);
  assert.ok(Math.abs(session.reader.scrollTop - 110) <= 1);
  session.click("restart-button");
  assert.equal(session.reader.scrollTop, 0);
});

test("a short script keeps the reading timer active after it reaches the scroll limit", () => {
  const session = createReadingSession(25, { maxScroll: 13 });
  session.click("open-reader");
  session.click("play-button");
  session.frames(61);
  assert.equal(session.reader.scrollTop, 13);
  assert.equal(session.get("play-label").textContent, "Pause");
  assert.equal(session.get("elapsed-time").textContent, "00:01");
  assert.equal(session.get("playback-status").textContent, "End of script");
});

test("paste, format, read, change speed, pause, restart, and edit", () => {
  const session = createReadingSession(25, { script: "" });
  const source = "First line\\\n**Bold** thought\n\nNext *idea*.";
  assert.equal(session.get("open-reader").disabled, true);
  session.input("script-input", source);
  assert.equal(session.get("open-reader").disabled, false);
  assert.equal(session.storageWrites(), 0);

  session.click("open-reader");
  assert.equal(session.get("editor-view").hidden, true);
  assert.equal(session.get("reading-view").hidden, false);
  assert.equal(session.get("script-display").children.map((node) => node.textContent).join(""), "First line\nBold thought\n\nNext idea.");
  session.click("play-button");
  session.frames(61);
  assert.ok(Math.abs(session.reader.scrollTop - 25) <= 1);
  assert.equal(session.get("elapsed-time").textContent, "00:01");

  session.input("reader-speed", 40);
  session.frames(61);
  assert.ok(Math.abs(session.reader.scrollTop - 65) <= 1);
  assert.equal(session.get("editor-speed").value, 40);
  assert.equal(session.storageWrites(), 0);
  session.click("play-button");
  assert.equal(session.get("play-label").textContent, "Play");
  assert.equal(session.get("elapsed-time").textContent, "00:02");
  session.click("restart-button");
  assert.equal(session.reader.scrollTop, 0);
  assert.equal(session.get("elapsed-time").textContent, "00:00");
  session.click("edit-button");
  assert.equal(session.get("editor-view").hidden, false);
  assert.equal(session.get("script-input").value, source);
  assert.equal(session.historyState().teleprompterView, "editor");
});

test("browser Back opens the editor and Forward reopens the reader", () => {
  const session = createReadingSession(25, { script: "First line\n\nSecond thought" });
  session.input("editor-width", 700);
  session.click("open-reader");
  assert.equal(session.historyState().teleprompterView, "reader");
  session.click("play-button");
  session.frames(61);

  session.back();
  assert.equal(session.historyState().teleprompterView, "editor");
  assert.equal(session.get("editor-view").hidden, false);
  assert.equal(session.get("reading-view").hidden, true);
  assert.equal(session.get("script-input").value, "First line\n\nSecond thought");
  assert.equal(session.get("editor-width").value, 700);
  assert.equal(session.get("play-label").textContent, "Play");

  session.input("script-input", "Revised line\n\nNew thought");
  session.forward();
  assert.equal(session.get("reading-view").hidden, false);
  assert.equal(session.get("script-display").children.map((node) => node.textContent).join(""), "Revised line\n\nNew thought");
  assert.equal(session.get("elapsed-time").textContent, "00:00");
  assert.equal(session.reader.scrollTop, 0);
});

test("Edit script returns through history so Forward can reopen reading", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  session.click("edit-button");
  assert.equal(session.historyState().teleprompterView, "editor");
  assert.equal(session.get("editor-view").hidden, false);
  session.forward();
  assert.equal(session.get("reading-view").hidden, false);
});

test("reading keyboard shortcuts keep speed, playback, and timer in sync", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  session.key("Space");
  session.frames(61);
  session.key("ArrowUp");
  assert.equal(session.get("reader-speed").value, 30);
  session.key("ArrowDown");
  assert.equal(session.get("reader-speed").value, 25);
  session.key("Space");
  assert.equal(session.get("elapsed-time").textContent, "00:01");
  session.key("KeyR");
  assert.equal(session.reader.scrollTop, 0);
  assert.equal(session.get("elapsed-time").textContent, "00:00");
});

test("script and reading settings reset on a simulated reload", () => {
  const first = createReadingSession(25, { script: "" });
  first.input("script-input", "First line\n\nSecond thought");
  first.input("editor-speed", 34);
  first.input("editor-size", 48);
  first.input("editor-width", 700);
  assert.equal(first.get("script-input").value, "First line\n\nSecond thought");
  assert.equal(first.get("editor-speed").value, 34);
  assert.equal(first.storageWrites(), 0);

  const reloaded = createReadingSession(25, { script: "", storage: first.saved });
  assert.equal(reloaded.get("script-input").value, "");
  assert.equal(reloaded.get("editor-speed").value, 25);
  assert.equal(reloaded.get("editor-size").value, 44);
  assert.equal(reloaded.get("editor-width").value, 580);
  assert.equal(reloaded.get("open-reader").disabled, true);
  assert.equal(reloaded.storageWrites(), 0);

  reloaded.get("script-input").value = "browser-restored text";
  reloaded.get("editor-speed").value = 90;
  reloaded.show();
  assert.equal(reloaded.get("script-input").value, "");
  assert.equal(reloaded.get("editor-speed").value, 25);
});

test("an outgoing page clears its script before browser history can restore it", () => {
  const session = createReadingSession(40, { script: "Private pitch" });
  session.input("editor-size", 50);
  session.click("open-reader");
  session.click("play-button");
  session.frames(61);

  session.leave();
  session.show();
  assert.equal(session.get("script-input").value, "");
  assert.equal(session.get("script-display").children.length, 0);
  assert.equal(session.get("reading-view").hidden, true);
  assert.equal(session.get("editor-view").hidden, false);
  assert.equal(session.get("open-reader").disabled, true);
  assert.equal(session.get("editor-speed").value, 25);
  assert.equal(session.get("editor-size").value, 44);
  assert.equal(session.get("elapsed-time").textContent, "00:00");
});

test("hiding the reading tab pauses playback and the timer", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  session.click("play-button");
  session.frames(61);
  session.hide();
  assert.equal(session.get("play-label").textContent, "Play");
  assert.equal(session.get("playback-status").textContent, "Paused while hidden");
  assert.equal(session.get("elapsed-time").textContent, "00:01");
});

test("a delayed frame cannot skip a large part of the script", () => {
  assert.equal(advancePosition(10, 35, 8, 1000), 13.5);
  assert.equal(advancePosition(10, 35, -1, 1000), 10);
});

test("a script that fits on screen stays active until paused", () => {
  assert.equal(hasReachedEnd(0, 0), false);
  assert.equal(hasReachedEnd(.5, .5), false);
  assert.equal(hasReachedEnd(98, 100), false);
  assert.equal(hasReachedEnd(99, 100), true);
});

test("old stored scripts are removed without touching unrelated browser data", () => {
  const storage = new Map(OLD_STORAGE_KEYS.map((key) => [key, "old script"]));
  storage.set("another-app", "keep this");
  const session = createReadingSession(25, { script: "", storage });
  assert.equal(session.get("script-input").value, "");
  assert.deepEqual([...storage], [["another-app", "keep this"]]);
  assert.equal(session.storageWrites(), 0);
});

test("blocked browser storage does not stop old-data cleanup or fresh defaults", () => {
  assert.doesNotThrow(() => clearOldStorage(null));
  assert.doesNotThrow(() => clearOldStorage({ removeItem() { throw new Error("blocked"); } }));
  assert.deepEqual(DEFAULTS, { script: "", speed: 25, size: 44, width: 580, dimming: true });
});

test("line breaks, blank lines, and spacing remain where pasted", () => {
  assert.equal(
    prepareScript("One thing with\\\nAI\nis fast.\n\n  **Fast isn’t enough.**"),
    "One thing with\nAI\nis fast.\n\n  **Fast isn’t enough.**",
  );
  assert.equal(prepareScript("First\r\nSecond\r\n\r\nThird"), "First\nSecond\n\nThird");
  assert.equal(prepareScript(""), "");
});

test("bold and italic marks become visual emphasis without changing the words", () => {
  assert.deepEqual(parseEmphasis("**Fast** is *likely* useful."), [
    { kind: "strong", text: "Fast" },
    { kind: "text", text: " is " },
    { kind: "em", text: "likely" },
    { kind: "text", text: " useful." },
  ]);
  const visible = parseEmphasis(prepareScript("One thing\\\nwith **AI**\n\nIt is *useful*."))
    .map((part) => part.text).join("");
  assert.equal(visible, "One thing\nwith AI\n\nIt is useful.");
});

test("bullet markers remain visible instead of becoming italic text", () => {
  const list = "* First item\n* Second item\n\n**Important** point";
  assert.deepEqual(parseEmphasis(list), [
    { kind: "text", text: "* First item\n* Second item\n\n" },
    { kind: "strong", text: "Important" },
    { kind: "text", text: " point" },
  ]);
  assert.deepEqual(parseEmphasis("* spaced *"), [{ kind: "text", text: "* spaced *" }]);
  assert.deepEqual(parseEmphasis("* First item with *emphasis*"), [
    { kind: "text", text: "* First item with " },
    { kind: "em", text: "emphasis" },
  ]);
  assert.deepEqual(parseEmphasis("* A **bold** item"), [
    { kind: "text", text: "* A " },
    { kind: "strong", text: "bold" },
    { kind: "text", text: " item" },
  ]);
  assert.deepEqual(parseEmphasis("*bad *good*"), [
    { kind: "text", text: "*bad " },
    { kind: "em", text: "good" },
  ]);
});

test("scroll time reflects text height and scroll speed", () => {
  assert.equal(estimateScrollSeconds(800, 800, 40), 17.2);
  assert.equal(estimateScrollSeconds(800, 400, 40), 19.8);
  assert.equal(formatDuration(115), "1:55");
  assert.equal(formatDuration(18.4), "0:20");
});

test("elapsed time adds only playing intervals and uses steady minute-second digits", () => {
  const firstInterval = elapsedAt(0, 1000, 3500);
  const secondInterval = elapsedAt(firstInterval, 7000, 8500);
  assert.equal(secondInterval, 4000);
  assert.equal(formatElapsed(secondInterval), "00:04");
  assert.equal(formatElapsed(59999), "00:59");
  assert.equal(formatElapsed(60000), "01:00");
});

test("line dimming starts on and can be turned off for the reading view", () => {
  const session = createReadingSession(25);
  assert.equal(session.get("editor-dimming").checked, true);
  assert.equal(session.cssVar("--focus-dimming"), "1");

  session.toggle("editor-dimming", false);
  assert.equal(session.get("editor-dimming").checked, false);
  assert.equal(session.cssVar("--focus-dimming"), "0");

  // The choice holds while moving between editing and reading.
  session.click("open-reader");
  session.back();
  session.forward();
  assert.equal(session.cssVar("--focus-dimming"), "0");

  session.toggle("editor-dimming", true);
  assert.equal(session.cssVar("--focus-dimming"), "1");
});

test("line dimming returns to on after the page is left or reloaded", () => {
  const session = createReadingSession(25);
  session.toggle("editor-dimming", false);
  session.leave();
  session.show();
  assert.equal(session.get("editor-dimming").checked, true);
  assert.equal(session.cssVar("--focus-dimming"), "1");

  const reloaded = createReadingSession(25, { script: "" });
  assert.equal(reloaded.get("editor-dimming").checked, true);
});

test("reading band dims spoken text more than upcoming text and respects high contrast", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const value = (name) => Number(css.match(new RegExp(`${name}:\\s*([\\d.]+);`))[1]);
  const before = value("--dim-before");
  const after = value("--dim-after");
  assert.ok(before > 0 && before < after && after < 1, "spoken text should be dimmer than upcoming text");
  assert.equal(value("--focus-lines"), 3);
  assert.match(css, /@media \(prefers-contrast: more\)\s*\{\s*\.reader \{[^}]*mask-image: none/);
});

test("the reading view switch and the editor switch control the same setting", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  assert.equal(session.get("reader-dimming").checked, true);

  session.toggle("reader-dimming", false);
  assert.equal(session.cssVar("--focus-dimming"), "0");
  assert.equal(session.get("editor-dimming").checked, false, "editor switch should follow the reader switch");

  session.back();
  session.toggle("editor-dimming", true);
  session.forward();
  assert.equal(session.get("reader-dimming").checked, true, "reader switch should follow the editor switch");
  assert.equal(session.cssVar("--focus-dimming"), "1");
});

test("Space on a focused switch flips the switch instead of starting playback", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  const reservedBySwitch = session.key("Space", { tagName: "INPUT", type: "checkbox" });
  assert.equal(reservedBySwitch, false, "the browser should handle Space on a switch");
  assert.equal(session.get("play-label").textContent, "Play");

  // Space on a speed slider still plays, as before.
  assert.equal(session.key("Space", { tagName: "INPUT", type: "range" }), true);
  assert.equal(session.get("play-label").textContent, "Pause");
});

test("speed changes in steps of 5 from the keyboard and both sliders, within 10 to 110", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  for (const id of ["editor-speed", "reader-speed"]) {
    const slider = html.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
    assert.match(slider, /step="5"/, `${id} should move in steps of 5`);
    assert.match(slider, /min="10"/);
    assert.match(slider, /max="110"/);
  }

  const session = createReadingSession(25);
  session.click("open-reader");
  session.key("ArrowUp");
  session.key("ArrowUp");
  assert.equal(session.get("reader-speed").value, 35);
  for (let i = 0; i < 30; i += 1) session.key("ArrowUp");
  assert.equal(session.get("reader-speed").value, 110, "speed should stop at 110");
  for (let i = 0; i < 30; i += 1) session.key("ArrowDown");
  assert.equal(session.get("reader-speed").value, 10, "speed should stop at 10");
});

test("a mouse click on a reading control hands focus back so Space plays again", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  let focused = 0;
  session.reader.focus = () => { focused += 1; };
  const clickBar = (detail, closestMatch = null) =>
    session.get("control-bar").listeners.get("click")({ detail, target: { closest: () => closestMatch } });

  clickBar(1);
  session.runTimers();
  assert.equal(focused, 1, "a mouse click should return focus to the script");

  clickBar(0);
  session.runTimers();
  assert.equal(focused, 1, "a keyboard press should keep focus on the control");

  clickBar(1, {});
  session.runTimers();
  assert.equal(focused, 1, "Edit script should not pull focus back to the reader");

  clickBar(1);
  session.get("reading-view").hidden = true;
  session.runTimers();
  assert.equal(focused, 1, "a hidden reader should not take focus");
});

test("the reading view width slider and the editor slider control the same line width", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  assert.equal(session.get("reader-width").value, 580);
  assert.equal(session.get("reader-width-value").textContent, "580");

  session.input("reader-width", 700);
  assert.equal(session.cssVar("--reading-width"), "700px");
  assert.equal(session.get("editor-width").value, 700);
  assert.equal(session.get("editor-width-value").textContent, "700 px");

  session.input("reader-width", 5000);
  assert.equal(session.get("reader-width").value, 820, "width should stop at 820");
  session.input("reader-width", 10);
  assert.equal(session.get("reader-width").value, 420, "width should stop at 420");
  session.input("reader-width", "not a number");
  assert.equal(session.get("reader-width").value, 580, "bad input falls back to the default");

  session.back();
  session.input("editor-width", 640);
  session.forward();
  assert.equal(session.get("reader-width").value, 640);
});

test("changing width while reading keeps the same place in the script", () => {
  const session = createReadingSession(25);
  session.click("open-reader");
  session.reader.scrollTop = 1600; // halfway through a 3200 px scroll
  // Narrower lines make the script taller: max scroll grows from 3200 to 4800
  // once the new width is applied, as a browser would rewrap it.
  session.onStyleChange((name, value) => {
    if (name === "--reading-width" && value === "460px") session.reader.scrollHeight = 800 + 4800;
  });
  session.input("reader-width", 460);
  assert.equal(session.reader.scrollTop, 2400, "should still be halfway");

  session.click("play-button");
  session.frames(60);
  assert.ok(Math.abs(session.reader.scrollTop - 2425) <= 1, "playback should continue from the kept place");
});

test("keeping place handles the start, the end, and scripts that fit on screen", () => {
  assert.equal(keepReadingPlace(0, 1000, 2000), 0);
  assert.equal(keepReadingPlace(1000, 1000, 2000), 2000);
  assert.equal(keepReadingPlace(250, 1000, 600), 150);
  assert.equal(keepReadingPlace(1200, 1000, 500), 500, "never past the end");
  assert.equal(keepReadingPlace(100, 0, 500), 0, "nothing to keep when the script fit before");
  assert.equal(keepReadingPlace(100, 1000, 0), 0, "top when the script now fits");
  assert.equal(keepReadingPlace(NaN, 1000, 500), 0);
});
