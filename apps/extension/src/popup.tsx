import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
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
  X,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  EXTENSION_LANGUAGES,
  EXTENSION_THEMES,
  getExtensionVaultSubpath,
  loadExtensionConfig,
  loadSessionMasterPassword,
  loadUnlockedVault,
  saveExtensionConfig,
  saveSessionMasterPassword,
  saveUnlockedVault,
  type ExtensionConfig,
} from "./extensionState";
import { getMessages, getThemeLabel } from "./i18n";
import "./popup.css";

const ALL_FOLDERS = "__all__";
const UNCATEGORIZED_FOLDER = "__uncategorized__";
const TITLE_SUGGESTIONS_ID = "pw-title-suggestions";
const URL_SUGGESTIONS_ID = "pw-url-suggestions";
const USERNAME_SUGGESTIONS_ID = "pw-username-suggestions";
const FOLDER_SUGGESTIONS_ID = "pw-folder-suggestions";
const DEBUG_LOG_KEY = "password-webdav.popup-debug-log";

type BrowseMode = "folders" | "all";
type PanelMode = "main" | "settings" | "entry";
type DragItem =
  | { type: "entry"; entryId: string }
  | { type: "folder"; folder: string }
  | null;

function folderDisplayName(folder: string) {
  const parts = folder.split("/").filter(Boolean);
  return parts[parts.length - 1] || folder;
}

function folderFilterLabel(folder: string, text: ReturnType<typeof getMessages>) {
  if (folder === ALL_FOLDERS) return text.all;
  if (folder === UNCATEGORIZED_FOLDER) return text.uncategorized;
  return folder;
}

