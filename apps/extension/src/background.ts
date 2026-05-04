import {
  decryptVault,
  encryptVault,
  loadVaultFile,
  nowIso,
  saveVaultFile,
  uuid,
  type PlainVault,
  type VaultEntry,
} from "@password-webdav/core";
import { loadExtensionConfig, loadUnlockedVault, saveUnlockedVault } from "./extensionState";

const PENDING_LOGIN_KEY = "password-webdav.extension.pendingLogin";
const PENDING_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;

interface DetectedLoginCandidate {
  username: string;
  password: string;
  url: string;
  title: string;
  detectedAt: string;
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

function normalizeCandidate(value: unknown): DetectedLoginCandidate {
  const candidate = value as Partial<DetectedLoginCandidate> | undefined;
  const password = String(candidate?.password || "");
  const url = String(candidate?.url || "");
  if (!password || !urlOrigin(url)) {
    throw new Error("没有识别到可保存的登录信息。");
  }

  return {
    username: String(candidate?.username || ""),
    password,
    url: urlOrigin(url),
    title: String(candidate?.title || ""),
    detectedAt: String(candidate?.detectedAt || nowIso()),
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
    folder: "",
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
            updatedAt: now,
          }
        : entry,
    ),
  };
}

async function saveDetectedLogin(value: unknown) {
  if (!sessionMasterPassword) {
    throw new Error("请先打开插件并解锁 vault，再保存密码。");
  }

  const vault = await loadUnlockedVault();
  if (!vault) {
    throw new Error("vault 还没有解锁。");
  }

  const settings = await loadExtensionConfig();
  const latestFile = await loadVaultFile(settings);
  const latestVault = latestFile ? await decryptVault(sessionMasterPassword, latestFile) : vault;
  const candidate = normalizeCandidate(value);
  const nextVault = upsertByUrlAndUsername(latestVault, entryFromCandidate(candidate));
  await saveVaultFile(settings, await encryptVault(sessionMasterPassword, nextVault));
  await saveUnlockedVault(nextVault);
  await clearPendingLogin();
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
      .then(() => normalizeCandidate(message.entry))
      .then(savePendingLogin)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "暂存登录信息失败。",
        }),
      );
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

  if (message?.type === "password-webdav.save-detected-login") {
    void saveDetectedLogin(message.entry)
      .then(() => sendResponse({ ok: true, message: "已保存到 Password WebDAV。" }))
      .catch((error) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "保存失败。",
        }),
      );
    return true;
  }

  return undefined;
});
