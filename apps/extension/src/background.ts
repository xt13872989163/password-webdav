import {
  decryptVault,
  encryptVault,
  entryMatchesHost,
  sortEntriesForHost,
  loadVaultFile,
  mergeVaultFolders,
  normalizeFolderPath,
  nowIso,
  saveVaultFile,
  uuid,
  type PlainVault,
  type VaultEntry,
} from "@password-webdav/core";
import { loadExtensionConfig, loadSessionMasterPassword, loadUnlockedVault, saveUnlockedVault } from "./extensionState";
import type {
  LoginActionDoneMessage,
  LoginCommand,
  LoginHandshakeMessage,
  LoginPageStateMessage,
  LoginSnapshotMessage,
  LoginTask,
  ManualReason,
} from "./loginProtocol";
import { appendActionPageKey, canReuseTaskForEntry, shouldAllowPageAction } from "./loginTaskState";

const PENDING_LOGIN_KEY = "password-webdav.extension.pendingLogin";
const PENDING_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;
const LOGIN_TASKS_KEY = "password-webdav.extension.loginTasks";
const ACTIVE_LOGIN_TASK_IDS_KEY = "password-webdav.extension.activeLoginTaskIds";
const LOGIN_TASK_TIMEOUT_MS = 45 * 1000;

type ExtensionLanguage = "zh" | "en";

const BACKGROUND_TEXT: Record<
  ExtensionLanguage,
  {
    invalidCandidate: string;
    unlockBeforeSave: string;
    vaultLocked: string;
    stageFailed: string;
    suggestionsFailed: string;
    saved: string;
    saveFailed: string;
  }
> = {
  zh: {
    invalidCandidate: "没有识别到可保存的登录信息。",
    unlockBeforeSave: "请先打开插件并解锁 vault，再保存密码。",
    vaultLocked: "vault 还没有解锁。",
    stageFailed: "暂存登录信息失败。",
    suggestionsFailed: "读取自动填充建议失败。",
    saved: "已保存到 Password WebDAV。",
    saveFailed: "保存失败。",
  },
  en: {
    invalidCandidate: "No savable login information was detected.",
    unlockBeforeSave: "Open the extension and unlock the vault before saving this password.",
    vaultLocked: "The vault is not unlocked.",
    stageFailed: "Failed to stage login information.",
    suggestionsFailed: "Failed to read autofill suggestions.",
    saved: "Saved to Password WebDAV.",
    saveFailed: "Save failed.",
  },
};

interface DetectedLoginCandidate {
  username: string;
  password: string;
  url: string;
  title: string;
  detectedAt: string;
  folder: string;
}

interface AutofillSuggestionRequest {
  url: string;
  usernameQuery?: string;
}

let sessionMasterPassword = "";
const loginTasksById = new Map<string, LoginTask>();
const activeTaskIdByEntryId = new Map<string, string>();
let loginTasksLoaded = false;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: "" });
});

function urlOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function urlHost(value: string) {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function now() {
  return Date.now();
}

function isTerminalLoginTask(task: LoginTask) {
  return (
    task.state === "success" ||
    task.state === "failed" ||
    task.state === "cancelled" ||
    task.state === "timeout"
  );
}

async function ensureLoginTasksLoaded() {
  if (loginTasksLoaded) return;
  const result = await chrome.storage.session.get([LOGIN_TASKS_KEY, ACTIVE_LOGIN_TASK_IDS_KEY]);
  const storedTasks = (result[LOGIN_TASKS_KEY] as LoginTask[] | undefined) ?? [];
  const storedActive = (result[ACTIVE_LOGIN_TASK_IDS_KEY] as Record<string, string> | undefined) ?? {};

  loginTasksById.clear();
  activeTaskIdByEntryId.clear();
  for (const task of storedTasks) {
    loginTasksById.set(task.taskId, task);
  }
  for (const [entryId, taskId] of Object.entries(storedActive)) {
    activeTaskIdByEntryId.set(entryId, taskId);
  }
  loginTasksLoaded = true;
}

async function persistLoginTasks() {
  await chrome.storage.session.set({
    [LOGIN_TASKS_KEY]: [...loginTasksById.values()],
    [ACTIVE_LOGIN_TASK_IDS_KEY]: Object.fromEntries(activeTaskIdByEntryId.entries()),
  });
}

async function saveLoginTask(task: LoginTask) {
  loginTasksById.set(task.taskId, task);
  if (isTerminalLoginTask(task)) {
    if (activeTaskIdByEntryId.get(task.entryId) === task.taskId) {
      activeTaskIdByEntryId.delete(task.entryId);
    }
  } else {
    activeTaskIdByEntryId.set(task.entryId, task.taskId);
  }
  await persistLoginTasks();
  return task;
}

async function updateLoginTask(taskId: string, patch: Partial<LoginTask>) {
  const current = loginTasksById.get(taskId);
  if (!current) return null;
  const next: LoginTask = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt || nowIso(),
  };
  return saveLoginTask(next);
}

