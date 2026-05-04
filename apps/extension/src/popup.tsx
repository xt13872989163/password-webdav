import {
  ArrowLeft,
  Dices,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  GripVertical,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  createEmptyVault,
  decryptVault,
  encryptVault,
  entryFolder,
  entryMatchesFolderTree,
  extractHost,
  generatePassword,
  loadVaultFile,
  mergeVaultFolders,
  moveEntryToFolder,
  moveVaultFolder,
  normalizeFolderPath,
  normalizeStoredVaultPath,
  nowIso,
  removeVaultFolder,
  renameVaultFolder,
  resolveVaultUrl,
  saveVaultFile,
  sortEntriesForHost,
  sortFolders,
  VAULT_ROOT_FOLDER,
  uuid,
  type PlainVault,
  type VaultEntry,
  type WebDavConfig,
} from "@password-webdav/core";
import {
  clearSessionMasterPassword,
  clearUnlockedVault,
  DEFAULT_EXTENSION_CONFIG,
  getExtensionVaultSubpath,
  loadExtensionConfig,
  loadSessionMasterPassword,
  loadUnlockedVault,
  saveExtensionConfig,
  saveSessionMasterPassword,
  saveUnlockedVault,
} from "./extensionState";
import "./popup.css";

const ALL_FOLDERS = "__all__";
const UNCATEGORIZED_FOLDER = "__uncategorized__";
const TITLE_SUGGESTIONS_ID = "pw-title-suggestions";
const URL_SUGGESTIONS_ID = "pw-url-suggestions";
const USERNAME_SUGGESTIONS_ID = "pw-username-suggestions";
const FOLDER_SUGGESTIONS_ID = "pw-folder-suggestions";
const DEBUG_LOG_KEY = "password-webdav.popup-debug-log";

type BrowseMode = "folders" | "all";
type DragItem =
  | { type: "entry"; entryId: string }
  | { type: "folder"; folder: string }
  | null;

function folderDisplayName(folder: string) {
  const parts = folder.split("/").filter(Boolean);
  return parts[parts.length - 1] || folder;
}

function folderFilterLabel(folder: string) {
  if (folder === ALL_FOLDERS) return "全部";
  if (folder === UNCATEGORIZED_FOLDER) return "未分类";
  return folder;
}

