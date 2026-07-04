import type { VaultEntry } from "@password-webdav/core";

type ExtensionTheme = "fresh" | "night" | "contrast" | "tech" | "forest" | "amber" | "graphite";
type ExtensionLanguage = "zh" | "en";

const CONFIG_KEY = "password-webdav.extension.config";

interface DetectedLoginCandidate {
  username: string;
  password: string;
  url: string;
  title: string;
  folder?: string;
}

interface AutofillSuggestionResponse {
  ok?: boolean;
  reason?: "locked" | "matched" | "no-match" | "error";
  entries?: VaultEntry[];
  message?: string;
}

let lastCandidate: DetectedLoginCandidate | null = null;
let promptEl: HTMLDivElement | null = null;
let promptLoading = false;
let suggestionEl: HTMLDivElement | null = null;
let suggestionAnchor: HTMLInputElement | null = null;
let suggestionRequestId = 0;
let suggestionTimer = 0;
let suppressSuggestionsUntil = 0;

const CONTENT_TEXT: Record<
  ExtensionLanguage,
  {
    noPasswordField: string;
    filledPassword: string;
    fillableAccounts: string;
    noAccount: string;
    unlockFirst: string;
    saveTitle: string;
    title: string;
    titlePlaceholder: string;
    folder: string;
    noFolder: string;
    save: string;
    dismiss: string;
    saving: string;
    handled: string;
  }
> = {
  zh: {
    noPasswordField: "未找到密码输入框。",
    filledPassword: "已填充密码。",
    fillableAccounts: "可填充账号",
    noAccount: "未填写账号",
    unlockFirst: "请先打开扩展并解锁 Password WebDAV，解锁后会自动显示匹配账号。",
    saveTitle: "保存到 Password WebDAV？",
    title: "标题",
    titlePlaceholder: "例如 GitHub",
    folder: "文件夹",
    noFolder: "无文件夹",
    save: "保存",
    dismiss: "不保存",
    saving: "正在保存...",
    handled: "已处理。",
  },
  en: {
    noPasswordField: "Password field not found.",
    filledPassword: "Password filled.",
    fillableAccounts: "Matching accounts",
    noAccount: "No account",
    unlockFirst: "Open the extension and unlock Password WebDAV first. Matching accounts will appear after unlock.",
    saveTitle: "Save to Password WebDAV?",
    title: "Title",
    titlePlaceholder: "e.g. GitHub",
    folder: "Folder",
    noFolder: "No folder",
    save: "Save",
    dismiss: "Don't save",
    saving: "Saving...",
    handled: "Done.",
  },
};

async function loadPromptConfig(): Promise<{ theme: ExtensionTheme; language: ExtensionLanguage }> {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const config = result[CONFIG_KEY] as { theme?: unknown; language?: unknown } | undefined;
    return {
      theme: normalizePromptTheme(config?.theme),
      language: normalizePromptLanguage(config?.language),
    };
  } catch {
    return { theme: "fresh", language: "zh" };
  }
}

function normalizePromptTheme(value: unknown): ExtensionTheme {
  return value === "night" ||
    value === "contrast" ||
    value === "tech" ||
    value === "forest" ||
    value === "amber" ||
    value === "graphite"
    ? value
    : "fresh";
}

function normalizePromptLanguage(value: unknown): ExtensionLanguage {
  return value === "en" ? "en" : "zh";
}

function dispatchInputEvents(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function visibleInput(input: HTMLInputElement) {
  return !input.disabled && input.offsetParent !== null;
}

function findPasswordField(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).find(visibleInput) ?? null;
}

function findUsernameField(root: ParentNode = document) {
  const preferred = root.querySelector<HTMLInputElement>(
    'input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[type="email"]',
  );
  if (preferred && visibleInput(preferred)) return preferred;

  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) =>
      visibleInput(input) &&
      input.type !== "password" &&
      input.type !== "hidden" &&
      input.type !== "checkbox" &&
      input.type !== "radio" &&
      input.type !== "submit" &&
      input.type !== "button",
  );
  return inputs[0] ?? null;
}