async function finishLoginTask(taskId: string, state: Extract<LoginTask["state"], "success" | "failed" | "cancelled" | "timeout" | "manual_required">, patch: Partial<LoginTask> = {}) {
  return updateLoginTask(taskId, { ...patch, state });
}

function findLoginTaskByTabId(tabId: number) {
  for (const task of loginTasksById.values()) {
    if (task.tabId === tabId) return task;
  }
  return null;
}

async function getTabIfExists(tabId: number) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function focusLoginTaskTab(task: LoginTask) {
  if (!task.tabId) return false;
  const tab = await getTabIfExists(task.tabId);
  if (!tab?.id || !tab.windowId) return false;
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  return true;
}

async function loadUnlockedEntry(entryId: string) {
  const vault = await loadUnlockedVault();
  if (!vault) return null;
  return vault.entries.find((entry) => entry.id === entryId) ?? null;
}

function createLoginTask(entry: VaultEntry, tabId: number): LoginTask {
  const timestamp = nowIso();
  return {
    taskId: uuid(),
    entryId: entry.id,
    tabId,
    targetUrl: entry.url,
    expectedHost: urlHost(entry.url),
    state: "waiting_page",
    startedAt: timestamp,
    updatedAt: timestamp,
    lastUrl: entry.url,
    submitCount: 0,
    actionPageKeys: [],
  };
}

function resolveManualReasonFromSignals(signals: LoginPageStateMessage["signals"]): ManualReason {
  if (signals.hasCaptcha) return "captcha";
  if (signals.hasOtp) return "otp";
  if (signals.hasAccountChooser) return "account_chooser";
  return "unknown";
}

async function sendLoginCommand(tabId: number, command: LoginCommand) {
  try {
    return await chrome.tabs.sendMessage(tabId, command);
  } catch {
    return null;
  }
}

async function startLoginTask(entryId: string) {
  await ensureLoginTasksLoaded();

  const existingTaskId = activeTaskIdByEntryId.get(entryId);
  if (existingTaskId) {
    const existingTask = loginTasksById.get(existingTaskId);
    if (canReuseTaskForEntry(existingTask) && existingTask?.tabId) {
      const focused = await focusLoginTaskTab(existingTask);
      if (focused) {
        return { ok: true, reused: true, task: existingTask };
      }
    }
  }

  const entry = await loadUnlockedEntry(entryId);
  if (!entry?.url) {
    return { ok: false, message: "Entry unavailable." };
  }

  const tab = await chrome.tabs.create({ url: entry.url, active: true });
  if (!tab.id) {
    return { ok: false, message: "Failed to open login tab." };
  }

  const task = await saveLoginTask(createLoginTask(entry, tab.id));
  return { ok: true, reused: false, task };
}

async function getLoginTaskStatus(taskId: string) {
  await ensureLoginTasksLoaded();
  const task = loginTasksById.get(taskId) ?? null;
  if (!task) return { ok: false, task: null };
  if (now() - Date.parse(task.startedAt) > LOGIN_TASK_TIMEOUT_MS && !isTerminalLoginTask(task)) {
    return { ok: true, task: await finishLoginTask(task.taskId, "timeout") };
  }
  return { ok: true, task };
}

