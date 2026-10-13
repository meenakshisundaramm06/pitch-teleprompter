"use strict";

const OLD_STORAGE_KEYS = Object.freeze(["teleprompter-v3", "pitch-prompter-v2", "pitch-prompter-v1"]);
const DEFAULTS = Object.freeze({ script: "", speed: 25, size: 44, width: 580, dimming: true });

function clampNumber(value, min, max, fallback) {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clearOldStorage(storage) {
  for (const key of OLD_STORAGE_KEYS) {
    try { storage?.removeItem(key); } catch { /* The app still starts fresh if storage is blocked. */ }
  }
}

function prepareScript(script) {
  return script.replace(/\r\n?/g, "\n").replace(/\\[ \t]*(?=\n)/g, "");
}

function parseEmphasis(text) {
  const parts = [];
  const emphasis = /\*\*(?!\s)([^*\n]*?[^\s*\n])\*\*|\*(?!\s)([^*\n]*?[^\s*\n])\*/g;
  let position = 0;
  for (const match of text.matchAll(emphasis)) {
    const value = match[1] ?? match[2];
    if (match.index > position) parts.push({ kind: "text", text: text.slice(position, match.index) });
    parts.push({ kind: match[1] ? "strong" : "em", text: value });
    position = match.index + match[0].length;
  }
  if (position < text.length) parts.push({ kind: "text", text: text.slice(position) });
  return parts;
}

function estimateScrollSeconds(contentHeight, viewportHeight, speed) {
  // Keep this in step with --focus-top in styles.css.
  const top = Math.min(124, Math.max(96, viewportHeight * .12));
  const bottom = viewportHeight * .74;
  return Math.max(0, contentHeight + top + bottom - viewportHeight) / speed;
}

function formatDuration(seconds) {
  const rounded = Math.max(5, Math.round(seconds / 5) * 5);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function advancePosition(position, speed, elapsedSeconds, maxPosition) {
  const delta = Math.max(0, Math.min(.1, elapsedSeconds));
  return Math.min(maxPosition, Math.max(0, position + speed * delta));
}

function hasReachedEnd(position, maxPosition) {
  return maxPosition > 1 && position >= maxPosition - 1;
}

// When text rewraps (new width or size), the script gets taller or shorter.
// Keep the same share of the script above the reading line so you don't lose your place.
function keepReadingPlace(position, oldMax, newMax) {
  if (!Number.isFinite(position) || !(oldMax > 0) || !(newMax > 0)) return 0;
  return Math.min(1, Math.max(0, position / oldMax)) * newMax;
}

function elapsedAt(accumulatedMs, startedAtMs, nowMs) {
  return accumulatedMs + Math.max(0, nowMs - startedAtMs);
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { clampNumber, clearOldStorage, prepareScript, parseEmphasis, estimateScrollSeconds, formatDuration, advancePosition, hasReachedEnd, keepReadingPlace, elapsedAt, formatElapsed, DEFAULTS, OLD_STORAGE_KEYS };
}

if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  try { clearOldStorage(window.localStorage); } catch { /* Some browsers block storage for local files. */ }
  const state = { ...DEFAULTS };
  const editorView = $("editor-view");
  const readingView = $("reading-view");
  const scriptInput = $("script-input");
  const scriptDisplay = $("script-display");
  const scriptMeasure = $("script-measure");
  const reader = $("reader");
  const playButton = $("play-button");
  const playLabel = $("play-label");
  const playSymbol = $("play-symbol");
  const playbackStatus = $("playback-status");
  const elapsedTime = $("elapsed-time");
  const openReader = $("open-reader");
  const openHint = $("open-hint");
  const durationEstimate = $("duration-estimate");
  let playing = false;
  let frameId = null;
  let lastFrameTime = 0;
  let elapsedBeforePlay = 0;
  let playStartedAt = 0;
  let maxScrollPosition = 0;
  let scrollPosition = 0;
  let historyEnabled = false;

  try {
    window.history.replaceState({ teleprompterView: "editor" }, "");
    historyEnabled = true;
  } catch { /* Reading still works if this browser blocks same-page history. */ }

  function renderScript(container, script) {
    container.replaceChildren();
    for (const part of parseEmphasis(prepareScript(script))) {
      if (part.kind === "text") {
        container.append(document.createTextNode(part.text));
      } else {
        const node = document.createElement(part.kind);
        node.textContent = part.text;
        container.append(node);
      }
    }
  }

  function updateEstimate() {
    if (editorView.hidden) return;
    if (!state.script.trim()) {
      durationEstimate.textContent = "Add a script to estimate scroll time.";
      return;
    }
    const seconds = estimateScrollSeconds(scriptMeasure.getBoundingClientRect().height, window.innerHeight, state.speed);
    durationEstimate.textContent = seconds < 1 ? "No scrolling needed at this size." : `Estimated scroll: ~${formatDuration(seconds)}`;
  }

  function measureReader() {
    if (!readingView.hidden) {
      maxScrollPosition = Math.max(0, reader.scrollHeight - reader.clientHeight);
      scrollPosition = reader.scrollTop;
    }
  }

  function updateSettings() {
    document.documentElement.style.setProperty("--reading-size", `${state.size}px`);
    document.documentElement.style.setProperty("--reading-width", `${state.width}px`);
    document.documentElement.style.setProperty("--focus-dimming", state.dimming ? "1" : "0");
    $("editor-dimming").checked = state.dimming;
    $("reader-dimming").checked = state.dimming;
    $("editor-speed").value = state.speed;
    $("reader-speed").value = state.speed;
    $("editor-size").value = state.size;
    $("editor-width").value = state.width;
    $("reader-width").value = state.width;
    $("editor-speed-value").textContent = `${state.speed} px/s`;
    $("reader-speed-value").textContent = String(state.speed);
    $("editor-size-value").textContent = `${state.size} px`;
    $("editor-width-value").textContent = `${state.width} px`;
    $("reader-width-value").textContent = String(state.width);
    updateEstimate();
  }

  function updateScriptAvailability() {
    const hasScript = state.script.trim().length > 0;
    openReader.disabled = !hasScript;
    openHint.hidden = hasScript;
  }

  function updateElapsedTime(now = window.performance.now()) {
    const elapsed = playing ? elapsedAt(elapsedBeforePlay, playStartedAt, now) : elapsedBeforePlay;
    const label = formatElapsed(elapsed);
    if (elapsedTime.textContent !== label) elapsedTime.textContent = label;
  }

  function resetTimer() {
    elapsedBeforePlay = 0;
    playStartedAt = 0;
    updateElapsedTime();
  }

  function pause(status = "Paused") {
    if (playing) elapsedBeforePlay = elapsedAt(elapsedBeforePlay, playStartedAt, window.performance.now());
    playing = false;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
    playLabel.textContent = "Play";
    playSymbol.textContent = "▶";
    playbackStatus.textContent = status;
    updateElapsedTime();
  }

  function tick(time) {
    if (!playing) return;
    updateElapsedTime(time);
    const elapsed = (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    scrollPosition = advancePosition(scrollPosition, state.speed, elapsed, maxScrollPosition);
    reader.scrollTop = scrollPosition;
    if (hasReachedEnd(scrollPosition, maxScrollPosition) && playbackStatus.textContent !== "End of script") {
      playbackStatus.textContent = "End of script";
    }
    frameId = window.requestAnimationFrame(tick);
  }

  function play() {
    if (hasReachedEnd(reader.scrollTop, maxScrollPosition)) {
      reader.scrollTop = 0;
      resetTimer();
    }
    scrollPosition = reader.scrollTop;
    playing = true;
    playStartedAt = window.performance.now();
    lastFrameTime = playStartedAt;
    playLabel.textContent = "Pause";
    playSymbol.textContent = "Ⅱ";
    playbackStatus.textContent = maxScrollPosition > 1 ? "Scrolling" : "Reading";
    frameId = window.requestAnimationFrame(tick);
  }

  function togglePlay() { playing ? pause() : play(); }

  function restart() {
    pause("Ready");
    reader.scrollTop = 0;
    scrollPosition = 0;
    resetTimer();
    reader.focus({ preventScroll: true });
  }

  function setSpeed(value) {
    state.speed = clampNumber(value, 10, 110, DEFAULTS.speed);
    updateSettings();
  }

  // Apply a setting that rewraps the text, then keep the reader at the same place.
  function changeLayout(apply) {
    const readingVisible = !readingView.hidden;
    const oldTop = reader.scrollTop;
    const oldMax = reader.scrollHeight - reader.clientHeight;
    apply();
    updateSettings();
    if (readingVisible) reader.scrollTop = keepReadingPlace(oldTop, oldMax, reader.scrollHeight - reader.clientHeight);
    measureReader();
  }

  function setSize(value) {
    changeLayout(() => { state.size = clampNumber(value, 34, 72, DEFAULTS.size); });
  }

  function setWidth(value) {
    changeLayout(() => { state.width = clampNumber(value, 420, 820, DEFAULTS.width); });
  }

  scriptInput.value = state.script;
  renderScript(scriptMeasure, state.script);
  updateSettings();
  updateScriptAvailability();

  scriptInput.addEventListener("input", () => {
    state.script = scriptInput.value;
    renderScript(scriptMeasure, state.script);
    updateScriptAvailability();
    updateEstimate();
  });
  $("editor-speed").addEventListener("input", (event) => setSpeed(event.target.value));
  $("reader-speed").addEventListener("input", (event) => setSpeed(event.target.value));
  $("editor-size").addEventListener("input", (event) => setSize(event.target.value));
  $("editor-width").addEventListener("input", (event) => setWidth(event.target.value));
  $("reader-width").addEventListener("input", (event) => setWidth(event.target.value));
  function setDimming(event) {
    state.dimming = event.target.checked === true;
    updateSettings();
  }
  $("editor-dimming").addEventListener("change", setDimming);
  $("reader-dimming").addEventListener("change", setDimming);

  // A mouse or touch click leaves focus on the control, so the next Space would
  // press that control again instead of playing. Hand focus back to the script.
  // Keyboard presses report detail 0 and keep focus, so Tab order still works.
  $("control-bar").addEventListener("click", (event) => {
    if (event.detail === 0 || event.target.closest?.("#edit-button")) return;
    window.setTimeout(() => {
      if (!readingView.hidden) reader.focus({ preventScroll: true });
    }, 0);
  });

  window.addEventListener("pageshow", () => {
    scriptInput.value = state.script;
    updateSettings();
  });

  window.addEventListener("pagehide", () => {
    // A browser can restore an older history entry after a refresh.
    // Clear the outgoing document too, so that entry cannot restore a script.
    pause("Ready");
    Object.assign(state, DEFAULTS);
    scriptInput.value = "";
    scriptDisplay.replaceChildren();
    renderScript(scriptMeasure, "");
    readingView.hidden = true;
    editorView.hidden = false;
    reader.scrollTop = 0;
    scrollPosition = 0;
    resetTimer();
    updateSettings();
    updateScriptAvailability();
  });

  function showReader() {
    if (!state.script.trim()) return;
    renderScript(scriptDisplay, state.script);
    editorView.hidden = true;
    readingView.hidden = false;
    measureReader();
    reader.scrollTop = 0;
    scrollPosition = 0;
    pause("Ready");
    resetTimer();
    reader.focus({ preventScroll: true });
  }

  async function showEditor() {
    pause();
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* The editor is still usable. */ }
    }
    readingView.hidden = true;
    editorView.hidden = false;
    updateEstimate();
    scriptInput.focus();
  }

  openReader.addEventListener("click", () => {
    if (!state.script.trim()) return;
    if (historyEnabled) {
      try { window.history.pushState({ teleprompterView: "reader" }, ""); }
      catch { historyEnabled = false; }
    }
    showReader();
  });

  $("edit-button").addEventListener("click", () => {
    if (historyEnabled && window.history.state?.teleprompterView === "reader") window.history.back();
    else showEditor();
  });
  window.addEventListener("popstate", (event) => {
    if (event.state?.teleprompterView === "reader") showReader();
    else showEditor();
  });
  $("restart-button").addEventListener("click", restart);
  playButton.addEventListener("click", togglePlay);
  $("size-down").addEventListener("click", () => setSize(state.size - 2));
  $("size-up").addEventListener("click", () => setSize(state.size + 2));

  $("fullscreen-button").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await readingView.requestFullscreen();
    } catch {
      playbackStatus.textContent = "Full screen is unavailable here";
    }
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen-button").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
    measureReader();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) pause("Paused while hidden");
  });
  window.addEventListener("resize", () => { updateEstimate(); measureReader(); });
  if (document.fonts) document.fonts.ready.then(() => { updateEstimate(); measureReader(); });
  reader.addEventListener("wheel", () => { if (playing) pause(); }, { passive: true });
  reader.addEventListener("touchstart", () => { if (playing) pause(); }, { passive: true });

  document.addEventListener("keydown", (event) => {
    if (readingView.hidden || event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName))) return;
    if (target instanceof HTMLElement && target.tagName === "BUTTON" && event.code === "Space") return;
    if (target instanceof HTMLElement && target.tagName === "INPUT" && target.type === "checkbox" && event.code === "Space") return;
    if (target instanceof HTMLElement && target.tagName === "INPUT" && event.code !== "Space") return;
    switch (event.code) {
      case "Space":
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowUp":
        event.preventDefault();
        setSpeed(state.speed + 5);
        break;
      case "ArrowDown":
        event.preventDefault();
        setSpeed(state.speed - 5);
        break;
      case "KeyR":
        event.preventDefault();
        restart();
        break;
      default:
        break;
    }
  });
}
