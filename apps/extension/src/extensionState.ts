import type { PlainVault, WebDavConfig } from "@password-webdav/core";

const CONFIG_KEY = "password-webdav.extension.config";
const VAULT_KEY = "password-webdav.extension.vault";

export const DEFAULT_EXTENSION_CONFIG: WebDavConfig = {
  baseUrl: "",
  username: "",
  password: "",
  vaultPath: "PasswordWebDAV/password-vault.json",
};

export async function loadExtensionConfig(): Promise<WebDavConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_EXTENSION_CONFIG, ...(result[CONFIG_KEY] as WebDavConfig | undefined) };
}

export async function saveExtensionConfig(config: WebDavConfig) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
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