async function cancelLoginTask(taskId: string) {
  await ensureLoginTasksLoaded();
  const task = loginTasksById.get(taskId);
  if (!task) return { ok: false, task: null };
  const next = await finishLoginTask(taskId, "cancelled");
  return { ok: true, task: next };
}

async function getLoginSnapshot(message: LoginSnapshotMessage) {
  await ensureLoginTasksLoaded();

  const requestedEntryIds = new Set(
    (message.entryIds ?? []).map((entryId) => String(entryId || "").trim()).filter(Boolean),
  );
  const latestByEntryId = new Map<string, LoginTask>();
  const tasks = [...loginTasksById.values()];

  for (const task of tasks) {
    if (requestedEntryIds.size > 0 && !requestedEntryIds.has(task.entryId)) {
      continue;
    }

    const normalizedTask =
      now() - Date.parse(task.startedAt) > LOGIN_TASK_TIMEOUT_MS && !isTerminalLoginTask(task)
        ? await finishLoginTask(task.taskId, "timeout")
        : task;

    if (!normalizedTask) continue;

    const current = latestByEntryId.get(normalizedTask.entryId);
    if (!current || normalizedTask.updatedAt > current.updatedAt) {
      latestByEntryId.set(normalizedTask.entryId, normalizedTask);
    }
  }

  return {
    ok: true,
    tasks: [...latestByEntryId.values()],
  };
}

async function handleLoginHandshake(message: LoginHandshakeMessage, tabId?: number) {
  await ensureLoginTasksLoaded();
  if (!tabId) return { active: false };
  const task = findLoginTaskByTabId(tabId);
  if (!task || isTerminalLoginTask(task)) return { active: false };
  await updateLoginTask(task.taskId, {
    state: "detecting",
    lastUrl: message.url || task.lastUrl,
  });
  return { active: true, taskId: task.taskId, expectedHost: task.expectedHost };
}

async function decideLoginCommand(task: LoginTask, message: LoginPageStateMessage): Promise<LoginCommand> {
  if (message.classification === "manual_required") {
    await finishLoginTask(task.taskId, "manual_required", {
      lastUrl: message.url,
      lastClassification: message.classification,
      manualReason: resolveManualReasonFromSignals(message.signals),
    });
    return {
      type: "login.command",
      command: "manual_required",
      reason: resolveManualReasonFromSignals(message.signals),
    };
  }

  if (message.classification === "failed") {
    await finishLoginTask(task.taskId, "failed", {
      lastUrl: message.url,
      lastClassification: message.classification,
      lastError: "login_failed",
    });
    return { type: "login.command", command: "noop" };
  }

  if (message.classification === "already_logged_in") {
    await finishLoginTask(task.taskId, "success", {
      lastUrl: message.url,
      lastClassification: message.classification,
    });
    return { type: "login.command", command: "finish_success" };
  }

  if (message.classification !== "login_form" && message.classification !== "password_only") {
    await updateLoginTask(task.taskId, {
      state: "waiting_page",
      lastUrl: message.url,
      lastClassification: message.classification,
    });
    return { type: "login.command", command: "noop" };
  }

  if (!shouldAllowPageAction(task, message.pageKey)) {
    await updateLoginTask(task.taskId, {
      state: "waiting_result",
      lastUrl: message.url,
      lastClassification: message.classification,
    });
    return { type: "login.command", command: "noop" };
  }

  const entry = await loadUnlockedEntry(task.entryId);
  if (!entry) {
    await finishLoginTask(task.taskId, "failed", {
      lastUrl: message.url,
      lastClassification: message.classification,
      lastError: "entry_missing",
    });
    return { type: "login.command", command: "noop" };
  }

  await saveLoginTask({
    ...task,
    state: "filling",
    lastUrl: message.url,
    lastClassification: message.classification,
    updatedAt: nowIso(),
  });

  return {
    type: "login.command",
    command: "fill_and_submit",
    taskId: task.taskId,
    pageKey: message.pageKey,
    username: entry.username,
    password: entry.password,
  };
}