function uniqueNonEmpty(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function byMostRecent(left: VaultEntry, right: VaultEntry) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function currentHost(value: string) {
  return extractHost(value);
}

function isNewDraftEntry(vault: PlainVault | null, entry: VaultEntry | null) {
  if (!vault || !entry) return false;
  return !vault.entries.some((item) => item.id === entry.id);
}

function findExactDraftMatch(vault: PlainVault, entry: VaultEntry, fallbackHost: string) {
  const host = currentHost(entry.url || fallbackHost);
  const candidates = [...sortEntriesForHost(vault.entries, host)].sort(byMostRecent);
  const username = entry.username.trim().toLowerCase();
  if (username) {
    const exactUsername = candidates.find(
      (candidate) =>
        candidate.username.trim().toLowerCase() === username &&
        (!host || currentHost(candidate.url) === host),
    );
    if (exactUsername) return exactUsername;
  }

  const url = entry.url.trim().toLowerCase();
  if (url) {
    const exactUrl = candidates.find((candidate) => candidate.url.trim().toLowerCase() === url);
    if (exactUrl) return exactUrl;
  }

  const title = entry.title.trim().toLowerCase();
  if (title) {
    const exactTitle = candidates.find(
      (candidate) =>
        candidate.title.trim().toLowerCase() === title &&
        (!host || currentHost(candidate.url) === host),
    );
    if (exactTitle) return exactTitle;
  }

  return null;
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? "";
}

function createEntry(
  host = "",
  folder = "",
  defaults: Partial<Pick<VaultEntry, "title" | "username" | "url" | "folder">> = {},
): VaultEntry {
  const now = nowIso();
  return {
    id: uuid(),
    title: defaults.title || host || "新条目",
    username: defaults.username || "",
    password: generatePassword(),
    url: defaults.url || (host ? `https://${host}` : ""),
    folder: normalizeFolderPath(defaults.folder || folder),
    notes: "",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function tagsToText(tags: string[]) {
  return tags.join(", ");
}

function textToTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function upsertEntry(vault: PlainVault, entry: VaultEntry): PlainVault {
  const now = nowIso();
  const nextEntry = { ...entry, folder: normalizeFolderPath(entry.folder || ""), updatedAt: now };
  const exists = vault.entries.some((item) => item.id === entry.id);
  return {
    ...vault,
    updatedAt: now,
    folders: mergeVaultFolders(vault, [nextEntry.folder || ""]),
    entries: exists
      ? vault.entries.map((item) => (item.id === entry.id ? nextEntry : item))
      : [nextEntry, ...vault.entries],
  };
}

function removeEntry(vault: PlainVault, id: string): PlainVault {
  return {
    ...vault,
    updatedAt: nowIso(),
    entries: vault.entries.filter((entry) => entry.id !== id),
  };
}

function validateUnlock(settings: WebDavConfig, masterPassword: string) {
  if (!settings.baseUrl.trim()) return "请填写 WebDAV 根地址。";
  if (!settings.username.trim()) return "请填写 WebDAV 用户名。";
  if (!settings.password) return "请填写 WebDAV 密码或应用密码。";
  if (!getExtensionVaultSubpath(settings).trim()) return "请填写 vault 子路径。";
  if (masterPassword.length < 8) return "主密码至少需要 8 位。";
  return "";
}

function deriveNewEntryDefaults(vault: PlainVault | null, host: string, activeFolder: string) {
  const folderFromSidebar =
    activeFolder !== ALL_FOLDERS && activeFolder !== UNCATEGORIZED_FOLDER ? activeFolder : "";
  if (!vault || !host) {
    return {
      title: host || "新条目",
      username: "",
      url: host ? `https://${host}` : "",
      folder: folderFromSidebar,
    };
  }

  const matches = sortEntriesForHost(vault.entries, host)
    .filter((entry) => currentHost(entry.url) === host)
    .sort(byMostRecent);
  const usernames = uniqueNonEmpty(matches.map((entry) => entry.username));
  const latest = matches[0];

  return {
    title: latest?.title || host || "新条目",
    username: usernames.length === 1 ? usernames[0] : "",
    url: latest?.url || `https://${host}`,
    folder: folderFromSidebar || (latest ? entryFolder(latest) : ""),
  };
}

function rebasePath(path: string, source: string, target: string) {
  const normalizedPath = normalizeFolderPath(path);
  const normalizedSource = normalizeFolderPath(source);
  const normalizedTarget = normalizeFolderPath(target);
  if (normalizedPath === normalizedSource) return normalizedTarget;
  if (normalizedPath.startsWith(`${normalizedSource}/`)) {
    return `${normalizedTarget}${normalizedPath.slice(normalizedSource.length)}`;
  }
  return normalizedPath;
}

function loadDebugLog() {
  try {
    const raw = localStorage.getItem(DEBUG_LOG_KEY);
    if (!raw) return [] as string[];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDebugLog(lines: string[]) {
  try {
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(lines.slice(-12)));
  } catch {
    // ignore localStorage failures
  }
}

function formatUnlockError(error: unknown, settings: WebDavConfig) {
  const raw = error instanceof Error ? error.message : "解锁失败。";
  const url = resolveVaultUrl(settings);
  if (/timed out/i.test(raw)) {
    return `连接 WebDAV 超时，请检查网络、WebDAV 地址或服务响应。目标地址：${url}。${raw}`;
  }
  if (/401|403/i.test(raw)) {
    return `WebDAV 认证失败，请检查用户名和应用密码。目标地址：${url}`;
  }
  if (/404|409/i.test(raw)) {
    return `WebDAV 路径未就绪，正在尝试创建目录时失败。目标地址：${url}`;
  }
  if (/Failed to load vault from WebDAV/i.test(raw)) {
    return `无法读取 WebDAV 上的 vault。目标地址：${url}。${raw}`;
  }
  if (/Failed to save vault to WebDAV/i.test(raw)) {
    return `无法写入 WebDAV 上的 vault。目标地址：${url}。${raw}`;
  }
  if (/Failed to create WebDAV directory/i.test(raw)) {
    return `无法创建 WebDAV 目录。目标地址：${url}。${raw}`;
  }
  return raw;
}

function PopupApp() {
  const [settings, setSettings] = useState<WebDavConfig>(DEFAULT_EXTENSION_CONFIG);
  const [masterPassword, setMasterPassword] = useState("");
  const [vault, setVault] = useState<PlainVault | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [tabUrl, setTabUrl] = useState("");
  const [activeFolder, setActiveFolder] = useState<string>(ALL_FOLDERS);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [browseMode, setBrowseMode] = useState<BrowseMode>("folders");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revealedEntryId, setRevealedEntryId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragItem>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>(() => loadDebugLog());

  function appendDebugLog(message: string) {
    const line = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}`;
    setDebugLog((current) => {
      const next = [...current, line].slice(-12);
      saveDebugLog(next);
      return next;
    });
  }

  function clearDebugLog() {
    setDebugLog([]);
    saveDebugLog([]);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextSettings, savedVault, sessionMasterPassword, nextTabUrl] = await Promise.all([
        loadExtensionConfig(),
        loadUnlockedVault(),
        loadSessionMasterPassword(),
        getActiveTabUrl(),
      ]);

      if (cancelled) return;

      setSettings(nextSettings);
      setVault(savedVault);
      setSelectedEntry(savedVault?.entries[0] ?? null);
      setMasterPassword(savedVault ? sessionMasterPassword : "");
      setTabUrl(nextTabUrl);

      if (savedVault && sessionMasterPassword) {
        await chrome.runtime.sendMessage({
          type: "password-webdav.set-master-password",
          masterPassword: sessionMasterPassword,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRevealedEntryId(null);
  }, [browseMode, settingsOpen, activeFolder, query]);

  const host = useMemo(() => currentHost(tabUrl), [tabUrl]);
  const vaultSubpath = useMemo(() => getExtensionVaultSubpath(settings), [settings]);
  const selectedEntryIsNew = useMemo(() => isNewDraftEntry(vault, selectedEntry), [selectedEntry, vault]);
  const draftHost = useMemo(() => currentHost(selectedEntry?.url || tabUrl), [selectedEntry, tabUrl]);

  const entries = useMemo(() => {
    const source = vault?.entries ?? [];
    const visibleByFolder = source.filter((entry) => {
      if (activeFolder === ALL_FOLDERS) return true;
      if (activeFolder === UNCATEGORIZED_FOLDER) return !entryFolder(entry);
      return entryMatchesFolderTree(entry, activeFolder);
    });
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? visibleByFolder.filter((entry) =>
          [entry.title, entry.username, entry.url, entry.notes, entryFolder(entry), ...entry.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : visibleByFolder;
    return [...sortEntriesForHost(filtered, host || query)].sort(byMostRecent);
  }, [activeFolder, host, query, vault]);

  const allEntries = useMemo(() => {
    const source = vault?.entries ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? source.filter((entry) =>
          [entry.title, entry.username, entry.url, entry.notes, entryFolder(entry), ...entry.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : source;
    return [...sortEntriesForHost(filtered, host || query)].sort(byMostRecent);
  }, [host, query, vault]);

  const folderOptions = useMemo(() => {
    if (!vault) return [] as string[];
    return sortFolders(mergeVaultFolders(vault, vault.entries.map(entryFolder)));
  }, [vault]);

  const suggestedEntries = useMemo(() => {
    if (!vault) return [] as VaultEntry[];
    return [...sortEntriesForHost(vault.entries, draftHost || host)].sort(byMostRecent).slice(0, 12);
  }, [draftHost, host, vault]);

  const titleSuggestions = useMemo(
    () =>
      uniqueNonEmpty([
        ...suggestedEntries.map((entry) => entry.title),
        ...(vault?.entries ?? []).map((entry) => entry.title),
      ]).slice(0, 12),
    [suggestedEntries, vault],
  );
  const urlSuggestions = useMemo(
    () =>
      uniqueNonEmpty([
        ...suggestedEntries.map((entry) => entry.url),
        ...(vault?.entries ?? []).map((entry) => entry.url),
      ]).slice(0, 12),
    [suggestedEntries, vault],
  );
  const usernameSuggestions = useMemo(
    () =>
      uniqueNonEmpty([
        ...suggestedEntries.map((entry) => entry.username),
        ...(vault?.entries ?? []).map((entry) => entry.username),
      ]).slice(0, 12),
    [suggestedEntries, vault],
  );
  const quickUsernameSuggestions = useMemo(
    () => suggestedEntries.filter((entry) => entry.username).slice(0, 4),
    [suggestedEntries],
  );

  function updateVaultSubpath(value: string) {
    setSettings((current) => ({ ...current, vaultPath: normalizeStoredVaultPath(value) }));
  }

  function updateSelectedEntry(next: VaultEntry, autoMatchLabel = "") {
    if (!selectedEntry) return;
    if (vault && selectedEntryIsNew) {
      const match = findExactDraftMatch(vault, next, tabUrl);
      if (match && match.id !== selectedEntry.id) {
        setSelectedEntry(match);
        setDirty(false);
        if (autoMatchLabel) {
          setStatus(`已根据${autoMatchLabel}匹配到现有账号，并带出密码与文件夹。`);
        }
        return;
      }
    }

    setSelectedEntry(next);
    setDirty(true);
  }

  function applySuggestedEntry(entry: VaultEntry) {
    setSelectedEntry(entry);
    setDirty(false);
    setStatus("已切换到匹配账号，可以继续编辑后保存同步。");
  }

  async function persistVault(nextVault: PlainVault, nextStatus = "已同步到 WebDAV。") {
    const encrypted = await encryptVault(masterPassword, nextVault);
    await saveVaultFile(settings, encrypted);
    await saveUnlockedVault(nextVault);
    setVault(nextVault);
    setDirty(false);
    setStatus(nextStatus);
  }

  async function rememberMasterPasswordForBackground() {
    await saveSessionMasterPassword(masterPassword);
    await chrome.runtime.sendMessage({
      type: "password-webdav.set-master-password",
      masterPassword,
    });
  }

  async function handleUnlock() {
    const error = validateUnlock(settings, masterPassword);
    if (error) {
      appendDebugLog(`校验失败：${error}`);
      console.warn("[Password WebDAV] unlock validation failed", {
        baseUrl: settings.baseUrl,
        username: settings.username,
        vaultPath: settings.vaultPath,
        error,
      });
      setStatus(error);
      return;
    }

    setBusy(true);
    setStatus("正在检查 WebDAV 连接...");
    appendDebugLog(`开始解锁：${resolveVaultUrl(settings)}`);
    console.info("[Password WebDAV] unlock start", {
      baseUrl: settings.baseUrl,
      username: settings.username,
      vaultPath: settings.vaultPath,
    });
    try {
      await saveExtensionConfig(settings);
      appendDebugLog("配置已保存，开始读取 WebDAV vault");
      const file = await loadVaultFile(settings);
      if (!file) {
        const nextVault = createEmptyVault();
        setStatus("未找到 vault，正在创建新的加密密码库...");
        appendDebugLog("未找到远端 vault，开始创建新的加密密码库");
        console.info("[Password WebDAV] vault not found, creating new encrypted vault");
        await persistVault(nextVault, "WebDAV 上没有找到 vault，已创建新的加密密码库。");
        await rememberMasterPasswordForBackground();
        setSelectedEntry(null);
        appendDebugLog("新 vault 创建成功，当前会话已解锁");
        console.info("[Password WebDAV] vault created and unlocked");
        return;
      }

      setStatus("正在解密并载入密码库...");
      appendDebugLog("远端 vault 已读取，开始解密");
      const plain = await decryptVault(masterPassword, file);
      await saveUnlockedVault(plain);
      await rememberMasterPasswordForBackground();
      setVault(plain);
      setSelectedEntry(plain.entries[0] ?? null);
      setDirty(false);
      setStatus(`已解锁 ${plain.entries.length} 条密码。`);
      appendDebugLog(`解锁成功：${plain.entries.length} 条密码`);
      console.info("[Password WebDAV] unlock success", { entryCount: plain.entries.length });
    } catch (error) {
      console.error("[Password WebDAV] unlock failed", {
        error,
        baseUrl: settings.baseUrl,
        username: settings.username,
        vaultPath: settings.vaultPath,
      });
      const formatted = formatUnlockError(error, settings);
      appendDebugLog(`解锁失败：${formatted}`);
      setStatus(formatted);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!masterPassword) {
      setStatus("刷新前需要会话主密码，请先重新解锁。");
      return;
    }

    setBusy(true);
    setStatus("正在刷新...");
    try {
      const file = await loadVaultFile(settings);
      if (!file) {
        throw new Error("WebDAV 上没有找到 vault 文件。");
      }
      const plain = await decryptVault(masterPassword, file);
      await saveUnlockedVault(plain);
      setVault(plain);
      setSelectedEntry(plain.entries.find((entry) => entry.id === selectedEntry?.id) ?? plain.entries[0] ?? null);
      setDirty(false);
      setStatus("已从 WebDAV 刷新。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "刷新失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSelected() {
    if (!vault || !selectedEntry) return;
    setBusy(true);
    setStatus("正在加密并同步...");
    try {
      const nextVault = upsertEntry(vault, selectedEntry);
      await persistVault(nextVault);
      setSelectedEntry(nextVault.entries.find((entry) => entry.id === selectedEntry.id) ?? selectedEntry);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败。");
      setDirty(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entryId: string) {
    if (!vault) return;
    setBusy(true);
    setStatus("正在删除并同步...");
    try {
      const nextVault = removeEntry(vault, entryId);
      await persistVault(nextVault, "已删除并同步到 WebDAV。");
      setSelectedEntry((current) => {
        if (!current || current.id === entryId) {
          return nextVault.entries[0] ?? null;
        }
        return nextVault.entries.find((entry) => entry.id === current.id) ?? nextVault.entries[0] ?? null;
      });
      if (revealedEntryId === entryId) {
        setRevealedEntryId(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFolder(folder: string) {
    if (!vault) return;
    const normalized = normalizeFolderPath(folder);
    if (!normalized) return;

    setBusy(true);
    setStatus(`正在删除文件夹 ${normalized}...`);
    try {
      const nextVault = removeVaultFolder(vault, normalized);
      await persistVault(nextVault, `已删除文件夹 ${normalized}，其中条目已移动到未分类。`);
      setActiveFolder(UNCATEGORIZED_FOLDER);
      setSelectedEntry((current) => {
        if (!current) return nextVault.entries[0] ?? null;
        return nextVault.entries.find((entry) => entry.id === current.id) ?? nextVault.entries[0] ?? null;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除文件夹失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFolder() {
    if (!vault) return;
    const folder = normalizeFolderPath(newFolderPath);
    if (!folder) {
      setStatus("请填写文件夹路径，例如 工作/GitHub。");
      return;
    }

    setBusy(true);
    setStatus("正在创建文件夹...");
    try {
      const nextVault = {
        ...vault,
        updatedAt: nowIso(),
        folders: mergeVaultFolders(vault, [folder]),
      };
      await persistVault(nextVault, `已创建文件夹：${folder}`);
      setActiveFolder(folder);
      setNewFolderPath("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创建文件夹失败。");
    } finally {
      setBusy(false);
    }
  }

  function handleAdd() {
    const defaults = deriveNewEntryDefaults(vault, host, activeFolder);
    const entry = createEntry(host, defaults.folder, defaults);
    setSelectedEntry(entry);
    setDirty(true);
    setSettingsOpen(true);
    setStatus("已新建条目，请在详情里补全并保存。");
  }

  async function copyToClipboard(value: string, label: string) {
    if (!value) {
      setStatus(`${label}为空。`);
      return;
    }
    await navigator.clipboard.writeText(value);
    setStatus(`已复制${label}。`);
  }

  async function lockVault() {
    await clearSessionMasterPassword();
    await clearUnlockedVault();
    await chrome.runtime.sendMessage({ type: "password-webdav.clear-master-password" });
    setVault(null);
    setSelectedEntry(null);
    setMasterPassword("");
    setDirty(false);
    setSettingsOpen(false);
    setRevealedEntryId(null);
    setStatus("已锁定。");
  }

  async function handleSaveSettings() {
    await saveExtensionConfig(settings);
    setStatus("已保存设置。");
  }

  function beginRenameFolder(folder: string) {
    setRenamingFolder(folder);
    setRenamingValue(folderDisplayName(folder));
  }

  async function commitRenameFolder() {
    if (!vault || !renamingFolder) return;
    const nextName = normalizeFolderPath(renamingValue);
    if (!nextName) {
      setStatus("文件夹名称不能为空。");
      return;
    }
    const source = renamingFolder;
    setBusy(true);
    try {
      const nextVault = renameVaultFolder(vault, source, nextName);
      const parent = normalizeFolderPath(source).split("/").slice(0, -1).join("/");
      const nextPath = normalizeFolderPath(parent ? `${parent}/${nextName}` : nextName);
      await persistVault(nextVault, `已重命名文件夹：${folderDisplayName(source)} → ${folderDisplayName(nextPath)}`);
      setActiveFolder((current) => {
        if (current === ALL_FOLDERS || current === UNCATEGORIZED_FOLDER) return current;
        return rebasePath(current, source, nextPath);
      });
      setSelectedEntry((current) => {
        if (!current) return nextVault.entries[0] ?? null;
        return nextVault.entries.find((entry) => entry.id === current.id) ?? current;
      });
      setRenamingFolder(null);
      setRenamingValue("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "重命名文件夹失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleDropOnFolder(target: string) {
    if (!vault || !dragItem) return;
    setDropFolder(null);
    setDragItem(null);
    setBusy(true);

    try {
      if (dragItem.type === "entry") {
        const nextFolder = target === ALL_FOLDERS || target === UNCATEGORIZED_FOLDER ? "" : target;
        const nextVault = moveEntryToFolder(vault, dragItem.entryId, nextFolder);
        await persistVault(
          nextVault,
          target === ALL_FOLDERS
            ? "已将账号移动到根层。"
            : nextFolder
              ? `已将账号移动到 ${nextFolder}。`
              : "已将账号移动到未分类。",
        );
        setSelectedEntry(nextVault.entries.find((entry) => entry.id === dragItem.entryId) ?? selectedEntry);
        return;
      }

      if (dragItem.type === "folder") {
        if (target === UNCATEGORIZED_FOLDER) {
          setBusy(false);
          return;
        }
        const nextParent = target === ALL_FOLDERS ? "" : target;
        const nextVault = moveVaultFolder(vault, dragItem.folder, nextParent);
        const nextPath = normalizeFolderPath(
          nextParent
            ? `${nextParent}/${folderDisplayName(dragItem.folder)}`
            : folderDisplayName(dragItem.folder),
        );
        await persistVault(nextVault, `已移动文件夹到 ${nextParent || "根目录"}。`);
        setActiveFolder((current) => {
          if (current === ALL_FOLDERS || current === UNCATEGORIZED_FOLDER) return current;
          return rebasePath(current, dragItem.folder, nextPath);
        });
        setSelectedEntry((current) => {
          if (!current) return nextVault.entries[0] ?? null;
          return nextVault.entries.find((entry) => entry.id === current.id) ?? current;
        });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "拖拽移动失败。");
    } finally {
      setBusy(false);
    }
  }

  function entryCountForFolder(folder: string) {
    if (!vault) return 0;
    if (folder === ALL_FOLDERS) return vault.entries.length;
    if (folder === UNCATEGORIZED_FOLDER) {
      return vault.entries.filter((entry) => !entryFolder(entry)).length;
    }
    return vault.entries.filter((entry) => entryMatchesFolderTree(entry, folder)).length;
  }

  function canDropOnFolder(target: string) {
    if (!dragItem) return false;
    if (dragItem.type === "entry") {
      const draggedEntry = vault?.entries.find((entry) => entry.id === dragItem.entryId);
      if (!draggedEntry) return false;
      const currentFolder = entryFolder(draggedEntry);
      const nextFolder = target === ALL_FOLDERS || target === UNCATEGORIZED_FOLDER ? "" : normalizeFolderPath(target);
      return currentFolder !== nextFolder;
    }
    if (target === UNCATEGORIZED_FOLDER) return false;
    if (target === dragItem.folder) return false;
    if (target !== ALL_FOLDERS && normalizeFolderPath(target).startsWith(`${dragItem.folder}/`)) {
      return false;
    }
    return true;
  }

  function renderEntryRow(entry: VaultEntry, showFolderChip: boolean) {
    const revealed = revealedEntryId === entry.id;
    const selected = selectedEntry?.id === entry.id;
    const accountText = entry.username || entry.url || "未填写账号";
    const accountCopyValue = entry.username || entry.url;
    const accountCopyLabel = entry.username ? "账号" : "网址";

    return (
      <article
        key={entry.id}
        className={`entry-card${selected ? " selected" : ""}`}
        draggable
        onDragStart={() => setDragItem({ type: "entry", entryId: entry.id })}
        onDragEnd={() => {
          setDragItem(null);
          setDropFolder(null);
        }}
        onClick={() => setSelectedEntry(entry)}
        onDoubleClick={() => {
          setSelectedEntry(entry);
          setSettingsOpen(true);
        }}
      >
        <div className="entry-top">
          <div className="drag-handle" title="拖拽移动">
            <GripVertical size={14} />
          </div>
          <div className="entry-info">
            <div className="entry-title">
              <strong>{entry.title || "未命名"}</strong>
              <span className="entry-host">{currentHost(entry.url) || "无网址"}</span>
            </div>
            <div className="entry-credentials">
              <button
                type="button"
                className="entry-copy-line entry-username"
                title={`点击复制${accountCopyLabel}`}
                onClick={() => {
                  void copyToClipboard(accountCopyValue || "", accountCopyLabel);
                }}
              >
                {accountText}
              </button>

              <div className="secret-row">
                <button
                  type="button"
                  className={`secret-value${revealed ? " revealed" : ""}`}
                  title="点击复制密码"
                  onClick={() => {
                    void copyToClipboard(entry.password, "密码");
                  }}
                >
                  {revealed ? entry.password : "••••••••••••"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRevealedEntryId((current) => (current === entry.id ? null : entry.id));
                  }}
                >
                  {revealed ? (
                    <>
                      <EyeOff size={14} />
                      隐藏
                    </>
                  ) : (
                    <>
                      <Eye size={14} />
                      显示
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="entry-actions">
            <button
              type="button"
              className="icon-button small danger row-delete"
              title="删除"
              onClick={(event) => {
                event.stopPropagation();
                void handleDelete(entry.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {(showFolderChip && entryFolder(entry)) || entry.tags.length > 0 ? (
          <div className="entry-meta">
            {showFolderChip && entryFolder(entry) && <span className="chip">{entryFolder(entry)}</span>}
            {entry.tags.slice(0, 2).map((tag) => (
              <span key={`${entry.id}-${tag}`} className="chip">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

      </article>
    );
  }

  function renderFolderRow(folder: string, visualDepth?: number) {
    const isSpecial = folder === ALL_FOLDERS || folder === UNCATEGORIZED_FOLDER;
    const selected = activeFolder === folder;
    const canDrop = canDropOnFolder(folder);
    const isDropTarget = dropFolder === folder && canDrop;
    const depth =
      visualDepth ??
      (folder === ALL_FOLDERS ? 0 : folder === UNCATEGORIZED_FOLDER ? 1 : Math.max(1, folder.split("/").length));
    const normalized = isSpecial ? folder : normalizeFolderPath(folder);
    const count = entryCountForFolder(folder);

    return (
      <div
        key={folder}
        className={`folder-row${depth > 0 ? " tree-child" : " tree-root"}${selected ? " selected" : ""}${isDropTarget ? " drag-over" : ""}`}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        draggable={!isSpecial}
        onDragStart={() => {
          if (!isSpecial) setDragItem({ type: "folder", folder: normalized });
        }}
        onDragEnd={() => {
          setDragItem(null);
          setDropFolder(null);
        }}
        onDragOver={(event) => {
          if (!canDropOnFolder(folder)) return;
          event.preventDefault();
          setDropFolder(folder);
        }}
        onDragLeave={() => {
          if (dropFolder === folder) {
            setDropFolder(null);
          }
        }}
        onDrop={(event) => {
          if (!canDropOnFolder(folder)) return;
          event.preventDefault();
          void handleDropOnFolder(folder);
        }}
        onDoubleClick={() => {
          if (!isSpecial) beginRenameFolder(normalized);
        }}
      >
        <button
          type="button"
          className="folder-main"
          onClick={() => {
            setActiveFolder(folder);
            setBrowseMode("folders");
          }}
        >
          <span className="drag-handle" aria-hidden="true">
            <GripVertical size={14} />
          </span>
          {renamingFolder === normalized && !isSpecial ? (
            <input
              autoFocus
              className="rename-input"
              value={renamingValue}
              onChange={(event) => setRenamingValue(event.target.value)}
              onBlur={() => void commitRenameFolder()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void commitRenameFolder();
                }
                if (event.key === "Escape") {
                  setRenamingFolder(null);
                  setRenamingValue("");
                }
              }}
            />
          ) : (
            <span className="folder-name">{folderFilterLabel(folder)}</span>
          )}
          <span className="folder-count">{count}</span>
        </button>
        {!isSpecial && (
          <button
            type="button"
            className="icon-button small row-delete"
            title="删除文件夹"
            onClick={() => void handleDeleteFolder(normalized)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  }

  function renderLockedScreen() {
    return (
      <main className="popup-shell unlock-shell">
        <header className="popup-header">
          <div className="header-title">
            <ShieldCheck size={18} />
            <div>
              <strong>Password WebDAV</strong>
              <span>连接 WebDAV 并解锁当前会话</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            title="打开设置页"
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            <Settings size={16} />
          </button>
        </header>

        <section className="panel-card unlock-panel">
          <label className="field">
            <span>WebDAV 根地址</span>
            <input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} />
          </label>
          <label className="field">
            <span>用户名</span>
            <input value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} />
          </label>
          <label className="field">
            <span>密码或应用密码</span>
            <input type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} />
          </label>
          <label className="field">
            <span>Vault 子路径</span>
            <div className="path-input">
              <span className="path-prefix">{VAULT_ROOT_FOLDER}/</span>
              <input value={vaultSubpath} onChange={(event) => updateVaultSubpath(event.target.value)} />
            </div>
          </label>
          <p className="field-help">
            根目录固定为 <code>PasswordWebDAV/</code>，这里只填写里面的子路径，例如
            <code>work/password-vault.json</code>。
          </p>
          <label className="field">
            <span>主密码</span>
            <input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} />
          </label>
          <div className="unlock-footer">
            <div className="unlock-status" aria-live="polite">
              {status || (busy ? "正在处理，请稍等..." : "填写完连接信息后，点击按钮开始解锁或创建。")}
            </div>
            <button type="button" className="primary-button" disabled={busy} onClick={handleUnlock}>
              <Lock size={16} />
              {busy ? "处理中..." : "解锁或创建"}
            </button>
          </div>
        </section>

        <p className="status">
          {status
            ? `调试提示：如需更详细信息，请在扩展弹窗的开发者工具里查看 Console。`
            : "如果卡住了，通常是 WebDAV 地址、用户名、应用密码或网络超时导致的。"}
        </p>

        <section className="panel-card debug-panel">
          <div className="panel-header">
            <div>
              <strong>调试日志</strong>
              <span>这里会打印解锁过程，便于定位卡在哪一步</span>
            </div>
            <button type="button" className="text-button" onClick={clearDebugLog}>
              清空
            </button>
          </div>
          <div className="debug-log">
            {debugLog.length > 0 ? (
              debugLog.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))
            ) : (
              <p>当前还没有解锁日志，点击“解锁或创建”后这里会出现详细过程。</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  function renderFolderView() {
    return (
      <div className="layout-two-col">
        <aside className="panel-card folder-panel">
          <div className="panel-header">
            <div>
              <strong>文件夹</strong>
              <span>双击改名，支持拖拽</span>
            </div>
          </div>

          <div className="folder-create">
            <input
              placeholder="例如 工作/GitHub"
              value={newFolderPath}
              onChange={(event) => setNewFolderPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCreateFolder();
                }
              }}
            />
            <button type="button" className="icon-button" title="新建文件夹" onClick={() => void handleCreateFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>

          <div className="folder-list">
            {renderFolderRow(ALL_FOLDERS, 0)}
            {renderFolderRow(UNCATEGORIZED_FOLDER, 1)}
            {folderOptions.map((folder) => renderFolderRow(folder, folder.split("/").length))}
          </div>
        </aside>

        <section className="panel-card list-panel">
          <div className="panel-header">
            <div>
              <strong>{folderFilterLabel(activeFolder)}</strong>
              <span>
                {entries.length} 条账号
                {selectedEntry ? ` · 当前选中 ${selectedEntry.title || "未命名"}` : ""}
              </span>
            </div>
          </div>

          <div className="entry-list">
            {entries.length > 0 ? entries.map((entry) => renderEntryRow(entry, false)) : <p className="empty-hint">当前范围内没有匹配账号。</p>}
          </div>
        </section>
      </div>
    );
  }

  function renderAllView() {
    return (
      <section className="panel-card list-panel">
        <div className="panel-header">
          <div>
            <strong>全部账号</strong>
            <span>{allEntries.length} 条账号 · 延续同一套紧凑列表</span>
          </div>
        </div>

        <div className="entry-list">
          {allEntries.length > 0 ? allEntries.map((entry) => renderEntryRow(entry, true)) : <p className="empty-hint">没有找到匹配账号。</p>}
        </div>
      </section>
    );
  }

  function renderSettingsView() {
    return (
      <div className="settings-stack">
        <section className="panel-card settings-panel">
          <div className="panel-header">
            <div>
              <strong>Vault 设置</strong>
              <span>根目录固定为 PasswordWebDAV/</span>
            </div>
          </div>

          <label className="field">
            <span>WebDAV 根地址</span>
            <input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} />
          </label>
          <label className="field">
            <span>用户名</span>
            <input value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} />
          </label>
          <label className="field">
            <span>密码或应用密码</span>
            <input type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} />
          </label>
          <label className="field">
            <span>Vault 子路径</span>
            <div className="path-input">
              <span className="path-prefix">{VAULT_ROOT_FOLDER}/</span>
              <input value={vaultSubpath} onChange={(event) => updateVaultSubpath(event.target.value)} />
            </div>
          </label>
          <div className="action-row">
            <button type="button" className="primary-button compact" onClick={() => void handleSaveSettings()}>
              <Save size={15} />
              保存设置
            </button>
            <button type="button" className="ghost-button compact" disabled={busy} onClick={() => void handleRefresh()}>
              <RefreshCw size={15} />
              刷新
            </button>
            <button type="button" className="ghost-button compact" onClick={() => void lockVault()}>
              <Lock size={15} />
              锁定
            </button>
            <button type="button" className="ghost-button compact" onClick={() => chrome.runtime.openOptionsPage()}>
              <Settings size={15} />
              系统设置页
            </button>
          </div>
        </section>

        <section className="panel-card settings-panel">
          <div className="panel-header">
            <div>
              <strong>{selectedEntry ? "条目详情" : "条目详情"}</strong>
              <span>{selectedEntry ? "详细字段都放这里维护" : "先在主界面选择一个条目"}</span>
            </div>
          </div>

          {selectedEntry ? (
            <>
              <label className="field">
                <span>标题</span>
                <input
                  list={TITLE_SUGGESTIONS_ID}
                  value={selectedEntry.title}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, title: event.target.value }, "标题")}
                />
              </label>
              <label className="field">
                <span>网址</span>
                <input
                  list={URL_SUGGESTIONS_ID}
                  value={selectedEntry.url}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, url: event.target.value }, "网址")}
                />
              </label>
              <label className="field">
                <span>用户名</span>
                <input
                  list={USERNAME_SUGGESTIONS_ID}
                  value={selectedEntry.username}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, username: event.target.value }, "用户名")}
                />
              </label>
              {selectedEntryIsNew && quickUsernameSuggestions.length > 0 && (
                <div className="suggestion-row">
                  {quickUsernameSuggestions.map((entry) => (
                    <button
                      key={`${entry.id}-username`}
                      type="button"
                      className="chip-button"
                      onClick={() => applySuggestedEntry(entry)}
                    >
                      {entry.username}
                    </button>
                  ))}
                </div>
              )}
              <label className="field">
                <span>密码</span>
                <div className="inline-input">
                  <input
                    type={revealedEntryId === selectedEntry.id ? "text" : "password"}
                    value={selectedEntry.password}
                    onChange={(event) => {
                      setSelectedEntry({ ...selectedEntry, password: event.target.value });
                      setDirty(true);
                    }}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    title={revealedEntryId === selectedEntry.id ? "隐藏密码" : "显示密码"}
                    onClick={() => setRevealedEntryId((current) => (current === selectedEntry.id ? null : selectedEntry.id))}
                  >
                    {revealedEntryId === selectedEntry.id ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="生成密码"
                    onClick={() => {
                      setSelectedEntry({ ...selectedEntry, password: generatePassword() });
                      setDirty(true);
                    }}
                  >
                    <Dices size={15} />
                  </button>
                </div>
              </label>
              <label className="field">
                <span>文件夹</span>
                <input
                  list={FOLDER_SUGGESTIONS_ID}
                  placeholder="例如 工作/GitHub，留空为未分类"
                  value={selectedEntry.folder || ""}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, folder: event.target.value })}
                />
              </label>
              <label className="field">
                <span>标签</span>
                <input
                  placeholder="例如 work, finance"
                  value={tagsToText(selectedEntry.tags)}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, tags: textToTags(event.target.value) })}
                />
              </label>
              <label className="field">
                <span>备注</span>
                <textarea
                  placeholder="例如恢复码、登录说明、二次验证提示"
                  value={selectedEntry.notes}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, notes: event.target.value })}
                />
              </label>

              <div className="action-row">
                <button type="button" className="primary-button compact" disabled={busy} onClick={() => void handleSaveSelected()}>
                  <Save size={15} />
                  {busy ? "保存中..." : "保存同步"}
                </button>
                <button type="button" className="ghost-button compact danger" disabled={busy} onClick={() => void handleDelete(selectedEntry.id)}>
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
            </>
          ) : (
            <p className="empty-hint">先在主界面选中一个账号，再到这里看详细字段。</p>
          )}
        </section>
      </div>
    );
  }

  if (!vault) {
    return renderLockedScreen();
  }

  return (
    <main className="popup-shell manager-shell">
      <header className="popup-header manager-header">
        <div className="header-title">
          {settingsOpen ? (
            <button type="button" className="icon-button" title="返回" onClick={() => setSettingsOpen(false)}>
              <ArrowLeft size={16} />
            </button>
          ) : (
            <ShieldCheck size={18} />
          )}
          <div>
            <strong>Password WebDAV</strong>
            <span>{settingsOpen ? "设置 / 详情" : host || "当前页面无可识别域名"}</span>
          </div>
        </div>

        <div className="header-actions">
          {!settingsOpen && (
            <div className="view-toggle">
              <button
                type="button"
                className={browseMode === "folders" ? "active" : ""}
                onClick={() => setBrowseMode("folders")}
              >
                文件夹
              </button>
              <button
                type="button"
                className={browseMode === "all" ? "active" : ""}
                onClick={() => setBrowseMode("all")}
              >
                全部
              </button>
            </div>
          )}
          <button type="button" className="icon-button" title="设置" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {!settingsOpen ? (
        <>
          <div className="toolbar-row">
            <input
              className="search-input"
              placeholder="搜索标题、网址、账号、标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="toolbar-actions">
              <button type="button" className="icon-button" title="新建账号" onClick={handleAdd}>
                <Plus size={16} />
              </button>
              <button type="button" className="icon-button" title="刷新" disabled={busy} onClick={() => void handleRefresh()}>
                <RefreshCw size={16} />
              </button>
              <button type="button" className="icon-button" title="锁定" onClick={() => void lockVault()}>
                <Lock size={16} />
              </button>
            </div>
          </div>

          {browseMode === "folders" ? renderFolderView() : renderAllView()}
        </>
      ) : (
        renderSettingsView()
      )}

      <datalist id={TITLE_SUGGESTIONS_ID}>
        {titleSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id={URL_SUGGESTIONS_ID}>
        {urlSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id={USERNAME_SUGGESTIONS_ID}>
        {usernameSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id={FOLDER_SUGGESTIONS_ID}>
        {folderOptions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      {status && <p className="status">{status}{dirty ? " · 有未保存修改" : ""}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
