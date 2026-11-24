import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Settings {
  microphone: string;
  engine: string;
  whisperModel: string;
  groqApiKey: string;
  recordingMode: string;
  hotkey: string;
}

interface MicDevice {
  name: string;
  is_default: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

interface HistoryEntry {
  id: string;
  text: string;
  createdAt: number;
}

// DOM elements
const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const micSelect = document.getElementById("mic-select") as HTMLSelectElement;
const engineLocal = document.getElementById("engine-local")!;
const engineCloud = document.getElementById("engine-cloud")!;
const localSettings = document.getElementById("local-settings")!;
const cloudSettings = document.getElementById("cloud-settings")!;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const downloadBtn = document.getElementById("download-btn")!;
const downloadProgress = document.getElementById("download-progress")!;
const progressFill = document.getElementById("progress-fill")!;
const groqKey = document.getElementById("groq-key") as HTMLInputElement;
const modeToggle = document.getElementById("mode-toggle")!;
const modePtt = document.getElementById("mode-ptt")!;
const hotkeyText = document.getElementById("hotkey-text")!;
const historyList = document.getElementById("history-list")!;
const historyEmpty = document.getElementById("history-empty")!;
const historyEmptyTitle = document.getElementById("history-empty-title")!;
const historyEmptyDesc = document.getElementById("history-empty-desc")!;
const historyToolbar = document.getElementById("history-toolbar")!;
const historySearch = document.getElementById("history-search") as HTMLInputElement;
const clearHistoryBtn = document.getElementById("clear-history-btn") as HTMLButtonElement;
const historyCount = document.getElementById("history-count")!;
const toast = document.getElementById("toast")!;

// Section navigation
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".content-section");

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.getAttribute("data-section");
    navItems.forEach((n) => n.classList.remove("active"));
    sections.forEach((s) => s.classList.remove("active"));
    item.classList.add("active");
    document.getElementById(`section-${target}`)?.classList.add("active");

    if (target === "history") {
      loadHistory();
    }
  });
});

// Window drag — titlebar and sidebar empty space
const titlebar = document.getElementById("titlebar")!;
const sidebar = document.getElementById("sidebar")!;
const appWindow = getCurrentWindow();

titlebar.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button, select, input, a, .nav-item")) return;
  appWindow.startDragging();
});

sidebar.addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).closest("button, select, input, a, .nav-item")) return;
  appWindow.startDragging();
});

let currentSettings: Settings;

async function loadSettings() {
  currentSettings = await invoke<Settings>("get_settings");

  // Populate mic dropdown
  const mics = await invoke<MicDevice[]>("list_microphones");
  micSelect.innerHTML = "";
  mics.forEach((mic) => {
    const option = document.createElement("option");
    option.value = mic.name;
    option.textContent = mic.name + (mic.is_default ? " (default)" : "");
    micSelect.appendChild(option);
  });
  micSelect.value = currentSettings.microphone;

  // Engine
  setEngine(currentSettings.engine);

  // Model
  modelSelect.value = currentSettings.whisperModel;
  await checkModelStatus();

  // Groq key
  groqKey.value = currentSettings.groqApiKey;

  // Recording mode
  setRecordingMode(currentSettings.recordingMode);

  // Hotkey
  hotkeyText.textContent = currentSettings.hotkey.replace("CmdOrCtrl", "Cmd");
}

function setEngine(engine: string) {
  currentSettings.engine = engine;
  engineLocal.classList.toggle("active", engine === "local");
  engineCloud.classList.toggle("active", engine === "cloud");
  localSettings.classList.toggle("hidden", engine !== "local");
  cloudSettings.classList.toggle("hidden", engine !== "cloud");
}

function setRecordingMode(mode: string) {
  currentSettings.recordingMode = mode;
  modeToggle.classList.toggle("active", mode === "toggle");
  modePtt.classList.toggle("active", mode === "push-to-talk");
}

async function checkModelStatus() {
  const downloaded = await invoke<boolean>("check_model_downloaded", {
    modelSize: modelSelect.value,
  });
  downloadBtn.textContent = downloaded ? "\u2713" : "Download";
  (downloadBtn as HTMLButtonElement).disabled = downloaded;
}

async function saveSettings() {
  currentSettings.microphone = micSelect.value;
  currentSettings.whisperModel = modelSelect.value;
  currentSettings.groqApiKey = groqKey.value;
  await invoke("save_settings", { settings: currentSettings });
}

// Event listeners
engineLocal.addEventListener("click", () => {
  setEngine("local");
  saveSettings();
});

engineCloud.addEventListener("click", () => {
  setEngine("cloud");
  saveSettings();
});

micSelect.addEventListener("change", () => saveSettings());

modelSelect.addEventListener("change", async () => {
  await checkModelStatus();
  saveSettings();
});

downloadBtn.addEventListener("click", async () => {
  (downloadBtn as HTMLButtonElement).disabled = true;
  downloadProgress.classList.remove("hidden");
  progressFill.style.width = "0%";

  try {
    await invoke("download_model", { modelSize: modelSelect.value });
    downloadBtn.textContent = "\u2713";
  } catch (e) {
    downloadBtn.textContent = "Retry";
    (downloadBtn as HTMLButtonElement).disabled = false;
    console.error("Download failed:", e);
  }
  downloadProgress.classList.add("hidden");
});

groqKey.addEventListener("change", () => saveSettings());

modeToggle.addEventListener("click", () => {
  setRecordingMode("toggle");
  saveSettings();
});

modePtt.addEventListener("click", () => {
  setRecordingMode("push-to-talk");
  saveSettings();
});

