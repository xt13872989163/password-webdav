import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { DEFAULT_EXTENSION_CONFIG, loadExtensionConfig, saveExtensionConfig } from "./extensionState";
import type { WebDavConfig } from "@password-webdav/core";
import "./popup.css";

function OptionsApp() {
  const [settings, setSettings] = useState<WebDavConfig>(DEFAULT_EXTENSION_CONFIG);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadExtensionConfig().then(setSettings);
  }, []);

  async function handleSave() {
    await saveExtensionConfig(settings);
    setStatus("已保存。");
  }

  return (
    <main className="options-shell">
      <h1>Password WebDAV 设置</h1>
      <p>扩展会用这些信息读取或创建 WebDAV 上的加密 vault。</p>
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
      <button className="primary" onClick={handleSave}>保存设置</button>
      {status && <p className="status">{status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
