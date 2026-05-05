import { normalizeStoredVaultPath, vaultSubpathFromStoredPath, type PlainVault, type WebDavConfig } from "@password-webdav/core";

const CONFIG_KEY = "password-webdav.extension.config";
const VAULT_KEY = "password-webdav.extension.vault";
const MASTER_PASSWORD_KEY = "password-webdav.extension.master-password";
export const DEFAULT_SAVE_PROMPT_WAIT_MS = 5000;
export const MIN_SAVE_PROMPT_WAIT_MS = 1000;
export const MAX_SAVE_PROMPT_WAIT_MS = 15000;

export type ExtensionTheme = "fresh" | "night" | "contrast" | "tech" | "forest" | "amber" | "graphite";
export type ExtensionLanguage = "zh" | "en";
export type ExtensionConfig = WebDavConfig & {
  theme: ExtensionTheme;
  language: ExtensionLanguage;
  savePromptWaitMs: number;
};

export const EXTENSION_THEMES: Array<{ value: ExtensionTheme; label: string }> = [
  { value: "fresh", label: "清爽" },
  { value: "night", label: "夜间" },
  { value: "contrast", label: "高对比" },
  { value: "tech", label: "科技" },
  { value: "forest", label: "森林" },
  { value: "amber", label: "琥珀" },
  { value: "graphite", label: "石墨" },
];

export const EXTENSION_LANGUAGES: Array<{ value: ExtensionLanguage; label: string }> = [
  { value: "zh", label: "zh" },
  { value: "en", label: "en" },
];

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  baseUrl: "",
  username: "",
  password: "",
  vaultPath: normalizeStoredVaultPath("password-vault.json"),
  theme: "fresh",
  language: "zh",
  savePromptWaitMs: DEFAULT_SAVE_PROMPT_WAIT_MS,
};

function normalizeTheme(value: unknown): ExtensionTheme {
  return value === "night" ||
    value === "contrast" ||
    value === "tech" ||
    value === "forest" ||
    value === "amber" ||
    value === "graphite"
    ? value
    : "fresh";
}

function normalizeLanguage(value: unknown): ExtensionLanguage {
  return value === "en" ? "en" : "zh";
}

export function normalizeSavePromptWaitMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SAVE_PROMPT_WAIT_MS;
  return Math.min(MAX_SAVE_PROMPT_WAIT_MS, Math.max(MIN_SAVE_PROMPT_WAIT_MS, Math.round(numeric)));
}

export async function loadExtensionConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const next = { ...DEFAULT_EXTENSION_CONFIG, ...(result[CONFIG_KEY] as Partial<ExtensionConfig> | undefined) };
  return {
    ...next,
    vaultPath: normalizeStoredVaultPath(next.vaultPath),
    theme: normalizeTheme(next.theme),
    language: normalizeLanguage(next.language),
    savePromptWaitMs: normalizeSavePromptWaitMs(next.savePromptWaitMs),
  };
}

export async function saveExtensionConfig(config: ExtensionConfig) {
  await chrome.storage.local.set({
    [CONFIG_KEY]: {
      ...config,
      vaultPath: normalizeStoredVaultPath(config.vaultPath),
      theme: normalizeTheme(config.theme),
      language: normalizeLanguage(config.language),
      savePromptWaitMs: normalizeSavePromptWaitMs(config.savePromptWaitMs),
    },
  });
}

export function getExtensionVaultSubpath(config: WebDavConfig) {
  return vaultSubpathFromStoredPath(config.vaultPath);
}

export async function loadUnlockedVault(): Promise<PlainVault | null> {
  const result = await chrome.storage.session.get(VAULT_KEY);
  return (result[VAULT_KEY] as PlainVault | undefined) ?? null;
}

export async function saveUnlockedVault(vault: PlainVault) {
  await chrome.storage.session.set({ [VAULT_KEY]: vault });
}

export async function clearUnlockedVault() {
  await chrome.storage.session.remove(VAULT_KEY);
}

export async function saveSessionMasterPassword(masterPassword: string) {
  await chrome.storage.session.set({ [MASTER_PASSWORD_KEY]: masterPassword });
}

export async function loadSessionMasterPassword(): Promise<string> {
  const result = await chrome.storage.session.get(MASTER_PASSWORD_KEY);
  return String(result[MASTER_PASSWORD_KEY] || "");
}

export async function clearSessionMasterPassword() {
  await chrome.storage.session.remove(MASTER_PASSWORD_KEY);
}