// Listen for recording state changes
listen<string>("recording-state", (event) => {
  const state = event.payload;
  statusDot.className = "";
  if (state === "Recording") {
    statusDot.classList.add("recording");
    statusText.textContent = "Recording...";
  } else if (state === "Transcribing") {
    statusDot.classList.add("transcribing");
    statusText.textContent = "Transcribing...";
  } else {
    statusDot.classList.add("ready");
    statusText.textContent = "Ready";
  }
});

// Listen for download progress
listen<DownloadProgress>("download-progress", (event) => {
  const { percent } = event.payload;
  progressFill.style.width = `${percent}%`;
});

// ── History ──────────────────────────────────────────

let historyEntries: HistoryEntry[] = [];
let toastTimer: number | undefined;
let clearTimer: number | undefined;
let clearArmed = false;

const copyIcon = `<svg viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 3.5V3A1.5 1.5 0 009 1.5H4.5A1.5 1.5 0 003 3v4.5A1.5 1.5 0 004.5 9h.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const trashIcon = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M4.5 4.5l.5 8c0 .6.5 1 1 1h4c.5 0 1-.4 1-1l.5-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.8 7v4M9.2 7v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

function showToast(message: string, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2000);
}

function formatHistoryTime(createdAt: number): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (date.getTime() >= startOfToday) {
    return `Today at ${time}`;
  }
  if (date.getTime() >= startOfToday - 86_400_000) {
    return `Yesterday at ${time}`;
  }

  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }
  return `${date.toLocaleDateString([], options)} at ${time}`;
}

function renderHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const filtered = query
    ? historyEntries.filter((entry) => entry.text.toLowerCase().includes(query))
    : historyEntries;

  historyList.replaceChildren();

  const hasEntries = historyEntries.length > 0;
  historyToolbar.classList.toggle("hidden", !hasEntries);
  clearHistoryBtn.classList.toggle("hidden", !hasEntries);
  historyCount.textContent = String(historyEntries.length);
  historyCount.classList.toggle("hidden", !hasEntries);

  if (filtered.length === 0) {
    historyEmpty.classList.remove("hidden");
    if (hasEntries) {
      historyEmptyTitle.textContent = "No matches";
      historyEmptyDesc.textContent = "Try a different search term.";
    } else {
      historyEmptyTitle.textContent = "No transcriptions yet";
      historyEmptyDesc.textContent =
        "Press your hotkey and start dictating. Every transcription will be kept here.";
    }
    return;
  }

  historyEmpty.classList.add("hidden");

  filtered.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";
    item.dataset.id = entry.id;

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatHistoryTime(entry.createdAt);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "history-btn";
    copyBtn.dataset.action = "copy";
    copyBtn.title = "Copy to clipboard";
    copyBtn.innerHTML = `${copyIcon}<span>Copy</span>`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "history-btn danger";
    deleteBtn.dataset.action = "delete";
    deleteBtn.title = "Delete entry";
    deleteBtn.innerHTML = trashIcon;

    actions.append(copyBtn, deleteBtn);
    meta.append(time, actions);

    const text = document.createElement("p");
    text.className = "history-text";
    text.textContent = entry.text;

    item.append(meta, text);
    historyList.appendChild(item);
  });
}

async function loadHistory() {
  try {
    historyEntries = await invoke<HistoryEntry[]>("get_history");
    renderHistory();
  } catch (error) {
    console.error("Failed to load history:", error);
  }
}

historySearch.addEventListener("input", renderHistory);

historyList.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("[data-action]");
  if (!button) {
    return;
  }

  const item = button.closest<HTMLElement>(".history-item");
  const entry = historyEntries.find((candidate) => candidate.id === item?.dataset.id);
  if (!entry) {
    return;
  }

  if (button.dataset.action === "copy") {
    try {
      await invoke("copy_to_clipboard", { text: entry.text });
      const label = button.querySelector("span");
      if (label) {
        label.textContent = "Copied";
        button.classList.add("copied");
        window.setTimeout(() => {
          label.textContent = "Copy";
          button.classList.remove("copied");
        }, 1500);
      }
      showToast("Copied to clipboard");
    } catch (error) {
      console.error("Copy failed:", error);
      showToast("Couldn't copy text", true);
    }
  } else if (button.dataset.action === "delete") {
    try {
      historyEntries = await invoke<HistoryEntry[]>("delete_history_entry", { id: entry.id });
      renderHistory();
      showToast("Entry deleted");
    } catch (error) {
      console.error("Delete failed:", error);
      showToast("Couldn't delete entry", true);
    }
  }
});

function resetClearButton() {
  clearArmed = false;
  clearHistoryBtn.textContent = "Clear all";
  clearHistoryBtn.classList.remove("danger");
  if (clearTimer) {
    window.clearTimeout(clearTimer);
    clearTimer = undefined;
  }
}

clearHistoryBtn.addEventListener("click", async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearHistoryBtn.textContent = "Click again to confirm";
    clearHistoryBtn.classList.add("danger");
    clearTimer = window.setTimeout(resetClearButton, 3000);
    return;
  }

  resetClearButton();

  try {
    await invoke("clear_history");
    historyEntries = [];
    historySearch.value = "";
    renderHistory();
    showToast("History cleared");
  } catch (error) {
    console.error("Clear history failed:", error);
    showToast("Couldn't clear history", true);
  }
});

// A new transcription was saved by the backend.
listen("history-updated", () => {
  loadHistory();
});

// Initialize
loadSettings();
loadHistory();
