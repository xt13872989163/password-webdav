import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_LANGUAGES,
  EXTENSION_THEMES,
  getExtensionVaultSubpath,
  loadExtensionConfig,
  saveExtensionConfig,
  type ExtensionConfig,
} from "./extensionState";
import { getMessages, getThemeLabel } from "./i18n";
import { normalizeStoredVaultPath, VAULT_ROOT_FOLDER } from "@password-webdav/core";
import "./popup.css";

function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionConfig>(DEFAULT_EXTENSION_CONFIG);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadExtensionConfig().then(setSettings);
  }, []);

  const vaultSubpath = getExtensionVaultSubpath(settings);
  const text = getMessages(settings.language);

  async function handleSave() {
    await saveExtensionConfig(settings);
    setStatus(text.status.settingsSaved);
  }

  return (
    <main className="options-shell" data-theme={settings.theme}>
      <div>
        <h1>{text.optionsTitle}</h1>
        <p>{text.optionsSubtitle}</p>
      </div>

      <section className="panel-card settings-panel">
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
          <input
            type="password"
            value={settings.password}
            onChange={(event) => setSettings({ ...settings, password: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{text.vaultSubpath}</span>
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
          {text.fixedRootHelp} <code>PasswordWebDAV/</code>，{text.fixedRootHelpTail}。
        </p>
        <label className="field">
          <span>{text.theme}</span>
          <select value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as ExtensionConfig["theme"] })}>
            {EXTENSION_THEMES.map((theme) => (
              <option key={theme.value} value={theme.value}>
                {getThemeLabel(theme.value, settings.language)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{text.language}</span>
          <select value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value as ExtensionConfig["language"] })}>
            {EXTENSION_LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary-button" onClick={() => void handleSave()}>
          {text.saveSettings}
        </button>
      </section>

      {status && <p className="status">{status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