async function handleLoginPageState(message: LoginPageStateMessage) {
  await ensureLoginTasksLoaded();
  const task = loginTasksById.get(message.taskId);
  if (!task) {
    return { type: "login.command", command: "noop" } satisfies LoginCommand;
  }
  if (now() - Date.parse(task.startedAt) > LOGIN_TASK_TIMEOUT_MS) {
    await finishLoginTask(task.taskId, "timeout", { lastUrl: message.url });
    return { type: "login.command", command: "manual_required", reason: "unknown" } satisfies LoginCommand;
  }
  return decideLoginCommand(task, message);
}

async function handleLoginActionDone(message: LoginActionDoneMessage) {
  await ensureLoginTasksLoaded();
  const task = loginTasksById.get(message.taskId);
  if (!task) return { ok: false };
  if (!message.ok) {
    if (message.error === "fill_failed" || message.error === "submit_failed") {
      const next = await updateLoginTask(task.taskId, {
        state: "detecting",
        lastUrl: message.url,
        lastError: message.error,
      });
      return { ok: false, task: next };
    }
    const next = await finishLoginTask(task.taskId, "failed", {
      lastUrl: message.url,
      lastError: message.error || "action_failed",
    });
    return { ok: false, task: next };
  }
  const next = await saveLoginTask(
    appendActionPageKey(
      {
        ...task,
        state: "waiting_result",
        lastUrl: message.url,
        submitCount: message.action === "submit" ? task.submitCount + 1 : task.submitCount,
        updatedAt: nowIso(),
      },
      message.pageKey,
    ),
  );
  return { ok: true, task: next };
}

function normalizeCandidate(value: unknown, language: ExtensionLanguage = "zh"): DetectedLoginCandidate {
  const candidate = value as Partial<DetectedLoginCandidate> | undefined;
  const password = String(candidate?.password || "");
  const url = String(candidate?.url || "");
  if (!password || !urlOrigin(url)) {
    throw new Error(BACKGROUND_TEXT[language].invalidCandidate);
  }

  return {
    username: String(candidate?.username || ""),
    password,
    url: urlOrigin(url),
    title: String(candidate?.title || ""),
    detectedAt: String(candidate?.detectedAt || nowIso()),
    folder: normalizeFolderPath(String(candidate?.folder || "")),
  };
}

async function savePendingLogin(candidate: DetectedLoginCandidate) {
  await chrome.storage.session.set({ [PENDING_LOGIN_KEY]: candidate });
}

async function clearPendingLogin() {
  await chrome.storage.session.remove(PENDING_LOGIN_KEY);
}

async function loadPendingLoginFor(url: string) {
  const result = await chrome.storage.session.get(PENDING_LOGIN_KEY);
  const candidate = result[PENDING_LOGIN_KEY] as DetectedLoginCandidate | undefined;
  if (!candidate) return null;

  const ageMs = Date.now() - Date.parse(candidate.detectedAt);
  if (!Number.isFinite(ageMs) || ageMs > PENDING_LOGIN_MAX_AGE_MS) {
    await clearPendingLogin();
    return null;
  }

  if (urlOrigin(url) !== urlOrigin(candidate.url)) return null;
  return candidate;
}

function entryFromCandidate(candidate: DetectedLoginCandidate) {
  const now = nowIso();
  const title = candidate.title || new URL(candidate.url).hostname.replace(/^www\./, "");
  return {
    id: uuid(),
    title,
    username: candidate.username || "",
    password: candidate.password,
    url: candidate.url,
    folder: candidate.folder,
    notes: "",
    tags: [],
    createdAt: now,
    updatedAt: now,
  } satisfies VaultEntry;
}

function upsertByUrlAndUsername(vault: PlainVault, nextEntry: VaultEntry) {
  const now = nowIso();
  const existing = vault.entries.find(
    (entry) => entry.url === nextEntry.url && entry.username === nextEntry.username,
  );
  if (!existing) {
    return {
      ...vault,
      updatedAt: now,
      folders: mergeVaultFolders(vault, [nextEntry.folder]),
      entries: [nextEntry, ...vault.entries],
    };
  }

  return {
    ...vault,
    updatedAt: now,
    entries: vault.entries.map((entry) =>
      entry.id === existing.id
        ? {
            ...entry,
            password: nextEntry.password,
            title: nextEntry.title || entry.title,
            folder: nextEntry.folder,
            updatedAt: now,
          }
        : entry,
    ),
    folders: mergeVaultFolders(vault, [nextEntry.folder]),
  };
}