function folderTreeLabel(folder: string, text: ReturnType<typeof getMessages>) {
  if (folder === ALL_FOLDERS || folder === UNCATEGORIZED_FOLDER) return folderFilterLabel(folder, text);
  return folderDisplayName(folder);
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
  fallbackTitle = "新条目",
): VaultEntry {
  const now = nowIso();
  return {
    id: uuid(),
    title: defaults.title || host || fallbackTitle,
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

function textToTags(value: string) {
  return value
    .split(/[，,]/)
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

function validateUnlock(settings: WebDavConfig, masterPassword: string, text: ReturnType<typeof getMessages>) {
  if (!settings.baseUrl.trim()) return text.validation.baseUrl;
  if (!settings.username.trim()) return text.validation.username;
  if (!settings.password) return text.validation.password;
  if (!getExtensionVaultSubpath(settings).trim()) return text.validation.vaultPath;
  if (masterPassword.length < 8) return text.validation.masterPassword;
  return "";
}

function deriveNewEntryDefaults(vault: PlainVault | null, host: string, activeFolder: string, fallbackTitle: string) {
  const folderFromSidebar =
    activeFolder !== ALL_FOLDERS && activeFolder !== UNCATEGORIZED_FOLDER ? activeFolder : "";
  if (!vault || !host) {
    return {
      title: host || fallbackTitle,
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
    title: latest?.title || host || fallbackTitle,
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

function formatUnlockError(error: unknown, settings: WebDavConfig, text: ReturnType<typeof getMessages>) {
  const raw = error instanceof Error ? error.message : text.errors.unlockFailed;
  const url = resolveVaultUrl(settings);
  if (/timed out/i.test(raw)) {
    return text.errors.timeout(url, raw);
  }
  if (/401|403/i.test(raw)) {
    return text.errors.auth(url);
  }
  if (/404|409/i.test(raw)) {
    return text.errors.path(url);
  }
  if (/Failed to load vault from WebDAV/i.test(raw)) {
    return text.errors.load(url, raw);
  }
  if (/Failed to save vault to WebDAV/i.test(raw)) {
    return text.errors.save(url, raw);
  }
  if (/Failed to create WebDAV directory/i.test(raw)) {
    return text.errors.mkdir(url, raw);
  }
  return raw;
}

function PopupApp() {
  const [settings, setSettings] = useState<ExtensionConfig>(DEFAULT_EXTENSION_CONFIG);
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
  const [panelMode, setPanelMode] = useState<PanelMode>("main");
  const [revealedEntryId, setRevealedEntryId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragItem>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [editingEntryTitleId, setEditingEntryTitleId] = useState<string | null>(null);
  const [editingEntryTitleValue, setEditingEntryTitleValue] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>(() => loadDebugLog());

  function appendDebugLog(message: string) {
    const locale = settings.language === "en" ? "en-US" : "zh-CN";
    const line = `[${new Date().toLocaleTimeString(locale, { hour12: false })}] ${message}`;
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
  }, [browseMode, panelMode, activeFolder, query]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.language === "en" ? "en" : "zh-CN";
  }, [settings.language, settings.theme]);

  useEffect(() => {
    setTagDraft("");
    setEditingTagIndex(null);
    setEditingTagValue("");
  }, [panelMode, selectedEntry?.id]);

  useEffect(() => {
    setEditingEntryTitleId(null);
    setEditingEntryTitleValue("");
  }, [panelMode, selectedEntry?.id]);

  const host = useMemo(() => currentHost(tabUrl), [tabUrl]);
  const text = useMemo(() => getMessages(settings.language), [settings.language]);
  const feedback = useMemo(() => {
    const isEn = settings.language === "en";
    return {
      ready: isEn ? "Ready." : "已就绪，等待操作。",
      copyFailed: isEn ? "Copy failed. Please try again." : "复制失败，请重试。",
      foldersView: isEn ? "Switched to folders view." : "已切换到文件夹视图。",
      allView: isEn ? "Switched to all accounts view." : "已切换到全部账号视图。",
      selectedFolder: (folder: string) => (isEn ? `Selected folder: ${folder}` : `已选择文件夹：${folder}`),
      selectedEntry: (label: string) => (isEn ? `Selected account: ${label}` : `已选择账号：${label}`),
      expandedFolder: (folder: string) => (isEn ? `Expanded ${folder}.` : `已展开 ${folder}。`),
      collapsedFolder: (folder: string) => (isEn ? `Collapsed ${folder}.` : `已收起 ${folder}。`),
      passwordShown: isEn ? "Password is visible." : "密码已显示。",
      passwordHidden: isEn ? "Password is hidden." : "密码已隐藏。",
    };
  }, [settings.language]);
  const vaultSubpath = useMemo(() => getExtensionVaultSubpath(settings), [settings]);
  const selectedEntryIsNew = useMemo(() => isNewDraftEntry(vault, selectedEntry), [selectedEntry, vault]);
  const draftHost = useMemo(() => currentHost(selectedEntry?.url || tabUrl), [selectedEntry, tabUrl]);
  const statusText = status || (busy ? text.processingWait : feedback.ready);

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

  const visibleFolderOptions = useMemo(
    () => folderOptions.filter((folder) => !folderHasCollapsedParent(folder, collapsedFolders)),
    [collapsedFolders, folderOptions],
  );

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
      setStatus(text.status.matchedExisting(autoMatchLabel));
        }
        return;
      }
    }

    setSelectedEntry(next);
    setDirty(true);
  }

  function openEntryDetail(entry: VaultEntry) {
    setSelectedEntry(entry);
    setPanelMode("entry");
  }

  function addSelectedEntryTag(rawValue: string) {
    if (!selectedEntry) return;
    const tags = textToTags(rawValue);
    if (tags.length === 0) return;
    const nextTags = uniqueNonEmpty([...selectedEntry.tags, ...tags]);
    if (nextTags.length === selectedEntry.tags.length) {
      setTagDraft("");
      return;
    }
    updateSelectedEntry({ ...selectedEntry, tags: nextTags }, text.tag);
    setTagDraft("");
  }

  function removeSelectedEntryTag(tag: string) {
    if (!selectedEntry) return;
    updateSelectedEntry(
      { ...selectedEntry, tags: selectedEntry.tags.filter((current) => current !== tag) },
      text.tag,
    );
  }

  function beginEditSelectedEntryTag(index: number, tag: string) {
    setEditingTagIndex(index);
    setEditingTagValue(tag);
  }

  function commitEditSelectedEntryTag(index: number) {
    if (!selectedEntry) return;
    const currentTag = selectedEntry.tags[index];
    if (currentTag === undefined) return;

    const nextValue = editingTagValue.trim();
    setEditingTagIndex(null);
    setEditingTagValue("");

    if (!nextValue) {
      removeSelectedEntryTag(currentTag);
      return;
    }

    const nextTags = uniqueNonEmpty(
      selectedEntry.tags.map((tag, tagIndex) => (tagIndex === index ? nextValue : tag)),
    );
    updateSelectedEntry({ ...selectedEntry, tags: nextTags }, text.tag);
  }

  function applySuggestedEntry(entry: VaultEntry) {
    setSelectedEntry(entry);
    setDirty(false);
    setStatus(text.status.switchedAccount);
  }

  function describeEntry(entry: VaultEntry) {
    const primary = entry.title.trim() || text.unnamed;
    const secondary = entry.username.trim() || currentHost(entry.url) || "";
    return secondary && secondary !== primary ? `${primary} · ${secondary}` : primary;
  }

  async function persistVault(nextVault: PlainVault, nextStatus = text.status.synced) {
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
    const error = validateUnlock(settings, masterPassword, text);
    if (error) {
      appendDebugLog(text.status.validationFailed(error));
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
    setStatus(text.status.checkingWebdav);
    appendDebugLog(text.status.unlockStart(resolveVaultUrl(settings)));
    console.info("[Password WebDAV] unlock start", {
      baseUrl: settings.baseUrl,
      username: settings.username,
      vaultPath: settings.vaultPath,
    });
    try {
      await saveExtensionConfig(settings);
      appendDebugLog(text.status.configSaved);
      const file = await loadVaultFile(settings);
      if (!file) {
        const nextVault = createEmptyVault();
        setStatus(text.status.creatingVault);
        appendDebugLog(text.status.creatingVault);
        console.info("[Password WebDAV] vault not found, creating new encrypted vault");
        await persistVault(nextVault, text.status.createdVault);
        await rememberMasterPasswordForBackground();
        setSelectedEntry(null);
        appendDebugLog(text.status.createdVaultLog);
        console.info("[Password WebDAV] vault created and unlocked");
        return;
      }

      setStatus(text.status.decryptingVault);
      appendDebugLog(text.status.decryptingVaultLog);
      const plain = await decryptVault(masterPassword, file);
      await saveUnlockedVault(plain);
      await rememberMasterPasswordForBackground();
      setVault(plain);
      setSelectedEntry(plain.entries[0] ?? null);
      setDirty(false);
      setStatus(text.status.unlocked(plain.entries.length));
      appendDebugLog(text.status.unlockSuccess(plain.entries.length));
      console.info("[Password WebDAV] unlock success", { entryCount: plain.entries.length });
    } catch (error) {
      console.error("[Password WebDAV] unlock failed", {
        error,
        baseUrl: settings.baseUrl,
        username: settings.username,
        vaultPath: settings.vaultPath,
      });
      const formatted = formatUnlockError(error, settings, text);
      appendDebugLog(text.status.unlockFailed(formatted));
      setStatus(formatted);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!masterPassword) {
      setStatus(text.status.refreshNeedsPassword);
      return;
    }

    setBusy(true);
    setStatus(text.status.refreshing);
    try {
      const file = await loadVaultFile(settings);
      if (!file) {
        throw new Error(text.status.noVaultFile);
      }
      const plain = await decryptVault(masterPassword, file);
      await saveUnlockedVault(plain);
      setVault(plain);
      setSelectedEntry(plain.entries.find((entry) => entry.id === selectedEntry?.id) ?? plain.entries[0] ?? null);
      setDirty(false);
      setStatus(text.status.refreshed);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.refreshFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSelected() {
    if (!vault || !selectedEntry) return;
    setBusy(true);
    setStatus(text.status.syncing);
    try {
      const nextVault = upsertEntry(vault, selectedEntry);
      await persistVault(nextVault);
      setSelectedEntry(nextVault.entries.find((entry) => entry.id === selectedEntry.id) ?? selectedEntry);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.saveFailed);
      setDirty(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entryId: string) {
    if (!vault) return;
    setBusy(true);
    setStatus(text.status.deleting);
    try {
      const nextVault = removeEntry(vault, entryId);
      await persistVault(nextVault, text.status.deleted);
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
      setStatus(error instanceof Error ? error.message : text.status.deleteFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFolder(folder: string) {
    if (!vault) return;
    const normalized = normalizeFolderPath(folder);
    if (!normalized) return;

    setBusy(true);
    setStatus(text.status.deletingFolder(normalized));
    try {
      const nextVault = removeVaultFolder(vault, normalized);
      await persistVault(nextVault, text.status.deletedFolder(normalized));
      setActiveFolder(UNCATEGORIZED_FOLDER);
      setSelectedEntry((current) => {
        if (!current) return nextVault.entries[0] ?? null;
        return nextVault.entries.find((entry) => entry.id === current.id) ?? nextVault.entries[0] ?? null;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.deleteFolderFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFolder() {
    if (!vault) return;
    const folder = normalizeFolderPath(newFolderPath);
    if (!folder) {
      setStatus(text.status.folderRequired);
      return;
    }

    setBusy(true);
    setStatus(text.status.creatingFolder);
    try {
      const nextVault = {
        ...vault,
        updatedAt: nowIso(),
        folders: mergeVaultFolders(vault, [folder]),
      };
      await persistVault(nextVault, text.status.createdFolder(folder));
      setActiveFolder(folder);
      setNewFolderPath("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.createFolderFailed);
    } finally {
      setBusy(false);
    }
  }

  function handleAdd() {
    const defaults = deriveNewEntryDefaults(vault, host, activeFolder, text.newEntry);
    const entry = createEntry(host, defaults.folder, defaults, text.newEntry);
    setSelectedEntry(entry);
    setDirty(true);
    setPanelMode("entry");
    setStatus(text.status.newEntryCreated);
  }

  async function copyToClipboard(value: string, label: string) {
    if (!value) {
      setStatus(text.status.emptyValue(label));
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus(text.status.copied(label));
    } catch {
      setStatus(feedback.copyFailed);
    }
  }

  async function lockVault() {
    await clearSessionMasterPassword();
    await clearUnlockedVault();
    await chrome.runtime.sendMessage({ type: "password-webdav.clear-master-password" });
    setVault(null);
    setSelectedEntry(null);
    setMasterPassword("");
    setDirty(false);
    setPanelMode("main");
    setRevealedEntryId(null);
    setStatus(text.status.locked);
  }

  async function handleSaveSettings() {
    await saveExtensionConfig(settings);
    setStatus(text.status.settingsSaved);
  }

  function updateAppearanceSettings(nextSettings: ExtensionConfig) {
    setSettings(nextSettings);
    void saveExtensionConfig(nextSettings);
  }

  function renderHeaderPreferences() {
    return (
      <div className="header-preferences">
        <select
          className="header-select theme-select"
          title={text.theme}
          aria-label={text.theme}
          value={settings.theme}
          onChange={(event) =>
            updateAppearanceSettings({ ...settings, theme: event.target.value as ExtensionConfig["theme"] })
          }
        >
          {EXTENSION_THEMES.map((theme) => (
            <option key={theme.value} value={theme.value}>
              {getThemeLabel(theme.value, settings.language)}
            </option>
          ))}
        </select>
        <select
          className="header-select language-select"
          title={text.language}
          aria-label={text.language}
          value={settings.language}
          onChange={(event) =>
            updateAppearanceSettings({ ...settings, language: event.target.value as ExtensionConfig["language"] })
          }
        >
          {EXTENSION_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function beginRenameFolder(folder: string) {
    setRenamingFolder(folder);
    setRenamingValue(folderDisplayName(folder));
  }

  function folderHasChildren(folder: string) {
    const normalized = normalizeFolderPath(folder);
    return folderOptions.some((candidate) => candidate.startsWith(`${normalized}/`));
  }

  function folderHasCollapsedParent(folder: string, collapsed: Set<string>) {
    const normalized = normalizeFolderPath(folder);
    const parts = normalized.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (collapsed.has(parent)) return true;
    }
    return false;
  }

  function toggleFolderCollapse(folder: string) {
    const normalized = normalizeFolderPath(folder);
    if (!normalized || !folderHasChildren(normalized)) return;
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
    setActiveFolder((current) => {
      if (current === normalized || current.startsWith(`${normalized}/`)) return normalized;
      return current;
    });
  }

  function beginEditEntryTitle(entry: VaultEntry) {
    setSelectedEntry(entry);
    setEditingEntryTitleId(entry.id);
    setEditingEntryTitleValue(entry.title || "");
  }

  async function commitEditEntryTitle(entry: VaultEntry) {
    if (!vault || editingEntryTitleId !== entry.id) return;
    const nextTitle = editingEntryTitleValue.trim();
    setEditingEntryTitleId(null);
    setEditingEntryTitleValue("");
    if (!nextTitle || nextTitle === entry.title) return;

    setBusy(true);
    try {
      const nextEntry = { ...entry, title: nextTitle };
      const nextVault = upsertEntry(vault, nextEntry);
      await persistVault(nextVault, text.status.titleUpdated);
      setSelectedEntry(nextVault.entries.find((item) => item.id === entry.id) ?? nextEntry);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.updateTitleFailed);
    } finally {
      setBusy(false);
    }
  }

  async function commitRenameFolder() {
    if (!vault || !renamingFolder) return;
    const nextName = normalizeFolderPath(renamingValue);
    if (!nextName) {
      setStatus(text.status.folderNameRequired);
      return;
    }
    const source = renamingFolder;
    setBusy(true);
    try {
      const nextVault = renameVaultFolder(vault, source, nextName);
      const parent = normalizeFolderPath(source).split("/").slice(0, -1).join("/");
      const nextPath = normalizeFolderPath(parent ? `${parent}/${nextName}` : nextName);
      await persistVault(nextVault, text.status.renamedFolder(folderDisplayName(source), folderDisplayName(nextPath)));
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
      setStatus(error instanceof Error ? error.message : text.status.renameFolderFailed);
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
            ? text.status.movedEntryRoot
            : nextFolder
              ? text.status.movedEntryFolder(nextFolder)
              : text.status.movedEntryUncategorized,
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
        await persistVault(nextVault, text.status.movedFolder(nextParent));
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
      setStatus(error instanceof Error ? error.message : text.status.dragFailed);
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
    const accountText = entry.username || entry.url || text.noAccount;
    const accountCopyValue = entry.username || entry.url;
    const accountCopyLabel = entry.username ? text.account : text.url;

    return (
      <article
        key={entry.id}
        className={`entry-card${selected ? " selected" : ""}${dragItem?.type === "entry" && dragItem.entryId === entry.id ? " dragging" : ""}`}
        draggable
        onDragStart={() => setDragItem({ type: "entry", entryId: entry.id })}
        onDragEnd={() => {
          setDragItem(null);
          setDropFolder(null);
        }}
        onClick={() => {
          setSelectedEntry(entry);
          setStatus(feedback.selectedEntry(describeEntry(entry)));
        }}
        onDoubleClick={() => {
          openEntryDetail(entry);
        }}
      >
        <div className="entry-top">
          <div className="drag-handle" title={text.dragMove}>
            <GripVertical size={14} />
          </div>
          <div className="entry-info">
            <div className="entry-title">
              {editingEntryTitleId === entry.id ? (
                <input
                  autoFocus
                  className="entry-title-input"
                  value={editingEntryTitleValue}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onChange={(event) => setEditingEntryTitleValue(event.target.value)}
                  onBlur={() => void commitEditEntryTitle(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void commitEditEntryTitle(entry);
                    }
                    if (event.key === "Escape") {
                      setEditingEntryTitleId(null);
                      setEditingEntryTitleValue("");
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="entry-title-button"
                  title={`${entry.title || text.unnamed} · ${text.renameTitle}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedEntry(entry);
                    setStatus(feedback.selectedEntry(describeEntry(entry)));
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    beginEditEntryTitle(entry);
                  }}
                >
                  {entry.title || text.unnamed}
                </button>
              )}
              <span className="entry-host" title={entry.url || text.noUrl}>
                {currentHost(entry.url) || text.noUrl}
              </span>
            </div>
            <div className="entry-credentials">
              <button
                type="button"
                className="entry-copy-line entry-username"
                title={`${accountText} · ${entry.username ? text.copyAccount : text.copyUrl}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyToClipboard(accountCopyValue || "", accountCopyLabel);
                }}
              >
                {accountText}
              </button>

              <div className="secret-row">
                <button
                  type="button"
                  className={`secret-value${revealed ? " revealed" : ""}`}
                  title={text.copyPassword}
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyToClipboard(entry.password, text.password);
                  }}
                >
                  {revealed ? entry.password : "********"}
                </button>
                <button
                  type="button"
                  className="icon-button small secret-toggle"
                  title={revealed ? text.hidePassword : text.showPassword}
                  aria-label={revealed ? text.hidePassword : text.showPassword}
                  onClick={(event) => {
                    event.stopPropagation();
                    setStatus(revealed ? feedback.passwordHidden : feedback.passwordShown);
                    setRevealedEntryId((current) => (current === entry.id ? null : entry.id));
                  }}
                >
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  className="icon-button small danger row-delete inline-delete"
                  title={text.delete}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDelete(entry.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

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
    const treeLabel = folderTreeLabel(folder, text);
    const canCollapse = !isSpecial && folderHasChildren(normalized);
    const collapsed = canCollapse && collapsedFolders.has(normalized);

    return (
      <div
        key={folder}
        className={`folder-row${depth > 0 ? " tree-child" : " tree-root"}${selected ? " selected" : ""}${isDropTarget ? " drag-over" : ""}${dragItem && !canDrop ? " drop-disabled" : ""}${dragItem?.type === "folder" && dragItem.folder === normalized ? " dragging" : ""}`}
        style={{
          paddingLeft: `${8 + depth * 16}px`,
          "--tree-line-x": `${13 + (depth - 1) * 16}px`,
          "--tree-dot-x": `${25 + (depth - 1) * 16}px`,
        } as CSSProperties}
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
          className={`folder-main${canCollapse ? " has-children" : ""}`}
          title={isSpecial ? treeLabel : normalized}
        onClick={() => {
          setActiveFolder(folder);
          setBrowseMode("folders");
          setStatus(feedback.selectedFolder(treeLabel));
        }}
      >
          <span
            className={`folder-toggle${canCollapse ? "" : " placeholder"}`}
            aria-hidden={!canCollapse}
            title={collapsed ? text.expand : text.collapse}
            onClick={(event) => {
              event.stopPropagation();
              setStatus(collapsed ? feedback.expandedFolder(treeLabel) : feedback.collapsedFolder(treeLabel));
              toggleFolderCollapse(normalized);
            }}
          >
            {canCollapse ? collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : null}
          </span>
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
            <span className="folder-name">{treeLabel}</span>
          )}
          <span className="folder-count">{count}</span>
        </button>
        {!isSpecial && (
          <button
            type="button"
            className="icon-button small row-delete"
            title={text.deleteFolder}
            onClick={(event) => {
              event.stopPropagation();
              void handleDeleteFolder(normalized);
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  }

  function renderLockedScreen() {
    return (
      <main className="popup-shell unlock-shell" data-theme={settings.theme}>
        <header className="popup-header">
          <div className="header-title">
            <ShieldCheck size={18} />
            <div>
              <strong>Password WebDAV</strong>
              <span>{text.lockedSubtitle}</span>
            </div>
          </div>
          <div className="header-actions">
            {renderHeaderPreferences()}
            <button
              type="button"
              className="icon-button"
              title={text.openSettingsPage}
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        <section className="panel-card unlock-panel">
          <label className="field">
            <span>{text.webdavBaseUrl}</span>
            <input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} />
          </label>
          <label className="field">
            <span>{text.username}</span>
            <input value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} />
          </label>
          <label className="field">
            <span>{text.webdavPassword}</span>
            <input type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} />
          </label>
          <label className="field">
            <span>{text.vaultSubpath}</span>
            <div className="path-input">
              <span className="path-prefix">{VAULT_ROOT_FOLDER}/</span>
              <input value={vaultSubpath} onChange={(event) => updateVaultSubpath(event.target.value)} />
            </div>
          </label>
          <p className="field-help">
            {text.fixedRootHelp} <code>PasswordWebDAV/</code>，{text.fixedRootHelpTail}
            <code>work/password-vault.json</code>。
          </p>
          <label className="field">
            <span>{text.masterPassword}</span>
            <input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} />
          </label>
          <div className="unlock-footer">
            <div className="unlock-status" aria-live="polite">
              {status || (busy ? text.processingWait : text.unlockHint)}
            </div>
            <button type="button" className="primary-button" disabled={busy} onClick={handleUnlock}>
              <Lock size={16} />
              {busy ? text.processing : text.unlockOrCreate}
            </button>
          </div>
        </section>

        <details className="debug-disclosure">
          <summary>
            <span>{text.debugLog}</span>
            <span>{text.debugLogHint}</span>
          </summary>
          <div className="debug-log debug-log-compact">
            <div className="debug-log-actions">
              <button type="button" className="text-button" onClick={clearDebugLog}>
                {text.clear}
              </button>
            </div>
            {debugLog.length > 0 ? (
              debugLog.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)
            ) : (
              <p>{text.emptyDebugLog}</p>
            )}
          </div>
        </details>
      </main>
    );
  }

  function renderFolderView() {
    return (
      <div className="layout-two-col">
        <aside className="panel-card folder-panel">
          <div className="panel-header">
            <div>
              <strong>{text.folderHeader}</strong>
              <span>{text.folderHint}</span>
            </div>
          </div>

          <div className="folder-create">
            <input
              placeholder={text.newFolderPlaceholder}
              value={newFolderPath}
              onChange={(event) => setNewFolderPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCreateFolder();
                }
              }}
            />
            <button type="button" className="icon-button" title={text.newFolder} onClick={() => void handleCreateFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>

          <div className="folder-list">
            {renderFolderRow(ALL_FOLDERS, 0)}
            {renderFolderRow(UNCATEGORIZED_FOLDER, 1)}
            {visibleFolderOptions.map((folder) => renderFolderRow(folder, folder.split("/").length))}
          </div>
        </aside>

        <section className="panel-card list-panel">
          <div className="panel-header">
            <div>
              <strong>{folderFilterLabel(activeFolder, text)}</strong>
              <span>{text.entryCount(entries.length)}</span>
            </div>
          </div>

          <div className="entry-list">
            {entries.length > 0 ? entries.map((entry) => renderEntryRow(entry, false)) : <p className="empty-hint">{text.noEntriesInScope}</p>}
          </div>
        </section>
      </div>
    );
  }

  function renderAllView() {
    return (
      <section className="panel-card list-panel compact-list-panel">
        <div className="panel-header">
          <div>
            <strong>{text.allAccounts}</strong>
            <span>{text.entryCount(allEntries.length)}</span>
          </div>
        </div>

        <div className="entry-list">
          {allEntries.length > 0 ? allEntries.map((entry) => renderEntryRow(entry, true)) : <p className="empty-hint">{text.noEntriesFound}</p>}
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
              <strong>{text.vaultSettings}</strong>
              <span>{text.vaultRootFixed}</span>
            </div>
          </div>

          <label className="field">
            <span>{text.webdavBaseUrl}</span>
            <input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} />
          </label>
          <label className="field">
            <span>{text.username}</span>
            <input value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} />
          </label>
          <label className="field">
            <span>{text.webdavPassword}</span>
            <input type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} />
          </label>
          <label className="field">
            <span>{text.vaultSubpath}</span>
            <div className="path-input">
              <span className="path-prefix">{VAULT_ROOT_FOLDER}/</span>
              <input value={vaultSubpath} onChange={(event) => updateVaultSubpath(event.target.value)} />
            </div>
          </label>
          <p className="field-help compact-hint">
            {text.uiSettingsHint}
          </p>
          <div className="action-row">
            <button type="button" className="primary-button compact" onClick={() => void handleSaveSettings()}>
              <Save size={15} />
              {text.saveSettings}
            </button>
            <button type="button" className="ghost-button compact" disabled={busy} onClick={() => void handleRefresh()}>
              <RefreshCw size={15} />
              {text.refresh}
            </button>
            <button type="button" className="ghost-button compact" onClick={() => void lockVault()}>
              <Lock size={15} />
              {text.lock}
            </button>
            <button type="button" className="ghost-button compact" onClick={() => chrome.runtime.openOptionsPage()}>
              <Settings size={15} />
              {text.openOptionsPage}
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderEntryDetailView() {
    return (
      <div className="settings-stack">
        <section className="panel-card settings-panel">
          <div className="panel-header">
            <div>
              <strong>{text.details}</strong>
              <span>{selectedEntry ? selectedEntry.title || selectedEntry.username || text.currentPassword : text.selectEntryHint}</span>
            </div>
          </div>

          {selectedEntry ? (
            <>
              <label className="field">
                <span>{text.title}</span>
                <input
                  list={TITLE_SUGGESTIONS_ID}
                  value={selectedEntry.title}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, title: event.target.value }, text.title)}
                />
              </label>
              <label className="field">
                <span>{text.url}</span>
                <input
                  list={URL_SUGGESTIONS_ID}
                  value={selectedEntry.url}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, url: event.target.value }, text.url)}
                />
              </label>
              <label className="field">
                <span>{text.username}</span>
                <input
                  list={USERNAME_SUGGESTIONS_ID}
                  value={selectedEntry.username}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, username: event.target.value }, text.username)}
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
                <span>{text.password}</span>
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
                    title={revealedEntryId === selectedEntry.id ? text.hidePassword : text.showPassword}
                    onClick={() => setRevealedEntryId((current) => (current === selectedEntry.id ? null : selectedEntry.id))}
                  >
                    {revealedEntryId === selectedEntry.id ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title={text.generatePassword}
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
                <span>{text.folder}</span>
                <input
                  list={FOLDER_SUGGESTIONS_ID}
                  placeholder={text.passwordFolderPlaceholder}
                  value={selectedEntry.folder || ""}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, folder: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{text.tags}</span>
                <div className="tag-editor">
                  {selectedEntry.tags.map((tag, index) =>
                    editingTagIndex === index ? (
                      <input
                        key={`${selectedEntry.id}-${tag}-edit`}
                        autoFocus
                        className="tag-pill-input"
                        value={editingTagValue}
                        onChange={(event) => setEditingTagValue(event.target.value)}
                        onBlur={() => commitEditSelectedEntryTag(index)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitEditSelectedEntryTag(index);
                          }
                        }}
                      />
                    ) : (
                      <span key={`${selectedEntry.id}-${tag}`} className="tag-pill">
                        <button
                          type="button"
                          className="tag-pill-label"
                          title={text.editTag}
                          onClick={() => beginEditSelectedEntryTag(index, tag)}
                        >
                          {tag}
                        </button>
                        <button
                          type="button"
                          className="tag-pill-remove"
                          title={text.deleteTag}
                          onClick={() => removeSelectedEntryTag(tag)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ),
                  )}
                  <input
                    className="tag-input"
                    placeholder={selectedEntry.tags.length > 0 ? text.addTagPlaceholder : text.tagPlaceholder}
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        addSelectedEntryTag(tagDraft);
                      }
                      if (event.key === "Backspace" && !tagDraft && selectedEntry.tags.length > 0) {
                        removeSelectedEntryTag(selectedEntry.tags[selectedEntry.tags.length - 1]);
                      }
                    }}
                    onBlur={() => addSelectedEntryTag(tagDraft)}
                  />
                </div>
              </label>
              <label className="field">
                <span>{text.notes}</span>
                <textarea
                  placeholder={text.notesPlaceholder}
                  value={selectedEntry.notes}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, notes: event.target.value })}
                />
              </label>

              <div className="action-row">
                <button type="button" className="primary-button compact" disabled={busy} onClick={() => void handleSaveSelected()}>
                  <Save size={15} />
                  {busy ? text.saving : text.saveSync}
                </button>
                <button type="button" className="ghost-button compact danger" disabled={busy} onClick={() => void handleDelete(selectedEntry.id)}>
                  <Trash2 size={15} />
                  {text.delete}
                </button>
              </div>
            </>
          ) : (
            <p className="empty-hint">{text.selectEntryHint}</p>
          )}
        </section>
      </div>
    );
  }

  if (!vault) {
    return renderLockedScreen();
  }

  return (
    <main className={`popup-shell manager-shell panel-${panelMode}`} data-theme={settings.theme}>
      <header className="popup-header manager-header">
        <div className="header-title">
          {panelMode !== "main" ? (
            <button type="button" className="icon-button" title={text.back} onClick={() => setPanelMode("main")}>
              <ArrowLeft size={16} />
            </button>
          ) : (
            <ShieldCheck size={18} />
          )}
          <div>
            <strong>Password WebDAV</strong>
            <span>
              {panelMode === "settings"
                ? text.vaultSettings
                : panelMode === "entry"
                  ? text.details
                  : host || text.currentPageNoHost}
            </span>
          </div>
        </div>

        <div className="header-actions">
          {panelMode === "main" && (
            <div className="view-toggle">
              <button
                type="button"
                className={browseMode === "folders" ? "active" : ""}
                onClick={() => {
                  setBrowseMode("folders");
                  setStatus(feedback.foldersView);
                }}
              >
                {text.folders}
              </button>
              <button
                type="button"
                className={browseMode === "all" ? "active" : ""}
                onClick={() => {
                  setBrowseMode("all");
                  setStatus(feedback.allView);
                }}
              >
                {text.allTab}
              </button>
            </div>
          )}
          {renderHeaderPreferences()}
          <button
            type="button"
            className="icon-button"
            title={text.settings}
            onClick={() => setPanelMode((value) => (value === "settings" ? "main" : "settings"))}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="popup-content">
        {panelMode === "main" ? (
          <>
            <div className="toolbar-row">
              <input
                className="search-input"
                placeholder={text.searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="toolbar-actions">
                <button type="button" className="icon-button" title={text.createEntry} onClick={handleAdd}>
                  <Plus size={16} />
                </button>
                <button type="button" className="icon-button" title={text.refresh} disabled={busy} onClick={() => void handleRefresh()}>
                  <RefreshCw size={16} />
                </button>
                <button type="button" className="icon-button" title={text.lock} onClick={() => void lockVault()}>
                  <Lock size={16} />
                </button>
              </div>
            </div>

            {browseMode === "folders" ? renderFolderView() : renderAllView()}
          </>
        ) : panelMode === "settings" ? (
          renderSettingsView()
        ) : (
          renderEntryDetailView()
        )}
      </div>

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

      <footer className="popup-footer">
        <p className="status popup-status" aria-live="polite">
          {statusText}
          {dirty ? ` · ${text.dirtySuffix}` : ""}
        </p>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
