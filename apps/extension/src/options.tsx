import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  DEFAULT_SAVE_PROMPT_WAIT_MS,
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_LANGUAGES,
  EXTENSION_THEMES,
  getExtensionVaultSubpath,
  loadExtensionConfig,
  MAX_SAVE_PROMPT_WAIT_MS,
  MIN_SAVE_PROMPT_WAIT_MS,
  normalizeSavePromptWaitMs,
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

  function updateSavePromptWaitSeconds(value: string) {
    const numeric = Number(value);
    setSettings((current) => ({
      ...current,
      savePromptWaitMs: normalizeSavePromptWaitMs(
        Number.isFinite(numeric) && numeric > 0 ? numeric * 1000 : DEFAULT_SAVE_PROMPT_WAIT_MS,
      ),
    }));
  }

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
        <label className="field">
          <span>{text.savePromptWaitSeconds}</span>
          <input
            type="number"
            min={MIN_SAVE_PROMPT_WAIT_MS / 1000}
            max={MAX_SAVE_PROMPT_WAIT_MS / 1000}
            step={1}
            value={Math.round(settings.savePromptWaitMs / 1000)}
            onChange={(event) => updateSavePromptWaitSeconds(event.target.value)}
          />
        </label>
        <p className="field-help">{text.savePromptWaitHint}</p>
        <button type="button" className="primary-button" onClick={() => void handleSave()}>
          {text.saveSettings}
        </button>
      </section>

      {status && <p className="status">{status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