function suggestionMatchScore(entry: VaultEntry, query: string) {
  const username = entry.username.toLowerCase();
  const title = entry.title.toLowerCase();
  const url = entry.url.toLowerCase();
  const folder = entry.folder.toLowerCase();

  if (username === query) return 140;
  if (title === query) return 132;
  if (url === query) return 124;
  if (folder === query) return 116;
  if (username.startsWith(query)) return 108;
  if (title.startsWith(query)) return 100;
  if (url.startsWith(query)) return 92;
  if (folder.startsWith(query)) return 84;
  if (username.includes(query)) return 76;
  if (title.includes(query)) return 68;
  if (url.includes(query)) return 60;
  if (folder.includes(query)) return 52;
  return 0;
}

async function getAutofillSuggestions(value: unknown) {
  const vault = await loadUnlockedVault();
  if (!vault) {
    return { ok: false, reason: "locked", entries: [] as VaultEntry[] };
  }

  const request = value as Partial<AutofillSuggestionRequest> | undefined;
  const url = String(request?.url || "");
  const usernameQuery = String(request?.usernameQuery || "").trim().toLowerCase();
  if (!usernameQuery) {
    return { ok: true, reason: "no-match", entries: [] as VaultEntry[] };
  }

  const host = urlOrigin(url) || url;
  const matchesQuery = (entry: VaultEntry) => suggestionMatchScore(entry, usernameQuery) > 0;
  const bySuggestionRank = (left: VaultEntry, right: VaultEntry) => {
    const scoreDiff = suggestionMatchScore(right, usernameQuery) - suggestionMatchScore(left, usernameQuery);
    if (scoreDiff !== 0) return scoreDiff;
    return right.updatedAt.localeCompare(left.updatedAt);
  };

  const hostMatches = sortEntriesForHost(vault.entries, host)
    .filter((entry) => entryMatchesHost(entry, host))
    .filter(matchesQuery)
    .sort(bySuggestionRank);

  const globalMatches = vault.entries
    .filter(matchesQuery)
    .filter((entry) => !hostMatches.some((hostEntry) => hostEntry.id === entry.id))
    .sort(bySuggestionRank);

  const entries = (hostMatches.length > 0 ? hostMatches : globalMatches).slice(0, 5);
  const reason = hostMatches.length > 0 ? "matched" : entries.length > 0 ? "global" : "no-match";

  return { ok: true, reason, entries };
}

async function getSessionMasterPassword() {
  if (sessionMasterPassword) return sessionMasterPassword;
  sessionMasterPassword = await loadSessionMasterPassword();
  return sessionMasterPassword;
}