function fillEntry(entry: VaultEntry, text = CONTENT_TEXT.zh) {
  const passwordField = findPasswordField();
  if (!passwordField) {
    return { ok: false, message: text.noPasswordField };
  }

  suppressSuggestionsUntil = Date.now() + 5000;
  window.clearTimeout(suggestionTimer);
  removeSuggestionPrompt();

  const usernameField = findUsernameField();
  if (usernameField && entry.username) {
    dispatchInputEvents(usernameField, entry.username);
  }
  dispatchInputEvents(passwordField, entry.password);
  passwordField.focus();
  passwordField.select();
  return { ok: true, message: text.filledPassword, filledUsername: Boolean(usernameField && entry.username) };
}

function candidateFromPasswordInput(input: HTMLInputElement): DetectedLoginCandidate | null {
  if (!input.value) return null;
  const form = input.form;
  const usernameField = form ? findUsernameField(form) : findUsernameField();
  return {
    username: usernameField?.value || "",
    password: input.value,
    url: location.origin,
    title: document.title || location.hostname,
  };
}

function candidateFromForm(form: HTMLFormElement): DetectedLoginCandidate | null {
  const passwordField = findPasswordField(form);
  if (!passwordField?.value) return null;
  return candidateFromPasswordInput(passwordField);
}

function sendRuntimeMessage<T>(message: unknown) {
  return new Promise<T | undefined>((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(response as T);
    });
  });
}

function rememberCandidate(candidate: DetectedLoginCandidate | null) {
  if (!candidate) return;
  lastCandidate = candidate;
}

async function stageCandidate(candidate: DetectedLoginCandidate | null) {
  rememberCandidate(candidate);
  if (!candidate) return;
  await sendRuntimeMessage({
    type: "password-webdav.stage-detected-login",
    entry: candidate,
  });
}

