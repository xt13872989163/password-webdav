import type { VaultEntry } from "@password-webdav/core";

type ExtensionTheme = "fresh" | "night" | "contrast";

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

async function loadPromptTheme(): Promise<ExtensionTheme> {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const theme = (result[CONFIG_KEY] as { theme?: unknown } | undefined)?.theme;
    return theme === "night" || theme === "contrast" ? theme : "fresh";
  } catch {
    return "fresh";
  }
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

function fillEntry(entry: VaultEntry) {
  const passwordField = findPasswordField();
  if (!passwordField) {
    return { ok: false, message: "未找到密码输入框。" };
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
  return { ok: true, message: "已填充密码。", filledUsername: Boolean(usernameField && entry.username) };
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
  button.style.height = "34px";
  button.style.borderRadius = "6px";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";

  if (variant === "primary") {
    button.style.flex = "1";
    button.style.border = "0";
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
  if (theme === "night") {
    return [
      "--pwd-bg:#121e28",
      "--pwd-border:#284456",
      "--pwd-text:#e8f4f6",
      "--pwd-muted:#9bb4be",
      "--pwd-field-bg:#0c1720",
      "--pwd-button-bg:#182936",
      "--pwd-primary:#2dd4bf",
      "--pwd-primary-text:#06221f",
      "--pwd-accent-soft:rgba(45,212,191,.13)",
      "--pwd-shadow:0 18px 50px rgba(0,0,0,.42)",
    ].join(";");
  }
  if (theme === "contrast") {
    return [
      "--pwd-bg:#ffffff",
      "--pwd-border:#9fb6c4",
      "--pwd-text:#061826",
      "--pwd-muted:#365363",
      "--pwd-field-bg:#ffffff",
      "--pwd-button-bg:#ffffff",
      "--pwd-primary:#0369a1",
      "--pwd-primary-text:#ffffff",
      "--pwd-accent-soft:#e0f2fe",
      "--pwd-shadow:0 18px 50px rgba(6,24,38,.2)",
    ].join(";");
  }
  return [
    "--pwd-bg:#ffffff",
    "--pwd-border:#cbd5e1",
    "--pwd-text:#111827",
    "--pwd-muted:#4b5563",
    "--pwd-field-bg:#ffffff",
    "--pwd-button-bg:#f8fafc",
    "--pwd-primary:#0f766e",
    "--pwd-primary-text:#ffffff",
    "--pwd-accent-soft:#edf9f5",
    "--pwd-shadow:0 18px 50px rgba(15,23,42,.18)",
  ].join(";");
}

function renderSuggestionPrompt(
  anchor: HTMLInputElement,
  entries: VaultEntry[],
  message = "",
  theme: ExtensionTheme = "fresh",
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
    "border-radius:8px",
    "background:color-mix(in srgb, var(--pwd-bg) 94%, transparent)",
    "backdrop-filter:blur(14px)",
    "box-shadow:var(--pwd-shadow)",
    "font:13px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "color:var(--pwd-text)",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding:0 2px";

  const title = document.createElement("div");
  title.style.cssText = "font-weight:800;color:var(--pwd-text)";
  title.textContent = entries.length ? "可填充账号" : "Password WebDAV";

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
      "border-radius:6px",
      "padding:9px 10px",
      "background:linear-gradient(180deg,var(--pwd-accent-soft),var(--pwd-button-bg))",
      "color:var(--pwd-text)",
      "cursor:pointer",
      "text-align:left",
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.18)",
    ].join(";");

    const firstLine = document.createElement("div");
    firstLine.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:800";

    const titleText = document.createElement("span");
    titleText.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    titleText.textContent = entry.title || entry.url;

    const userText = document.createElement("span");
    userText.style.cssText = "font-size:12px;color:var(--pwd-muted);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    userText.textContent = entry.username || "未填写账号";
    firstLine.append(titleText, userText);

    const secondLine = document.createElement("div");
    secondLine.style.cssText = "font-size:12px;color:var(--pwd-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    secondLine.textContent = `${entry.url || location.hostname}${entry.folder ? ` · ${entry.folder}` : ""}`;

    row.append(firstLine, secondLine);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => {
      fillEntry(entry);
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
  const theme = await loadPromptTheme();

  if (!response?.ok) {
    removeSuggestionPrompt();
    if (response?.reason === "locked") {
      console.info("[Password WebDAV] autofill unavailable until unlocked", { host: location.hostname });
      if (anchor.type === "password" || anchor.value.trim()) {
        renderSuggestionPrompt(anchor, [], "请先打开扩展并解锁 Password WebDAV，解锁后会自动显示匹配账号。", theme);
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
  renderSuggestionPrompt(anchor, entries, "", theme);
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
  })) || { folders: [], defaultFolder: "", defaultTitle: "" };
  const promptTheme = await loadPromptTheme();

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
    "width:320px",
    "padding:14px",
    "border:1px solid var(--pwd-border)",
    "border-radius:8px",
    "background:var(--pwd-bg)",
    "box-shadow:var(--pwd-shadow)",
    "font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "color:var(--pwd-text)",
  ].join(";");

  const title = document.createElement("div");
  title.style.fontWeight = "800";
  title.style.marginBottom = "6px";
  appendText(title, "保存到 Password WebDAV？");

  const account = document.createElement("div");
  account.style.cssText = "font-size:13px;font-weight:800;color:var(--pwd-text);margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  appendText(account, candidate.username || location.hostname);

  const titleField = document.createElement("label");
  titleField.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--pwd-muted);margin-bottom:12px";
  appendText(titleField, "标题");

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "例如 GitHub";
  titleInput.value = folderOptions.defaultTitle || candidate.title || location.hostname;
  titleInput.style.cssText = "height:34px;border:1px solid var(--pwd-border);border-radius:6px;padding:0 10px;background:var(--pwd-field-bg);color:var(--pwd-text);font-weight:800";
  titleField.appendChild(titleInput);

  const folderField = document.createElement("label");
  folderField.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--pwd-muted);margin-bottom:12px";
  appendText(folderField, "文件夹");

  const folderSelect = document.createElement("select");
  folderSelect.style.cssText = "height:34px;border:1px solid var(--pwd-border);border-radius:6px;padding:0 10px;background:var(--pwd-field-bg);color:var(--pwd-text);font-weight:800";

  const rootOption = document.createElement("option");
  rootOption.value = "";
  rootOption.textContent = "无文件夹";
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

  const saveButton = createButton("保存", "primary");
  const dismissButton = createButton("不保存", "secondary");
  actions.append(saveButton, dismissButton);

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:var(--pwd-muted);margin-top:8px";

  promptEl.append(title, account, titleField, folderField, actions, status);

  dismissButton.addEventListener("click", () => {
    void sendRuntimeMessage({ type: "password-webdav.dismiss-detected-login" });
    removePrompt();
  });

  saveButton.addEventListener("click", () => {
    status.textContent = "正在保存...";
    void sendRuntimeMessage<{ ok?: boolean; message?: string }>({
      type: "password-webdav.save-detected-login",
      entry: { ...candidate, title: titleInput.value.trim() || candidate.title, folder: folderSelect.value },
    }).then((response) => {
      status.textContent = response?.message || "已处理。";
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
    if (lastCandidate && !findPasswordField()) {
      void showSavePrompt();
    }
  }, 700);
}

function handleLikelySubmit(form: HTMLFormElement | null) {
  if (!form) return;
  void stageCandidate(candidateFromForm(form));
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "password-webdav.fill-entry") {
    sendResponse(fillEntry(message.entry as VaultEntry));
    return true;
  }
  return undefined;
});