async function getBackgroundLanguage(): Promise<ExtensionLanguage> {
  try {
    const settings = await loadExtensionConfig();
    return settings.language === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

async function getDetectedLoginFolderOptions(value: unknown) {
  const vault = await loadUnlockedVault();
  if (!vault) return { folders: [] as string[], defaultFolder: "", defaultTitle: "", alreadySaved: false };

  const language = await getBackgroundLanguage();
  const candidate = normalizeCandidate(value, language);
  const existing = vault.entries.find(
    (entry) => entry.url === candidate.url && entry.username === candidate.username,
  );
  return {
    folders: vault.folders ?? [],
    defaultFolder: normalizeFolderPath(existing?.folder || ""),
    defaultTitle: existing?.title || candidate.title,
    alreadySaved: Boolean(existing && existing.password === candidate.password),
  };
}

async function saveDetectedLogin(value: unknown) {
  const language = await getBackgroundLanguage();
  const text = BACKGROUND_TEXT[language];
  const masterPassword = await getSessionMasterPassword();
  if (!masterPassword) {
    throw new Error(text.unlockBeforeSave);
  }

  const vault = await loadUnlockedVault();
  if (!vault) {
    throw new Error(text.vaultLocked);
  }

  const settings = await loadExtensionConfig();
  const latestFile = await loadVaultFile(settings);
  const latestVault = latestFile ? await decryptVault(masterPassword, latestFile) : vault;
  const candidate = normalizeCandidate(value, language);
  const nextVault = upsertByUrlAndUsername(latestVault, entryFromCandidate(candidate));
  await saveVaultFile(settings, await encryptVault(masterPassword, nextVault));
  await saveUnlockedVault(nextVault);
  await clearPendingLogin();
  return text.saved;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void ensureLoginTasksLoaded().then(async () => {
    const task = findLoginTaskByTabId(tabId);
    if (!task || isTerminalLoginTask(task)) return;
    await finishLoginTask(task.taskId, "cancelled");
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void ensureLoginTasksLoaded().then(async () => {
    const task = findLoginTaskByTabId(tabId);
    if (!task || isTerminalLoginTask(task)) return;

    if (changeInfo.url) {
      await updateLoginTask(task.taskId, { lastUrl: changeInfo.url });
      return;
    }

    if (changeInfo.status === "complete" && task.state === "waiting_page") {
      await updateLoginTask(task.taskId, { state: "detecting" });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "password-webdav.set-master-password") {
    sessionMasterPassword = String(message.masterPassword || "");
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "password-webdav.clear-master-password") {
    sessionMasterPassword = "";
    void clearPendingLogin();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "password-webdav.stage-detected-login") {
    void Promise.resolve()
      .then(async () => normalizeCandidate(message.entry, await getBackgroundLanguage()))
      .then(savePendingLogin)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        const text = BACKGROUND_TEXT[await getBackgroundLanguage()];
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : text.stageFailed,
        });
      });
    return true;
  }

  if (message?.type === "password-webdav.get-pending-detected-login") {
    void loadPendingLoginFor(String(message.url || ""))
      .then((entry) => sendResponse({ ok: true, entry }))
      .catch(() => sendResponse({ ok: true, entry: null }));
    return true;
  }

  if (message?.type === "password-webdav.dismiss-detected-login") {
    void clearPendingLogin().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "password-webdav.get-detected-login-folder-options") {
    void getDetectedLoginFolderOptions(message.entry)
      .then((options) => sendResponse({ ok: true, ...options }))
      .catch(() => sendResponse({ ok: true, folders: [], defaultFolder: "", defaultTitle: "", alreadySaved: false }));
    return true;
  }

  if (message?.type === "password-webdav.get-autofill-suggestions") {
    void getAutofillSuggestions(message)
      .then((result) => sendResponse(result))
      .catch(async (error) => {
        const text = BACKGROUND_TEXT[await getBackgroundLanguage()];
        sendResponse({
          ok: false,
          reason: "error",
          message: error instanceof Error ? error.message : text.suggestionsFailed,
          entries: [],
        });
      });
    return true;
  }

  if (message?.type === "password-webdav.save-detected-login") {
    void saveDetectedLogin(message.entry)
      .then((message) => sendResponse({ ok: true, message }))
      .catch(async (error) => {
        const text = BACKGROUND_TEXT[await getBackgroundLanguage()];
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : text.saveFailed,
        });
      });
    return true;
  }

  if (message?.type === "login.start") {
    void startLoginTask(String(message.entryId || ""))
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "Failed to start login task.",
        }),
      );
    return true;
  }

  if (message?.type === "login.status") {
    void getLoginTaskStatus(String(message.taskId || ""))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, task: null }));
    return true;
  }

  if (message?.type === "login.cancel") {
    void cancelLoginTask(String(message.taskId || ""))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, task: null }));
    return true;
  }

  if (message?.type === "login.snapshot") {
    void getLoginSnapshot(message)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, tasks: [] }));
    return true;
  }

  if (message?.type === "login.handshake") {
    void handleLoginHandshake(message, sender.tab?.id)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ active: false }));
    return true;
  }

  if (message?.type === "login.page_state") {
    void handleLoginPageState(message)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ type: "login.command", command: "noop" }));
    return true;
  }

  if (message?.type === "login.action_done") {
    void handleLoginActionDone(message)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return undefined;
});
