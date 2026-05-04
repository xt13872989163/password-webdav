import {
  Copy,
  Dices,
  Edit3,
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
import { useEffect, useMemo, useState } from "react";
import {
  createEmptyVault,
  decryptVault,
  encryptVault,
  generatePassword,
  loadVaultFile,
  nowIso,
  saveVaultFile,
  sortEntriesForHost,
  uuid,
  type PlainVault,
  type VaultEntry,
  type WebDavConfig,
} from "@password-webdav/core";
import {
  clearUnlockedVault,
  DEFAULT_EXTENSION_CONFIG,
  loadExtensionConfig,
  loadUnlockedVault,
  saveExtensionConfig,
  saveUnlockedVault,
} from "./extensionState";
import "./popup.css";

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

function createEntry(host = ""): VaultEntry {
  const now = nowIso();
  return {
    id: uuid(),
    title: host || "新密码",
    username: "",
    password: generatePassword(),
    url: host ? `https://${host}` : "",
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
  const nextEntry = { ...entry, updatedAt: now };
  const exists = vault.entries.some((item) => item.id === entry.id);
  return {
    ...vault,
    updatedAt: now,
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
  if (!settings.vaultPath.trim()) return "请填写 vault 文件路径。";
  if (masterPassword.length < 8) return "主密码至少需要 8 位。";
  return "";
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

  useEffect(() => {
    void loadExtensionConfig().then(setSettings);
    void loadUnlockedVault().then((savedVault) => {
      setVault(savedVault);
      setSelectedEntry(savedVault?.entries[0] ?? null);
    });
    void getActiveTabUrl().then(setTabUrl);
  }, []);

  const host = useMemo(() => currentHost(tabUrl), [tabUrl]);
  const entries = useMemo(() => {
    const source = vault?.entries ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? source.filter((entry) =>
          [entry.title, entry.username, entry.url, entry.notes, ...entry.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : source;
    return sortEntriesForHost(filtered, host || query);
  }, [host, query, vault]);

  async function persistVault(nextVault: PlainVault, nextStatus = "已同步到 WebDAV。") {
    const encrypted = await encryptVault(masterPassword, nextVault);
    await saveVaultFile(settings, encrypted);
    await saveUnlockedVault(nextVault);
    setVault(nextVault);
    setDirty(false);
    setStatus(nextStatus);
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
        setSelectedEntry(null);
        return;
      }

      const plain = await decryptVault(masterPassword, file);
      await saveUnlockedVault(plain);
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

  function handleAdd() {
    const entry = createEntry(host);
    setSelectedEntry(entry);
    setDirty(true);
    setStatus("已新建条目，填写后点击保存。");
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
    await clearUnlockedVault();
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
          <span>Vault 文件路径</span>
          <input value={settings.vaultPath} onChange={(event) => setSettings({ ...settings, vaultPath: event.target.value })} />
        </label>
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
        <span>{host || "当前页面无可识别域名"} · {vault.entries.length} 条</span>
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

      <div className="split-pane">
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

        <section className="editor-box">
          {selectedEntry ? (
            <>
              <div className="editor-title">
                <Edit3 size={15} />
                <strong>编辑密码</strong>
              </div>
              <label>
                <span>标题</span>
                <input value={selectedEntry.title} onChange={(event) => {
                  setSelectedEntry({ ...selectedEntry, title: event.target.value });
                  setDirty(true);
                }} />
              </label>
              <label>
                <span>网址</span>
                <input value={selectedEntry.url} onChange={(event) => {
                  setSelectedEntry({ ...selectedEntry, url: event.target.value });
                  setDirty(true);
                }} />
              </label>
              <label>
                <span>用户名</span>
                <input value={selectedEntry.username} onChange={(event) => {
                  setSelectedEntry({ ...selectedEntry, username: event.target.value });
                  setDirty(true);
                }} />
              </label>
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
                <span>标签</span>
                <input value={tagsToText(selectedEntry.tags)} onChange={(event) => {
                  setSelectedEntry({ ...selectedEntry, tags: textToTags(event.target.value) });
                  setDirty(true);
                }} />
              </label>
              <label>
                <span>备注</span>
                <textarea value={selectedEntry.notes} onChange={(event) => {
                  setSelectedEntry({ ...selectedEntry, notes: event.target.value });
                  setDirty(true);
                }} />
              </label>
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

      {status && <p className="status">{status}{dirty ? " · 有未保存修改" : ""}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