function isLikelyUsernameField(input: HTMLInputElement) {
  const autocomplete = input.getAttribute("autocomplete")?.toLowerCase() || "";
  const name = `${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
  return (
    autocomplete.includes("username") ||
    autocomplete.includes("email") ||
    /user|login|account|email|mail/.test(name) ||
    input.type === "email" ||
    input.type === "text" ||
    input.type === "search"
  );
}

function isLoginCandidateInput(input: HTMLInputElement) {
  if (!visibleInput(input)) return false;
  if (input.type === "password") return true;
  if (input.type === "hidden" || input.type === "checkbox" || input.type === "radio") return false;
  const form = input.form;
  if (form && findPasswordField(form)) return true;
  return isLikelyUsernameField(input);
}

function removePrompt() {
  promptEl?.remove();
  promptEl = null;
}

function removeSuggestionPrompt() {
  suggestionEl?.remove();
  suggestionEl = null;
  suggestionAnchor = null;
}

function appendText(parent: HTMLElement, text: string) {
  parent.appendChild(document.createTextNode(text));
}

function createButton(label: string, variant: "primary" | "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.height = "36px";
  button.style.padding = "0 12px";
  button.style.borderRadius = "8px";
  button.style.fontWeight = "800";
  button.style.cursor = "pointer";
  button.style.transition = "background .16s ease,border-color .16s ease,color .16s ease,transform .16s ease";

  if (variant === "primary") {
    button.style.flex = "1";
    button.style.border = "1px solid transparent";
    button.style.background = "var(--pwd-primary)";
    button.style.color = "var(--pwd-primary-text)";
  } else {
    button.style.border = "1px solid var(--pwd-border)";
    button.style.background = "var(--pwd-button-bg)";
    button.style.color = "var(--pwd-text)";
  }

  return button;
}

function promptThemeVars(theme: ExtensionTheme) {
  const vars = getPromptThemeVarMap(theme);
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function applyPromptTheme(element: HTMLElement, theme: ExtensionTheme) {
  const vars = getPromptThemeVarMap(theme);
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value);
  }
}

function getPromptThemeVarMap(theme: ExtensionTheme): Record<string, string> {
  if (theme === "night") {
    return {
      "--pwd-bg": "#121e28",
      "--pwd-surface": "rgba(18,30,40,.94)",
      "--pwd-border": "#284456",
      "--pwd-text": "#e8f4f6",
      "--pwd-muted": "#9bb4be",
      "--pwd-field-bg": "rgba(12,23,32,.96)",
      "--pwd-button-bg": "rgba(24,41,54,.94)",
      "--pwd-primary": "#2dd4bf",
      "--pwd-primary-text": "#06221f",
      "--pwd-accent-soft": "rgba(45,212,191,.13)",
      "--pwd-hover-bg": "rgba(45,212,191,.12)",
      "--pwd-focus-ring": "rgba(45,212,191,.22)",
      "--pwd-shadow": "0 18px 50px rgba(0,0,0,.42)",
    };
  }
  if (theme === "contrast") {
    return {
      "--pwd-bg": "#ffffff",
      "--pwd-surface": "rgba(255,255,255,.98)",
      "--pwd-border": "#9fb6c4",
      "--pwd-text": "#061826",
      "--pwd-muted": "#365363",
      "--pwd-field-bg": "#ffffff",
      "--pwd-button-bg": "#ffffff",
      "--pwd-primary": "#0369a1",
      "--pwd-primary-text": "#ffffff",
      "--pwd-accent-soft": "#e0f2fe",
      "--pwd-hover-bg": "#eef8ff",
      "--pwd-focus-ring": "rgba(3,105,161,.22)",
      "--pwd-shadow": "0 18px 50px rgba(6,24,38,.2)",
    };
  }
  if (theme === "tech") {
    return {
      "--pwd-bg": "#081221",
      "--pwd-surface": "rgba(8,18,33,.94)",
      "--pwd-border": "#1b4662",
      "--pwd-text": "#e7f9ff",
      "--pwd-muted": "#8eb6c7",
      "--pwd-field-bg": "rgba(6,15,28,.96)",
      "--pwd-button-bg": "rgba(13,28,49,.94)",
      "--pwd-primary": "#22d3ee",
      "--pwd-primary-text": "#03131a",
      "--pwd-accent-soft": "rgba(34,211,238,.13)",
      "--pwd-hover-bg": "rgba(34,211,238,.12)",
      "--pwd-focus-ring": "rgba(34,211,238,.22)",
      "--pwd-shadow": "0 18px 50px rgba(0,0,0,.46)",
    };
  }
  if (theme === "forest") {
    return {
      "--pwd-bg": "#fdfffa",
      "--pwd-surface": "rgba(253,255,250,.96)",
      "--pwd-border": "#cbdcc2",
      "--pwd-text": "#20311c",
      "--pwd-muted": "#65795b",
      "--pwd-field-bg": "#fffdf8",
      "--pwd-button-bg": "#f6fbf1",
      "--pwd-primary": "#4d7c0f",
      "--pwd-primary-text": "#ffffff",
      "--pwd-accent-soft": "#eef7e8",
      "--pwd-hover-bg": "#f2f8ed",
      "--pwd-focus-ring": "rgba(77,124,15,.2)",
      "--pwd-shadow": "0 18px 50px rgba(32,49,28,.18)",
    };
  }
  if (theme === "amber") {
    return {
      "--pwd-bg": "#fffcf4",
      "--pwd-surface": "rgba(255,252,244,.96)",
      "--pwd-border": "#e3d4ba",
      "--pwd-text": "#3a2a18",
      "--pwd-muted": "#7d684e",
      "--pwd-field-bg": "#fffdf8",
      "--pwd-button-bg": "#fff8eb",
      "--pwd-primary": "#b45309",
      "--pwd-primary-text": "#ffffff",
      "--pwd-accent-soft": "#fff3d6",
      "--pwd-hover-bg": "#fff5e3",
      "--pwd-focus-ring": "rgba(180,83,9,.2)",
      "--pwd-shadow": "0 18px 50px rgba(58,42,24,.18)",
    };
  }
  if (theme === "graphite") {
    return {
      "--pwd-bg": "#1f1f23",
      "--pwd-surface": "rgba(31,31,35,.95)",
      "--pwd-border": "#4b5563",
      "--pwd-text": "#f4f4f5",
      "--pwd-muted": "#a1a1aa",
      "--pwd-field-bg": "#18181b",
      "--pwd-button-bg": "#27272a",
      "--pwd-primary": "#d4d4d8",
      "--pwd-primary-text": "#18181b",
      "--pwd-accent-soft": "rgba(161,161,170,.16)",
      "--pwd-hover-bg": "rgba(161,161,170,.12)",
      "--pwd-focus-ring": "rgba(212,212,216,.18)",
      "--pwd-shadow": "0 18px 50px rgba(0,0,0,.42)",
    };
  }
  return {
    "--pwd-bg": "#ffffff",
    "--pwd-surface": "rgba(255,255,255,.94)",
    "--pwd-border": "#cbd5e1",
    "--pwd-text": "#111827",
    "--pwd-muted": "#4b5563",
    "--pwd-field-bg": "#ffffff",
    "--pwd-button-bg": "#f8fafc",
    "--pwd-primary": "#0f766e",
    "--pwd-primary-text": "#ffffff",
    "--pwd-accent-soft": "#edf9f5",
    "--pwd-hover-bg": "#f2fbf8",
    "--pwd-focus-ring": "rgba(15,118,110,.18)",
    "--pwd-shadow": "0 18px 50px rgba(15,23,42,.18)",
  };
}

function stylePromptField(field: HTMLInputElement | HTMLSelectElement) {
  field.style.height = "36px";
  field.style.padding = "0 10px";
  field.style.border = "1px solid var(--pwd-border)";
  field.style.borderRadius = "8px";
  field.style.background = "var(--pwd-field-bg)";
  field.style.color = "var(--pwd-text)";
  field.style.fontWeight = "800";
  field.style.outline = "none";
  field.style.boxShadow = "none";
  field.style.transition = "border-color .16s ease, box-shadow .16s ease, background .16s ease";
  field.addEventListener("focus", () => {
    field.style.borderColor = "var(--pwd-primary)";
    field.style.boxShadow = "0 0 0 3px var(--pwd-focus-ring)";
  });
  field.addEventListener("blur", () => {
    field.style.borderColor = "var(--pwd-border)";
    field.style.boxShadow = "none";
  });
}

function styleSuggestionRow(row: HTMLButtonElement) {
  row.style.transition = "background .16s ease,border-color .16s ease,transform .16s ease";
  row.addEventListener("mouseenter", () => {
    row.style.background = "var(--pwd-hover-bg)";
    row.style.borderColor = "var(--pwd-primary)";
  });
  row.addEventListener("mouseleave", () => {
    row.style.background = "linear-gradient(180deg,var(--pwd-accent-soft),var(--pwd-button-bg))";
    row.style.borderColor = "var(--pwd-border)";
  });
  row.addEventListener("focus", () => {
    row.style.background = "var(--pwd-hover-bg)";
    row.style.borderColor = "var(--pwd-primary)";
  });
  row.addEventListener("blur", () => {
    row.style.background = "linear-gradient(180deg,var(--pwd-accent-soft),var(--pwd-button-bg))";
    row.style.borderColor = "var(--pwd-border)";
  });
}

function renderSuggestionPrompt(
  anchor: HTMLInputElement,
  entries: VaultEntry[],
  message = "",
  theme: ExtensionTheme = "fresh",
  text = CONTENT_TEXT.zh,
) {
  removeSuggestionPrompt();
  const rect = anchor.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  suggestionAnchor = anchor;
  suggestionEl = document.createElement("div");
  suggestionEl.style.cssText = [
    promptThemeVars(theme),
    "position:fixed",
    `left:${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`,
    `top:${Math.min(window.innerHeight - 16, rect.bottom + 8)}px`,
    "z-index:2147483647",
    "width:min(360px, calc(100vw - 24px))",
    "padding:10px",
    "border:1px solid var(--pwd-border)",
    "border-radius:10px",
    "background:var(--pwd-surface)",
    "backdrop-filter:blur(18px)",
    "box-shadow:var(--pwd-shadow)",
    "font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "color:var(--pwd-text)",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding:0 2px";

  const title = document.createElement("div");
  title.style.cssText = "font-weight:800;color:var(--pwd-text)";
  title.textContent = entries.length ? text.fillableAccounts : "Password WebDAV";

  const host = document.createElement("div");
  host.style.cssText = "font-size:12px;color:var(--pwd-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  host.textContent = location.hostname;
  header.append(title, host);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px";

  if (!entries.length && message) {
    const status = document.createElement("div");
    status.style.cssText = "font-size:12px;line-height:1.5;color:var(--pwd-muted)";
    status.textContent = message;
    list.appendChild(status);
  }

  for (const entry of entries.slice(0, 5)) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "align-items:stretch",
      "gap:2px",
      "width:100%",
      "border:1px solid var(--pwd-border)",
      "border-radius:8px",
      "padding:9px 10px",
      "background:linear-gradient(180deg,var(--pwd-accent-soft),var(--pwd-button-bg))",
      "color:var(--pwd-text)",
      "cursor:pointer",
      "text-align:left",
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.12)",
    ].join(";");
    styleSuggestionRow(row);

    const firstLine = document.createElement("div");
    firstLine.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800";

    const titleText = document.createElement("span");
    titleText.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    titleText.textContent = entry.title || entry.url;

    const userText = document.createElement("span");
    userText.style.cssText = "font-size:12px;color:var(--pwd-muted);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    userText.textContent = entry.username || text.noAccount;
    firstLine.append(titleText, userText);

    const secondLine = document.createElement("div");
    secondLine.style.cssText = "font-size:12px;color:var(--pwd-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    secondLine.textContent = `${entry.url || location.hostname}${entry.folder ? ` · ${entry.folder}` : ""}`;

    row.append(firstLine, secondLine);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => {
      fillEntry(entry, text);
      removeSuggestionPrompt();
    });
    list.appendChild(row);
  }

  suggestionEl.append(header, list);
  document.documentElement.appendChild(suggestionEl);
}

async function updateAutofillSuggestions(anchor: HTMLInputElement) {
  if (!isLoginCandidateInput(anchor)) {
    removeSuggestionPrompt();
    return;
  }

  const passwordField = findPasswordField(anchor.form ?? document);
  if (!passwordField) {
    removeSuggestionPrompt();
    return;
  }

  const requestId = ++suggestionRequestId;
  const response = await sendRuntimeMessage<AutofillSuggestionResponse>({
    type: "password-webdav.get-autofill-suggestions",
    url: location.href,
    usernameQuery: anchor.type === "password" ? "" : anchor.value.trim(),
  });

  if (requestId !== suggestionRequestId) return;
  const { theme, language } = await loadPromptConfig();
  const text = CONTENT_TEXT[language];

  if (!response?.ok) {
    removeSuggestionPrompt();
    if (response?.reason === "locked") {
      console.info("[Password WebDAV] autofill unavailable until unlocked", { host: location.hostname });
      if (anchor.type === "password" || anchor.value.trim()) {
        renderSuggestionPrompt(anchor, [], text.unlockFirst, theme, text);
      }
    }
    return;
  }

  const entries = response.entries ?? [];
  if (!entries.length) {
    removeSuggestionPrompt();
    return;
  }

  console.info("[Password WebDAV] autofill suggestions ready", {
    host: location.hostname,
    count: entries.length,
    reason: response.reason || "matched",
  });
  renderSuggestionPrompt(anchor, entries, "", theme, text);
}

function scheduleAutofillSuggestions(anchor: HTMLInputElement) {
  if (Date.now() < suppressSuggestionsUntil) {
    removeSuggestionPrompt();
    return;
  }

  if (!isLoginCandidateInput(anchor)) {
    removeSuggestionPrompt();
    return;
  }
  suggestionAnchor = anchor;
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(() => {
    void updateAutofillSuggestions(anchor);
  }, 180);
}

function hideSuggestionPromptSoon() {
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(() => {
    if (!suggestionAnchor || !document.contains(suggestionAnchor) || !suggestionAnchor.matches(":focus")) {
      removeSuggestionPrompt();
    }
  }, 180);
}

async function showSavePrompt() {
  if (!lastCandidate || promptEl || promptLoading) return;
  promptLoading = true;
  const candidate = lastCandidate;

  const folderOptions = (await sendRuntimeMessage<{
    ok?: boolean;
    folders?: string[];
    defaultFolder?: string;
    defaultTitle?: string;
    alreadySaved?: boolean;
  }>({
    type: "password-webdav.get-detected-login-folder-options",
    entry: candidate,
  })) || { folders: [], defaultFolder: "", defaultTitle: "", alreadySaved: false };
  const { theme: promptTheme, language } = await loadPromptConfig();
  const text = CONTENT_TEXT[language];

  if (folderOptions.alreadySaved) {
    await sendRuntimeMessage({ type: "password-webdav.dismiss-detected-login" });
    lastCandidate = null;
    promptLoading = false;
    return;
  }

  if (promptEl) {
    promptLoading = false;
    return;
  }

  promptEl = document.createElement("div");
  promptEl.style.cssText = [
    promptThemeVars(promptTheme),
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "width:min(332px, calc(100vw - 24px))",
    "padding:14px 14px 12px",
    "border:1px solid var(--pwd-border)",
    "border-radius:10px",
    "background:var(--pwd-surface)",
    "backdrop-filter:blur(18px)",
    "box-shadow:var(--pwd-shadow)",
    "font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "color:var(--pwd-text)",
  ].join(";");

  const title = document.createElement("div");
  title.style.fontWeight = "800";
  title.style.marginBottom = "6px";
  appendText(title, text.saveTitle);

  const account = document.createElement("div");
  account.style.cssText = "font-size:13px;font-weight:800;color:var(--pwd-text);margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  appendText(account, candidate.username || location.hostname);

  const titleField = document.createElement("label");
  titleField.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--pwd-muted);margin-bottom:12px";
  appendText(titleField, text.title);

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = text.titlePlaceholder;
  titleInput.value = folderOptions.defaultTitle || candidate.title || location.hostname;
  stylePromptField(titleInput);
  titleField.appendChild(titleInput);

  const folderField = document.createElement("label");
  folderField.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--pwd-muted);margin-bottom:12px";
  appendText(folderField, text.folder);

  const folderSelect = document.createElement("select");
  stylePromptField(folderSelect);

  const rootOption = document.createElement("option");
  rootOption.value = "";
  rootOption.textContent = text.noFolder;
  folderSelect.appendChild(rootOption);

  for (const folder of folderOptions.folders ?? []) {
    const option = document.createElement("option");
    option.value = folder;
    option.textContent = folder;
    folderSelect.appendChild(option);
  }

  folderSelect.value = folderOptions.defaultFolder || candidate.folder || "";
  folderField.appendChild(folderSelect);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginTop = "2px";

  const saveButton = createButton(text.save, "primary");
  const dismissButton = createButton(text.dismiss, "secondary");
  actions.append(saveButton, dismissButton);

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:var(--pwd-muted);margin-top:8px;min-height:18px";

  promptEl.append(title, account, titleField, folderField, actions, status);

  dismissButton.addEventListener("click", () => {
    void sendRuntimeMessage({ type: "password-webdav.dismiss-detected-login" });
    removePrompt();
  });

  saveButton.addEventListener("click", () => {
    status.textContent = text.saving;
    void sendRuntimeMessage<{ ok?: boolean; message?: string }>({
      type: "password-webdav.save-detected-login",
      entry: { ...candidate, title: titleInput.value.trim() || candidate.title, folder: folderSelect.value },
    }).then((response) => {
      status.textContent = response?.message || text.handled;
      if (response?.ok) {
        setTimeout(removePrompt, 1200);
      }
    });
  });

  document.documentElement.appendChild(promptEl);
  promptLoading = false;
}

function showPromptWhenLoginPageDisappears() {
  window.setTimeout(() => {
    if (!lastCandidate) return;
    const passwordField = findPasswordField();
    // 密码框消失（页面跳转）或被清空（SPA 登录后清场）都算登录已发生
    if (!passwordField || !passwordField.value) {
      void showSavePrompt();
    }
  }, 700);
}

let loginAttempted = false;

function handleLikelySubmit(form: HTMLFormElement | null) {
  loginAttempted = true;
  // 有 form 就从 form 读最新值；没有 form（SPA）就用 input 事件攒下的 lastCandidate
  const candidate = form ? candidateFromForm(form) : lastCandidate;
  if (candidate) {
    void stageCandidate(candidate);
  }
  showPromptWhenLoginPageDisappears();
}

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement) {
      handleLikelySubmit(form);
    }
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"], input[type="button"]',
    );
    if (!button) return;
    handleLikelySubmit(button.form ?? button.closest("form"));
  },
  true,
);

document.addEventListener(
  "input",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      if (target.type === "password") {
        rememberCandidate(candidateFromPasswordInput(target));
      }
      if (isLoginCandidateInput(target)) {
        scheduleAutofillSuggestions(target);
      }
    }
  },
  true,
);

document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      if (target.type === "password") {
        rememberCandidate(candidateFromPasswordInput(target));
      }
      if (isLoginCandidateInput(target)) {
        scheduleAutofillSuggestions(target);
      }
    }
  },
  true,
);

document.addEventListener(
  "focusin",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && isLoginCandidateInput(target)) {
      scheduleAutofillSuggestions(target);
    }
  },
  true,
);

document.addEventListener(
  "focusout",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target === suggestionAnchor) {
      hideSuggestionPromptSoon();
    }
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const form = target.form;
    if (form) {
      handleLikelySubmit(form);
      return;
    }

    const passwordField = findPasswordField();
    if (passwordField?.value) {
      void stageCandidate(candidateFromPasswordInput(passwordField));
      showPromptWhenLoginPageDisappears();
    }
  },
  true,
);

document.addEventListener(
  "scroll",
  () => {
    hideSuggestionPromptSoon();
  },
  true,
);

window.setTimeout(() => {
  void sendRuntimeMessage<{ ok?: boolean; entry?: DetectedLoginCandidate | null }>({
    type: "password-webdav.get-pending-detected-login",
    url: location.href,
  }).then((response) => {
    if (!response?.entry || findPasswordField()) return;
    lastCandidate = response.entry;
    void showSavePrompt();
  });
}, 800);

// 页面跳转前把候选 stage 到 background，避免 content script 被销毁后候选丢失
window.addEventListener("beforeunload", () => {
  if (!lastCandidate) return;
  // fire-and-forget：消息会发给 service worker，即使本页上下文销毁也能送达
  try {
    chrome.runtime.sendMessage({
      type: "password-webdav.stage-detected-login",
      entry: lastCandidate,
    });
  } catch {
    // 忽略：上下文可能已失效
  }
});

// 监听 fetch/XHR，兜底识别 SPA 登录请求（很多 SPA 不触发传统 submit 事件）
function maybeTriggerOnLoginRequest(url: string, body?: unknown) {
  if (!lastCandidate) return;
  try {
    const lowerUrl = (url || "").toLowerCase();
    const bodyText = typeof body === "string" ? body : "";
    const lowerBody = bodyText.toLowerCase();
    const isLoginLike =
      /login|signin|sign-in|sign_in|log-in|log_in|auth\/token|session|account\/login/.test(lowerUrl) ||
      (lowerBody && /login|signin|sign-in|sign_in|log-in|log_in/.test(lowerBody));
    if (isLoginLike) {
      loginAttempted = true;
      showPromptWhenLoginPageDisappears();
    }
  } catch {
    // 忽略解析错误
  }
}

const originalFetch = window.fetch;
window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : "";
    maybeTriggerOnLoginRequest(url, init?.body);
  } catch {
    // 忽略
  }
  return originalFetch.apply(this, arguments as unknown as Parameters<typeof fetch>);
};

const originalXhrOpen = XMLHttpRequest.prototype.open;
const originalXhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function patchedXhrOpen(
  this: XMLHttpRequest & { __pwdLoginUrl?: string },
  method: string,
  url: string,
  ...rest: unknown[]
) {
  this.__pwdLoginUrl = url;
  return (originalXhrOpen as (this: XMLHttpRequest, ...args: unknown[]) => void).call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function patchedXhrSend(body?: Document | XMLHttpRequestBodyInit | null) {
  try {
    maybeTriggerOnLoginRequest((this as XMLHttpRequest & { __pwdLoginUrl?: string }).__pwdLoginUrl || "", body);
  } catch {
    // 忽略
  }
  return originalXhrSend.call(this, body);
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[CONFIG_KEY]) return;
  const nextTheme = normalizePromptTheme(
    (changes[CONFIG_KEY].newValue as { theme?: unknown } | undefined)?.theme,
  );
  if (promptEl) {
    applyPromptTheme(promptEl, nextTheme);
  }
  if (suggestionEl) {
    applyPromptTheme(suggestionEl, nextTheme);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "password-webdav.fill-entry") {
    sendResponse(fillEntry(message.entry as VaultEntry));
    return true;
  }
  return undefined;
});
