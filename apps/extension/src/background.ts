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

const PENDING_LOGIN_KEY = "password-webdav.extension.pendingLogin";
const PENDING_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;

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

async function getAutofillSuggestions(value: unknown) {
  const vault = await loadUnlockedVault();
  if (!vault) {
    return { ok: false, reason: "locked", entries: [] as VaultEntry[] };
  }

  const request = value as Partial<AutofillSuggestionRequest> | undefined;
  const url = String(request?.url || "");
  const usernameQuery = String(request?.usernameQuery || "").trim().toLowerCase();
  const host = urlOrigin(url) || url;
  const hostMatches = sortEntriesForHost(vault.entries, host)
    .filter((entry) => entryMatchesHost(entry, host))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const entries = hostMatches
    .filter((entry) => {
      if (!usernameQuery) return true;
      return entry.username.toLowerCase().includes(usernameQuery) || entry.title.toLowerCase().includes(usernameQuery);
    })
    .slice(0, 5);

  return { ok: true, reason: entries.length ? "matched" : "no-match", entries };
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
  const candidateUsername = candidate.username.trim().toLowerCase();
  const candidateUrl = candidate.url;
  const existing = vault.entries.find((entry) => {
    const entryUrl = urlOrigin(entry.url) || entry.url;
    const entryUsername = entry.username.trim().toLowerCase();
    return entryUrl === candidateUrl && entryUsername === candidateUsername;
  });
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  return undefined;
});
