import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_THEMES,
  getExtensionVaultSubpath,
  loadExtensionConfig,
  saveExtensionConfig,
  type ExtensionConfig,
} from "./extensionState";
import { normalizeStoredVaultPath, VAULT_ROOT_FOLDER } from "@password-webdav/core";
import "./popup.css";

function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionConfig>(DEFAULT_EXTENSION_CONFIG);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadExtensionConfig().then(setSettings);
  }, []);

  const vaultSubpath = getExtensionVaultSubpath(settings);

  async function handleSave() {
    await saveExtensionConfig(settings);
    setStatus("已保存设置。");
  }

  return (
    <main className="options-shell" data-theme={settings.theme}>
      <div>
        <h1>Password WebDAV 设置</h1>
        <p>这是扩展的全局配置兜底页。日常管理密码请优先使用 popup 里的“设置 / 详情”视图。</p>
      </div>

      <section className="panel-card settings-panel">
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
          <input
            type="password"
            value={settings.password}
            onChange={(event) => setSettings({ ...settings, password: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Vault 子路径</span>
          <div className="path-input">
            <span className="path-prefix">{VAULT_ROOT_FOLDER}/</span>
            <input
              value={vaultSubpath}
              onChange={(event) =>
                setSettings({ ...settings, vaultPath: normalizeStoredVaultPath(event.target.value) })
              }
            />
          </div>
        </label>
        <p className="field-help">
          根目录固定为 <code>PasswordWebDAV/</code>，这里只需要填写它里面的子路径。
        </p>
        <label className="field">
          <span>主题</span>
          <select value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as ExtensionConfig["theme"] })}>
            {EXTENSION_THEMES.map((theme) => (
              <option key={theme.value} value={theme.value}>
                {theme.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary-button" onClick={() => void handleSave()}>
          保存设置
        </button>
      </section>

      {status && <p className="status">{status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
