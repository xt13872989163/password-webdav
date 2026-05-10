import type { VaultEntry } from "@password-webdav/core";

import { buildPageKey, classifyCurrentPage, fillLoginFields, submitPrimaryLogin } from "./contentLogin";
import { DEFAULT_SAVE_PROMPT_WAIT_MS, normalizeSavePromptWaitMs } from "./extensionState";
import type { LoginCommand } from "./loginProtocol";

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
  reason?: "locked" | "matched" | "global" | "no-match" | "error";
  entries?: VaultEntry[];
  message?: string;
}

const LOGIN_ACTION_TEXT_RE = /\b(sign in|log in|login|continue|next)\b|登录|登入|继续|下一步/i;
const LOGIN_FIELD_HINT_RE = /user(name)?|login|account|email|mail|phone|mobile|identifier|用户名|账号|账户|用户|邮箱|邮件|手机/;
const NON_LOGIN_FIELD_HINT_RE = /search|filter|query|code|otp|captcha|token|verify|verification|搜索|筛选|查询|验证码|动态码|口令/;

let lastCandidate: DetectedLoginCandidate | null = null;
let promptEl: HTMLDivElement | null = null;
let promptLoading = false;
let suggestionEl: HTMLDivElement | null = null;
let suggestionAnchor: HTMLInputElement | null = null;
let suggestionRequestId = 0;
let suggestionTimer = 0;
let suppressSuggestionsUntil = 0;
let postFillSuggestionLock: { field: HTMLInputElement; typedChars: number } | null = null;
let suggestionTypingSession: { field: HTMLInputElement; typedChars: number } | null = null;
let loginSyncTimer = 0;
let loginSyncInFlight = false;
let pendingLoginSync = false;
let savePromptWatchToken = 0;
const SUGGESTION_DELAY_MS = 80;
const POST_FILL_SUPPRESS_MS = 180;
const MIN_SUGGESTION_QUERY_LENGTH = 2;
const SAVE_PROMPT_POLL_MS = 180;
const LOGIN_SYNC_RETRY_MS = 420;
const LOGIN_SYNC_WARMUP_MS = 5000;
const LOGIN_SYNC_ACTIVE_MS = 12000;
const loginSyncWarmupUntil = Date.now() + LOGIN_SYNC_WARMUP_MS;
let loginSyncRetryUntil = 0;

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
    noPasswordField: "\u672a\u627e\u5230\u5bc6\u7801\u8f93\u5165\u6846\u3002",
    filledPassword: "\u5df2\u586b\u5145\u5bc6\u7801\u3002",
    fillableAccounts: "\u53ef\u586b\u5145\u8d26\u53f7",
    noAccount: "\u672a\u586b\u5199\u8d26\u53f7",
    unlockFirst: "\u8bf7\u5148\u6253\u5f00\u6269\u5c55\u5e76\u89e3\u9501 Password WebDAV\uff0c\u89e3\u9501\u540e\u4f1a\u81ea\u52a8\u663e\u793a\u5339\u914d\u8d26\u53f7\u3002",
    saveTitle: "\u4fdd\u5b58\u5230 Password WebDAV\uff1f",
    title: "\u6807\u9898",
    titlePlaceholder: "\u4f8b\u5982 GitHub",
    folder: "\u6587\u4ef6\u5939",
    noFolder: "\u65e0\u6587\u4ef6\u5939",
    save: "\u4fdd\u5b58",
    dismiss: "\u4e0d\u4fdd\u5b58",
    saving: "\u6b63\u5728\u4fdd\u5b58...",
    handled: "\u5df2\u5904\u7406\u3002",
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

async function loadPromptConfig(): Promise<{
  theme: ExtensionTheme;
  language: ExtensionLanguage;
  savePromptWaitMs: number;
}> {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const config = result[CONFIG_KEY] as {
      theme?: unknown;
      language?: unknown;
      savePromptWaitMs?: unknown;
    } | undefined;
    return {
      theme: normalizePromptTheme(config?.theme),
      language: normalizePromptLanguage(config?.language),
      savePromptWaitMs: normalizeSavePromptWaitMs(config?.savePromptWaitMs),
    };
  } catch {
    return {
      theme: "fresh",
      language: "zh",
      savePromptWaitMs: DEFAULT_SAVE_PROMPT_WAIT_MS,
    };
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
  return !input.disabled && !input.readOnly && input.offsetParent !== null;
}

