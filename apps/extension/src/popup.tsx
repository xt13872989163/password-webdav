import {
  Copy,
  Dices,
  Edit3,
  Folder,
  FolderPlus,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createEmptyVault,
  decryptVault,
  encryptVault,
  entryFolder,
  entryMatchesFolderTree,
  generatePassword,
  loadVaultFile,
  mergeVaultFolders,
  nowIso,
  normalizeFolderPath,
  normalizeStoredVaultPath,
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
  loadSessionMasterPassword,
  loadExtensionConfig,
  loadUnlockedVault,
  saveSessionMasterPassword,
  saveExtensionConfig,
  saveUnlockedVault,
} from "./extensionState";
import "./popup.css";

const ALL_FOLDERS = "__all__";
const UNCATEGORIZED_FOLDER = "__uncategorized__";
const TITLE_SUGGESTIONS_ID = "pw-title-suggestions";
const URL_SUGGESTIONS_ID = "pw-url-suggestions";
const USERNAME_SUGGESTIONS_ID = "pw-username-suggestions";
const FOLDER_SUGGESTIONS_ID = "pw-folder-suggestions";

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

function currentHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
    title: defaults.title || host || "新密码",
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
  const folderFromSidebar = activeFolder !== ALL_FOLDERS && activeFolder !== UNCATEGORIZED_FOLDER ? activeFolder : "";
  if (!vault || !host) {
    return {
      title: host || "新密码",
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
    title: latest?.title || host || "新密码",
    username: usernames.length === 1 ? usernames[0] : "",
    url: latest?.url || `https://${host}`,
    folder: folderFromSidebar || entryFolder(latest ?? { folder: "" } as VaultEntry),
  };
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
  const [activeFolder, setActiveFolder] = useState(ALL_FOLDERS);
  const [newFolderPath, setNewFolderPath] = useState("");
  const splitPaneRef = useRef<HTMLDivElement | null>(null);
  const [folderWidth, setFolderWidth] = useState(180);
  const [listWidth, setListWidth] = useState(240);
  const [activeSplitter, setActiveSplitter] = useState<"folders" | "entries" | null>(null);

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
    if (!activeSplitter) return;

    const handleWidth = 12;
    const minFolderWidth = 140;
    const minListWidth = 180;
    const minEditorWidth = 280;

    function clamp(value: number, min: number, max: number) {
      return Math.min(Math.max(value, min), max);
    }

    function handlePointerMove(event: PointerEvent) {
      const pane = splitPaneRef.current;
      if (!pane) return;

      const rect = pane.getBoundingClientRect();
      const totalWidth = rect.width;
      const relativeX = event.clientX - rect.left;

      if (activeSplitter === "folders") {
        const maxFolderWidth = Math.max(minFolderWidth, totalWidth - listWidth - minEditorWidth - handleWidth * 2);
        setFolderWidth(clamp(relativeX, minFolderWidth, maxFolderWidth));
        return;
      }

      const leftOffset = folderWidth + handleWidth;
      const nextWidth = relativeX - leftOffset;
      const maxListWidth = Math.max(minListWidth, totalWidth - folderWidth - minEditorWidth - handleWidth * 2);
      setListWidth(clamp(nextWidth, minListWidth, maxListWidth));
    }

    function handlePointerUp() {
      setActiveSplitter(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeSplitter, folderWidth, listWidth, splitPaneRef]);

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
    return sortEntriesForHost(filtered, host || query);
  }, [activeFolder, host, query, vault]);

  const folderOptions = useMemo(() => {
    if (!vault) return [] as string[];
    return sortFolders(mergeVaultFolders(vault, vault.entries.map(entryFolder)));
  }, [vault]);

  const suggestedEntries = useMemo(() => {
    if (!vault) return [] as VaultEntry[];
    return [...sortEntriesForHost(vault.entries, draftHost || host)].sort(byMostRecent).slice(0, 12);
  }, [draftHost, host, vault]);

  const titleSuggestions = useMemo(
    () => uniqueNonEmpty([...suggestedEntries.map((entry) => entry.title), ...(vault?.entries ?? []).map((entry) => entry.title)]).slice(0, 12),
    [suggestedEntries, vault],
  );
  const urlSuggestions = useMemo(
    () => uniqueNonEmpty([...suggestedEntries.map((entry) => entry.url), ...(vault?.entries ?? []).map((entry) => entry.url)]).slice(0, 12),
    [suggestedEntries, vault],
  );
  const usernameSuggestions = useMemo(
    () => uniqueNonEmpty([...suggestedEntries.map((entry) => entry.username), ...(vault?.entries ?? []).map((entry) => entry.username)]).slice(0, 12),
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
    if (!selectedEntry) return;
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
      setStatus(error);
      return;
    }

    setBusy(true);
    setStatus("正在连接 WebDAV...");
    try {
      await saveExtensionConfig(settings);
      const file = await loadVaultFile(settings);
      if (!file) {
        const nextVault = createEmptyVault();
        await persistVault(nextVault, "WebDAV 上没有 vault，已创建新的加密密码库。");
        await rememberMasterPasswordForBackground();
        setSelectedEntry(null);
        return;
      }

      const plain = await decryptVault(masterPassword, file);
      await saveUnlockedVault(plain);
      await rememberMasterPasswordForBackground();
      setVault(plain);
      setSelectedEntry(plain.entries[0] ?? null);
      setDirty(false);
      setStatus(`已解锁 ${plain.entries.length} 条密码。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "解锁失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!masterPassword) {
      setStatus("刷新需要重新输入主密码。请锁定后再解锁。");
      return;
    }

    setBusy(true);
    setStatus("正在刷新...");
    try {
      const file = await loadVaultFile(settings);
      if (!file) {
        throw new Error("WebDAV 上没有 vault 文件。");
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

  async function handleDelete(id: string) {
    if (!vault) return;
    setBusy(true);
    setStatus("正在删除并同步...");
    try {
      const nextVault = removeEntry(vault, id);
      await persistVault(nextVault, "已删除并同步到 WebDAV。");
      setSelectedEntry(nextVault.entries[0] ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败。");
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
    setStatus("已新建条目，并按当前网站带出默认值。");
  }

  async function handleFill(entry: VaultEntry) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("找不到当前标签页。");
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "password-webdav.fill-entry",
      entry,
    });
    setStatus(response?.message ?? "已填充。");
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
    setStatus("已锁定。");
  }

  if (!vault) {
    return (
      <main className="popup-shell">
        <header className="popup-header">
          <ShieldCheck size={18} />
          <strong>Password WebDAV</strong>
          <button className="ghost-icon" title="设置" onClick={() => chrome.runtime.openOptionsPage()}>
            <Settings size={16} />
          </button>
        </header>

        <label>
          <span>WebDAV 根地址</span>
          <input value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} />
        </label>
        <label>
          <span>用户名</span>
          <input value={settings.username} onChange={(event) => setSettings({ ...settings, username: event.target.value })} />
        </label>
        <label>
          <span>密码或应用密码</span>
          <input type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} />
        </label>
        <label>
          <span>Vault 子路径</span>
          <div className="path-input">
            <span className="path-prefix">{VAULT_ROOT_FOLDER}/</span>
            <input value={vaultSubpath} onChange={(event) => updateVaultSubpath(event.target.value)} />
          </div>
        </label>
        <p className="field-help">根目录固定为 `PasswordWebDAV/`，这里只填写里面的子路径，例如 `work/password-vault.json`。</p>
        <label>
          <span>主密码</span>
          <input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} />
        </label>
        <button className="primary" disabled={busy} onClick={handleUnlock}>
          <Lock size={16} />
          {busy ? "处理中..." : "解锁或创建"}
        </button>
        {status && <p className="status">{status}</p>}
      </main>
    );
  }

  return (
    <main className="popup-shell manager-shell">
      <header className="popup-header">
        <ShieldCheck size={18} />
        <strong>Password WebDAV</strong>
        <button className="ghost-icon" title="设置" onClick={() => chrome.runtime.openOptionsPage()}>
          <Settings size={16} />
        </button>
      </header>

      <div className="meta-line">
        <span>{host || "当前页面无可识别域名"} · {vault.entries.length} 条 · {folderFilterLabel(activeFolder)}</span>
        <div className="toolbar-buttons">
          <button className="ghost-icon" title="新增" onClick={handleAdd}>
            <Plus size={15} />
          </button>
          <button className="ghost-icon" title="刷新" disabled={busy} onClick={handleRefresh}>
            <RefreshCw size={15} />
          </button>
          <button className="ghost-icon" title="锁定" onClick={lockVault}>
            <Lock size={15} />
          </button>
        </div>
      </div>

      <input className="search-input" placeholder="搜索密码" value={query} onChange={(event) => setQuery(event.target.value)} />

      <div
        ref={(node) => {
          splitPaneRef.current = node;
        }}
        className="split-pane"
        style={{
          gridTemplateColumns: `${folderWidth}px 12px ${listWidth}px 12px minmax(280px, 1fr)`,
        }}
      >
        <aside className="folder-panel">
          <div className="folder-title">
            <Folder size={15} />
            <strong>文件夹</strong>
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
            <button className="ghost-icon" title="创建文件夹" disabled={busy} onClick={handleCreateFolder}>
              <FolderPlus size={15} />
            </button>
          </div>
          <div className="folder-list">
            <button
              className={`folder-item ${activeFolder === ALL_FOLDERS ? "selected" : ""}`}
              onClick={() => setActiveFolder(ALL_FOLDERS)}
            >
              <Folder size={14} />
              <span>全部</span>
            </button>
            <button
              className={`folder-item ${activeFolder === UNCATEGORIZED_FOLDER ? "selected" : ""}`}
              onClick={() => setActiveFolder(UNCATEGORIZED_FOLDER)}
            >
              <Folder size={14} />
              <span>未分类</span>
            </button>
            {folderOptions.map((folder) => (
              <button
                key={folder}
                className={`folder-item ${activeFolder === folder ? "selected" : ""}`}
                style={{ paddingLeft: `${10 + Math.max(0, folder.split("/").length - 1) * 14}px` }}
                title={folder}
                onClick={() => setActiveFolder(folder)}
              >
                <Folder size={14} />
                <span>{folderDisplayName(folder)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div
          className={`splitter ${activeSplitter === "folders" ? "active" : ""}`}
          onPointerDown={(event) => {
            event.preventDefault();
            setActiveSplitter("folders");
          }}
        />

        <div className="entry-list">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className={`entry-card ${entry.id === selectedEntry?.id ? "selected" : ""}`}
              onClick={() => setSelectedEntry(entry)}
            >
              <div>
                <strong>{entry.title || "未命名"}</strong>
                <p>{entry.username || entry.url || "未填写账号"}</p>
                {entryFolder(entry) && <p className="entry-folder">{entryFolder(entry)}</p>}
              </div>
              <div className="entry-buttons">
                <button title="复制账号" onClick={(event) => {
                  event.stopPropagation();
                  void copyToClipboard(entry.username, "账号");
                }}>
                  <Copy size={14} />
                </button>
                <button title="复制密码" onClick={(event) => {
                  event.stopPropagation();
                  void copyToClipboard(entry.password, "密码");
                }}>
                  <KeyRound size={14} />
                </button>
                <button className="fill-button" onClick={(event) => {
                  event.stopPropagation();
                  void handleFill(entry);
                }}>
                  填充
                </button>
              </div>
            </article>
          ))}
          {entries.length === 0 && <p className="empty-hint">没有找到匹配的密码。</p>}
        </div>

        <div
          className={`splitter ${activeSplitter === "entries" ? "active" : ""}`}
          onPointerDown={(event) => {
            event.preventDefault();
            setActiveSplitter("entries");
          }}
        />

        <section className="editor-box">
          {selectedEntry ? (
            <>
              <div className="editor-title">
                <Edit3 size={15} />
                <strong>编辑密码</strong>
              </div>
              <label>
                <span>标题</span>
                <input
                  list={TITLE_SUGGESTIONS_ID}
                  value={selectedEntry.title}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, title: event.target.value }, "标题")}
                />
              </label>
              <label>
                <span>网址</span>
                <input
                  list={URL_SUGGESTIONS_ID}
                  value={selectedEntry.url}
                  onChange={(event) => updateSelectedEntry({ ...selectedEntry, url: event.target.value }, "网址")}
                />
              </label>
              <label>
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
                    <button key={`${entry.id}-username`} className="suggestion-chip" type="button" onClick={() => applySuggestedEntry(entry)}>
                      {entry.username}
                    </button>
                  ))}
                </div>
              )}
              <label>
                <span>密码</span>
                <div className="inline-input">
                  <input type="password" value={selectedEntry.password} onChange={(event) => {
                    setSelectedEntry({ ...selectedEntry, password: event.target.value });
                    setDirty(true);
                  }} />
                  <button title="生成密码" onClick={() => {
                    setSelectedEntry({ ...selectedEntry, password: generatePassword() });
                    setDirty(true);
                  }}>
                    <Dices size={15} />
                  </button>
                </div>
              </label>
              <label>
                <span>文件夹</span>
                <input
                  list={FOLDER_SUGGESTIONS_ID}
                  placeholder="例如 工作/GitHub，留空为未分类"
                  value={selectedEntry.folder || ""}
                  onChange={(event) => {
                    updateSelectedEntry({ ...selectedEntry, folder: event.target.value });
                  }}
                />
              </label>
              <p className="field-help">`PasswordWebDAV/` 是固定根目录，后面只能改子路径。输入时会自动给出常见标题、网址、账号和文件夹建议。</p>
              <label>
                <span>标签</span>
                <input
                  value={tagsToText(selectedEntry.tags)}
                  onChange={(event) => {
                    updateSelectedEntry({ ...selectedEntry, tags: textToTags(event.target.value) });
                  }}
                />
              </label>
              <label>
                <span>备注</span>
                <textarea
                  value={selectedEntry.notes}
                  onChange={(event) => {
                    updateSelectedEntry({ ...selectedEntry, notes: event.target.value });
                  }}
                />
              </label>
              <p className="field-help">输入时会优先建议当前网站已有的标题、网址、账号和文件夹；新建条目遇到精确匹配时会自动带出密码。</p>
              <div className="editor-actions">
                <button className="primary" disabled={busy} onClick={handleSaveSelected}>
                  <Save size={15} />
                  {busy ? "保存中..." : "保存同步"}
                </button>
                <button className="danger" disabled={busy} onClick={() => handleDelete(selectedEntry.id)}>
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
            </>
          ) : (
            <p className="empty-hint">选择一个密码，或点击新增。</p>
          )}
        </section>
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

      {status && <p className="status">{status}{dirty ? " · 有未保存修改" : ""}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