function visiblePasswordFields(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(visibleInput);
}

function findPasswordField(root: ParentNode = document) {
  return visiblePasswordFields(root)[0] ?? null;
}

function collectEligibleLoginInputs(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input")).filter((input) => {
    if (!visibleInput(input)) return false;
    const type = input.type.toLowerCase();
    return (
      type !== "password" &&
      type !== "hidden" &&
      type !== "checkbox" &&
      type !== "radio" &&
      type !== "submit" &&
      type !== "button" &&
      type !== "reset"
    );
  });
}

function loginFieldHints(input: HTMLInputElement) {
  const autocomplete = input.getAttribute("autocomplete")?.toLowerCase() || "";
  const name = `${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
  const type = input.type.toLowerCase();
  let score = 0;

  if (autocomplete.includes("username")) score += 8;
  if (autocomplete.includes("email")) score += 7;
  if (autocomplete.includes("current-password")) score -= 8;
  if (LOGIN_FIELD_HINT_RE.test(name)) {
    score += 5;
  }
  if (NON_LOGIN_FIELD_HINT_RE.test(name)) {
    score -= 6;
  }
  if (type === "email") score += 4;
  if (type === "tel") score += 2;
  if (type === "search") score -= 5;

  return score;
}

function appearsBeforeInput(left: HTMLInputElement, right: HTMLInputElement) {
  return Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function findUsernameField(root: ParentNode = document, passwordField?: HTMLInputElement | null) {
  const inputs = collectEligibleLoginInputs(root);
  const scoped = passwordField ? inputs.filter((input) => appearsBeforeInput(input, passwordField)) : inputs;
  const candidates = scoped.length ? scoped : inputs;
  if (!candidates.length) return null;

  const hinted = candidates
    .map((input) => ({ input, score: loginFieldHints(input) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  if (hinted[0]) return hinted[0].input;

  if (!passwordField) return null;

  const fallback = candidates.filter((input) => {
    const type = input.type.toLowerCase();
    return type !== "search" && loginFieldHints(input) >= 0;
  });
  return fallback.length === 1 ? fallback[0] : fallback.at(-1) ?? null;
}

function findLoginContext(input: HTMLInputElement) {
  if (!visibleInput(input)) return null;

  if (input.form) {
    const passwordField = input.type === "password" ? input : findPasswordField(input.form);
    if (!passwordField) return null;
    const usernameField = findUsernameField(input.form, passwordField);
    if (input.type === "password" || input === usernameField) {
      return { root: input.form as ParentNode, passwordField, usernameField };
    }
  }

  let ancestor = input.parentElement;
  while (ancestor && ancestor !== document.body) {
    const passwordFields = visiblePasswordFields(ancestor);
    if (passwordFields.length === 1) {
      const passwordField = input.type === "password" ? input : passwordFields[0];
      const usernameField = findUsernameField(ancestor, passwordField);
      if (input.type === "password" || input === usernameField) {
        return { root: ancestor as ParentNode, passwordField, usernameField };
      }
    }
    ancestor = ancestor.parentElement;
  }

  const pagePasswordFields = visiblePasswordFields(document);
  if (pagePasswordFields.length === 1) {
    const passwordField = input.type === "password" ? input : pagePasswordFields[0];
    const usernameField = findUsernameField(document, passwordField);
    if (input.type === "password" || input === usernameField) {
      return { root: document as ParentNode, passwordField, usernameField };
    }
  }

  return null;
}

function fillEntry(entry: VaultEntry, text = CONTENT_TEXT.zh) {
  const passwordField = findPasswordField();
  if (!passwordField) {
    return { ok: false, message: text.noPasswordField };
  }

  suppressSuggestionsUntil = Date.now() + POST_FILL_SUPPRESS_MS;
  window.clearTimeout(suggestionTimer);
  removeSuggestionPrompt();

  const usernameField = findUsernameField(document, passwordField);
  if (usernameField && entry.username) {
    dispatchInputEvents(usernameField, entry.username);
  }
  dispatchInputEvents(passwordField, entry.password);
  resetSuggestionTypingSession();
  if (usernameField && entry.username) {
    postFillSuggestionLock = { field: usernameField, typedChars: 0 };
  } else {
    postFillSuggestionLock = null;
  }
  passwordField.focus();
  passwordField.select();
  return { ok: true, message: text.filledPassword, filledUsername: Boolean(usernameField && entry.username) };
}

function visiblePasswordCount(root: ParentNode = document) {
  return visiblePasswordFields(root).length;
}

function candidateFromFields(
  passwordField: HTMLInputElement,
  usernameField: HTMLInputElement | null,
): DetectedLoginCandidate {
  return {
    username: usernameField?.value || "",
    password: passwordField.value,
    url: location.origin,
    title: document.title || location.hostname,
  };
}

function candidateFromPasswordInput(
  input: HTMLInputElement,
  options: { trustLoginAction?: boolean } = {},
): DetectedLoginCandidate | null {
  if (!input.value) return null;
  const loginContext = findLoginContext(input);
  if (!loginContext || visiblePasswordCount(loginContext.root) !== 1) return null;
  const inspection = classifyCurrentPage(loginContext.root);
  if (!options.trustLoginAction && inspection.classification !== "login_form" && inspection.classification !== "password_only") {
    return null;
  }
  return candidateFromFields(loginContext.passwordField, loginContext.usernameField);
}

function candidateFromRoot(root: ParentNode, options: { trustLoginAction?: boolean } = {}): DetectedLoginCandidate | null {
  if (visiblePasswordCount(root) !== 1) return null;
  const passwordField = findPasswordField(root);
  if (!passwordField?.value) return null;
  const inspection = classifyCurrentPage(root);
  if (!options.trustLoginAction && inspection.classification !== "login_form" && inspection.classification !== "password_only") {
    return null;
  }
  return candidateFromFields(passwordField, findUsernameField(root, passwordField));
}

function candidateFromForm(form: HTMLFormElement): DetectedLoginCandidate | null {
  return candidateFromRoot(form);
}

function controlText(control: HTMLButtonElement | HTMLInputElement) {
  return control instanceof HTMLInputElement
    ? `${control.value} ${control.getAttribute("aria-label") || ""} ${control.title || ""}`.trim()
    : `${control.textContent || ""} ${control.getAttribute("aria-label") || ""} ${control.title || ""}`.trim();
}

function isLikelyLoginActionControl(control: HTMLButtonElement | HTMLInputElement) {
  if (control.disabled) return false;
  return LOGIN_ACTION_TEXT_RE.test(controlText(control));
}

function submitRootForControl(control: HTMLButtonElement | HTMLInputElement): ParentNode | null {
  if (control.form) return control.form;

  let ancestor = control.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (visiblePasswordCount(ancestor) === 1) return ancestor;
    ancestor = ancestor.parentElement;
  }

  return visiblePasswordCount(document) === 1 ? document : null;
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

async function dismissPendingDetectedLogin() {
  await sendRuntimeMessage({ type: "password-webdav.dismiss-detected-login" });
  lastCandidate = null;
}

function currentPromptClassification() {
  return classifyCurrentPage().classification;
}

function waitForSavePromptEligibility(maxWaitMs: number) {
  const token = ++savePromptWatchToken;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let pollTimer = 0;
    let timeoutTimer = 0;
    let observer: MutationObserver | null = null;

    const cleanup = () => {
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (timeoutTimer) {
        window.clearTimeout(timeoutTimer);
      }
      observer?.disconnect();
    };

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const check = () => {
      if (token !== savePromptWatchToken) {
        finish(false);
        return;
      }

      const classification = currentPromptClassification();
      if (classification === "already_logged_in") {
        finish(true);
        return;
      }

      if (classification === "failed") {
        void dismissPendingDetectedLogin();
        finish(false);
      }
    };

    pollTimer = window.setInterval(check, SAVE_PROMPT_POLL_MS);
    timeoutTimer = window.setTimeout(() => finish(false), maxWaitMs);

    if (document.documentElement) {
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "aria-hidden"],
      });
    }

    check();
  });
}

async function maybeShowSavePromptAfterLogin(maxWaitMs?: number) {
  if (!lastCandidate) return;

  const classification = currentPromptClassification();
  if (classification === "already_logged_in") {
    await showSavePrompt();
    return;
  }

  if (classification === "failed") {
    await dismissPendingDetectedLogin();
    return;
  }

  const { savePromptWaitMs } = await loadPromptConfig();
  const canShow = await waitForSavePromptEligibility(maxWaitMs ?? savePromptWaitMs);
  if (canShow && lastCandidate) {
    await showSavePrompt();
  }
}

function scheduleLoginTaskSync(delay = 120) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (loginSyncTimer) {
    window.clearTimeout(loginSyncTimer);
  }
  loginSyncTimer = window.setTimeout(() => {
    loginSyncTimer = 0;
    void syncLoginTaskForCurrentPage();
  }, delay);
}

async function syncLoginTaskForCurrentPage() {
  if (loginSyncInFlight) {
    pendingLoginSync = true;
    return;
  }

  loginSyncInFlight = true;
  try {
    const handshake = await sendRuntimeMessage<{ active?: boolean; taskId?: string }>({
      type: "login.handshake",
      url: location.href,
    });
    if (!handshake?.active || !handshake.taskId) {
      if (Date.now() < loginSyncWarmupUntil) {
        scheduleLoginTaskSync(LOGIN_SYNC_RETRY_MS);
      }
      return;
    }

    loginSyncRetryUntil = Date.now() + LOGIN_SYNC_ACTIVE_MS;

    const inspection = classifyCurrentPage();
    const pageKey = buildPageKey();
    const command = await sendRuntimeMessage<LoginCommand>({
      type: "login.page_state",
      taskId: handshake.taskId,
      pageKey,
      url: location.href,
      classification: inspection.classification,
      signals: inspection.signals,
    });
    if (!command || command.type !== "login.command") {
      if (Date.now() < loginSyncRetryUntil) {
        scheduleLoginTaskSync(LOGIN_SYNC_RETRY_MS);
      }
      return;
    }

    if (command.command !== "fill_and_submit") {
      if (command.command === "noop" && Date.now() < loginSyncRetryUntil) {
        scheduleLoginTaskSync(LOGIN_SYNC_RETRY_MS);
      }
      return;
    }

    const filled = fillLoginFields(command.username, command.password);
    if (!filled) {
      await sendRuntimeMessage({
        type: "login.action_done",
        taskId: handshake.taskId,
        pageKey,
        action: "fill",
        ok: false,
        url: location.href,
        error: "fill_failed",
      });
      if (Date.now() < loginSyncRetryUntil) {
        scheduleLoginTaskSync(LOGIN_SYNC_RETRY_MS);
      }
      return;
    }

    const submitted = submitPrimaryLogin();
    await sendRuntimeMessage({
      type: "login.action_done",
      taskId: handshake.taskId,
      pageKey,
      action: submitted ? "submit" : "fill",
      ok: submitted,
      url: location.href,
      error: submitted ? undefined : "submit_failed",
    });
    if (Date.now() < loginSyncRetryUntil) {
      scheduleLoginTaskSync(submitted ? 900 : LOGIN_SYNC_RETRY_MS);
    }
  } finally {
    loginSyncInFlight = false;
    if (pendingLoginSync) {
      pendingLoginSync = false;
      scheduleLoginTaskSync(120);
    }
  }
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
  return loginFieldHints(input) > 0;
}

function isLoginCandidateInput(input: HTMLInputElement) {
  if (input.type === "password") return Boolean(findLoginContext(input));
  if (!isLikelyUsernameField(input)) return false;
  const loginContext = findLoginContext(input);
  return Boolean(loginContext && loginContext.usernameField === input);
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

function suggestionQueryForAnchor(anchor: HTMLInputElement, usernameField?: HTMLInputElement | null) {
  return (anchor.type === "password" ? usernameField?.value.trim() || "" : anchor.value.trim());
}

function suggestionHostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function suggestionPathLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
  } catch {
    return "";
  }
}

function beginSuggestionTypingSession(target: HTMLInputElement) {
  suggestionTypingSession = { field: target, typedChars: 0 };
}

function resetSuggestionTypingSession() {
  suggestionTypingSession = null;
}

function noteSuggestionTyping(target: HTMLInputElement, event: Event) {
  if (!(event instanceof InputEvent) || !event.isTrusted) return;

  const session =
    suggestionTypingSession && suggestionTypingSession.field === target
      ? suggestionTypingSession
      : (suggestionTypingSession = { field: target, typedChars: 0 });

  if (typeof event.data === "string" && event.data.length > 0) {
    session.typedChars += event.data.length;
    return;
  }

  if (event.inputType.startsWith("insert")) {
    session.typedChars += MIN_SUGGESTION_QUERY_LENGTH;
  }
}

function shouldBlockSuggestionUntilTyped(anchor: HTMLInputElement) {
  const session = suggestionTypingSession;
  if (!session) return true;
  if (!document.contains(session.field)) {
    resetSuggestionTypingSession();
    return true;
  }
  if (session.field !== anchor) return true;
  return session.typedChars < MIN_SUGGESTION_QUERY_LENGTH;
}

function resetPostFillSuggestionLock() {
  postFillSuggestionLock = null;
}

function notePostFillSuggestionTyping(target: HTMLInputElement, event: Event) {
  const lock = postFillSuggestionLock;
  if (!lock || lock.field !== target || !(event instanceof InputEvent) || !event.isTrusted) return;
  if (typeof event.data === "string" && event.data.length > 0) {
    lock.typedChars += event.data.length;
  }
}

function shouldBlockPostFillSuggestion(queryField: HTMLInputElement | null, query: string) {
  const lock = postFillSuggestionLock;
  if (!lock) return false;
  if (!queryField || lock.field !== queryField || !document.contains(lock.field)) {
    resetPostFillSuggestionLock();
    return false;
  }
  if (query.length < MIN_SUGGESTION_QUERY_LENGTH || lock.typedChars < MIN_SUGGESTION_QUERY_LENGTH) {
    return true;
  }
  resetPostFillSuggestionLock();
  return false;
}

function renderSuggestionPrompt(
  anchor: HTMLInputElement,
  entries: VaultEntry[],
  message = "",
  theme: ExtensionTheme = "fresh",
  text = CONTENT_TEXT.zh,
) {
  removeSuggestionPrompt();
  removePrompt();

  suggestionAnchor = anchor;
  suggestionEl = document.createElement("div");
  suggestionEl.style.cssText = [
    promptThemeVars(theme),
    "position:fixed",
    "right:18px",
    "top:18px",
    "z-index:2147483647",
    "width:min(332px, calc(100vw - 24px))",
    "padding:12px",
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
  title.textContent = entries.length ? `${text.fillableAccounts} ${entries.length}` : "Password WebDAV";

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
      "gap:6px",
      "width:100%",
      "border:1px solid var(--pwd-border)",
      "border-radius:8px",
      "padding:10px",
      "background:linear-gradient(180deg,var(--pwd-accent-soft),var(--pwd-button-bg))",
      "color:var(--pwd-text)",
      "cursor:pointer",
      "text-align:left",
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.12)",
    ].join(";");
    styleSuggestionRow(row);

    const firstLine = document.createElement("div");
    firstLine.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:8px";

    const titleText = document.createElement("span");
    titleText.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800";
    titleText.textContent = entry.title || suggestionHostLabel(entry.url) || location.hostname;

    const badgeStack = document.createElement("div");
    badgeStack.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end";

    const pathLabel = suggestionPathLabel(entry.url);
    const badges = [entry.folder?.trim() || "", pathLabel].filter(Boolean).slice(0, 2);
    for (const badgeText of badges) {
      const badge = document.createElement("span");
      badge.style.cssText = [
        "max-width:112px",
        "padding:1px 6px",
        "border:1px solid var(--pwd-border)",
        "border-radius:999px",
        "font-size:11px",
        "line-height:18px",
        "color:var(--pwd-muted)",
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "background:var(--pwd-accent-soft)",
      ].join(";");
      badge.textContent = badgeText;
      badgeStack.appendChild(badge);
    }
    firstLine.append(titleText, badgeStack);

    const secondLine = document.createElement("div");
    secondLine.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0";

    const userText = document.createElement("span");
    userText.style.cssText = "flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--pwd-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    userText.textContent = entry.username || text.noAccount;

    const hostText = document.createElement("span");
    hostText.style.cssText = "max-width:108px;font-size:11px;color:var(--pwd-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    hostText.textContent = suggestionHostLabel(entry.url) || location.hostname;

    secondLine.replaceChildren(userText, hostText);
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

  const loginContext = findLoginContext(anchor);
  if (!loginContext) {
    removeSuggestionPrompt();
    return;
  }

  const queryField = anchor.type === "password" ? loginContext.usernameField ?? null : anchor;
  const query = suggestionQueryForAnchor(anchor, loginContext.usernameField);
  if (query.length < MIN_SUGGESTION_QUERY_LENGTH) {
    removeSuggestionPrompt();
    return;
  }
  if (shouldBlockSuggestionUntilTyped(anchor)) {
    removeSuggestionPrompt();
    return;
  }
  if (shouldBlockPostFillSuggestion(queryField, query)) {
    removeSuggestionPrompt();
    return;
  }

  const requestId = ++suggestionRequestId;
  const response = await sendRuntimeMessage<AutofillSuggestionResponse>({
    type: "password-webdav.get-autofill-suggestions",
    url: location.href,
    usernameQuery: query,
  });

  if (requestId !== suggestionRequestId) return;
  const { theme, language } = await loadPromptConfig();
  const text = CONTENT_TEXT[language];

  if (!response?.ok) {
    removeSuggestionPrompt();
    if (response?.reason === "locked") {
      console.info("[Password WebDAV] autofill unavailable until unlocked", { host: location.hostname });
      if (query.length >= MIN_SUGGESTION_QUERY_LENGTH) {
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
  const loginContext = findLoginContext(anchor);
  const queryField = anchor.type === "password" ? loginContext?.usernameField ?? null : anchor;
  const query = suggestionQueryForAnchor(anchor, loginContext?.usernameField);
  if (query.length < MIN_SUGGESTION_QUERY_LENGTH) {
    removeSuggestionPrompt();
    return;
  }
  if (shouldBlockSuggestionUntilTyped(anchor)) {
    removeSuggestionPrompt();
    return;
  }
  if (shouldBlockPostFillSuggestion(queryField, query)) {
    removeSuggestionPrompt();
    return;
  }
  suggestionAnchor = anchor;
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(() => {
    void updateAutofillSuggestions(anchor);
  }, SUGGESTION_DELAY_MS);
}

function hideSuggestionPromptSoon() {
  window.clearTimeout(suggestionTimer);
  suggestionTimer = window.setTimeout(() => {
    if (!suggestionEl?.matches(":hover") && (!suggestionAnchor || !document.contains(suggestionAnchor) || !suggestionAnchor.matches(":focus"))) {
      removeSuggestionPrompt();
    }
  }, SUGGESTION_DELAY_MS + 40);
}

async function showSavePrompt() {
  if (!lastCandidate || promptEl || promptLoading) return;
  promptLoading = true;
  removeSuggestionPrompt();
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
    "top:18px",
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
  void maybeShowSavePromptAfterLogin();
}

function handleLikelySubmit(form: HTMLFormElement | null) {
  if (!form) return;
  const candidate = candidateFromForm(form);
  if (!candidate) return;
  void stageCandidate(candidate);
  showPromptWhenLoginPageDisappears();
}

function handleLikelyLoginAction(control: HTMLButtonElement | HTMLInputElement) {
  if (control.type.toLowerCase() === "submit") {
    handleLikelySubmit(control.form ?? control.closest("form"));
    return;
  }
  if (!isLikelyLoginActionControl(control)) return;
  const root = submitRootForControl(control);
  if (!root) return;
  const candidate = candidateFromRoot(root, { trustLoginAction: true });
  if (!candidate) return;
  void stageCandidate(candidate);
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
    handleLikelyLoginAction(button);
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
        noteSuggestionTyping(target, event);
        notePostFillSuggestionTyping(target, event);
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
      beginSuggestionTypingSession(target);
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
    if (!response?.entry) return;
    lastCandidate = response.entry;
    void maybeShowSavePromptAfterLogin();
  });
}, 120);

window.addEventListener("DOMContentLoaded", () => {
  scheduleLoginTaskSync(0);
});

window.addEventListener("load", () => {
  scheduleLoginTaskSync(0);
});

window.addEventListener("pageshow", () => {
  scheduleLoginTaskSync(0);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scheduleLoginTaskSync(60);
  }
});

if (document.documentElement) {
  new MutationObserver(() => {
    scheduleLoginTaskSync(140);
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["type", "name", "autocomplete", "aria-hidden", "hidden", "class"],
  });
}

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

scheduleLoginTaskSync(180);





