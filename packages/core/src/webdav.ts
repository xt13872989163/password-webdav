import type { EncryptedVaultFile, WebDavConfig } from "./types";
import { decodeEncryptedVaultFile, encodeJson } from "./crypto";

export const DEFAULT_VAULT_FILENAME = "password-vault.json";
const DEFAULT_PROVIDER_FOLDER = "PasswordWebDAV";

function trimLeadingSlashes(value: string) {
  return value.replace(/^\/+/, "");
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export function resolveVaultUrl(config: WebDavConfig) {
  const base = new URL(ensureTrailingSlash(config.baseUrl));
  return new URL(normalizeVaultPath(config, base), base).toString();
}

function normalizeVaultPath(config: WebDavConfig, base: URL) {
  const rawPath = trimLeadingSlashes(config.vaultPath || DEFAULT_VAULT_FILENAME);
  if (rawPath.includes("/")) {
    return rawPath;
  }

  if (base.hostname.toLowerCase().endsWith("jianguoyun.com")) {
    return `${DEFAULT_PROVIDER_FOLDER}/${rawPath}`;
  }

  return rawPath;
}

function resolveVaultParentUrls(config: WebDavConfig) {
  const base = new URL(ensureTrailingSlash(config.baseUrl));
  const parts = normalizeVaultPath(config, base)
    .split("/")
    .filter(Boolean);
  if (parts.length <= 1) {
    return [] as string[];
  }

  const parents: string[] = [];
  let currentPath = "";
  for (const part of parts.slice(0, -1)) {
    currentPath += `${part}/`;
    parents.push(new URL(currentPath, base).toString());
  }
  return parents;
}

function toBasicAuth(username: string, password: string) {
  const encoded = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  encoded.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
}

function requestHeaders(config: WebDavConfig, contentType = "application/json") {
  return {
    Authorization: toBasicAuth(config.username, config.password),
    "Content-Type": contentType,
  };
}

async function ensureVaultDirectories(config: WebDavConfig) {
  const parentUrls = resolveVaultParentUrls(config);
  for (const parentUrl of parentUrls) {
    const response = await fetch(parentUrl, {
      method: "MKCOL",
      headers: requestHeaders(config, "text/plain"),
    });
    if (response.ok || response.status === 405 || response.status === 409) {
      continue;
    }
    throw new Error(`Failed to create WebDAV directory: ${response.status} ${response.statusText}`);
  }
}

export async function loadVaultFile(config: WebDavConfig) {
  const response = await fetch(resolveVaultUrl(config), {
    method: "GET",
    headers: requestHeaders(config),
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 409) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load vault from WebDAV: ${response.status} ${response.statusText}`);
  }
  return decodeEncryptedVaultFile(await response.text());
}

export async function saveVaultFile(config: WebDavConfig, file: EncryptedVaultFile) {
  await ensureVaultDirectories(config);
  const response = await fetch(resolveVaultUrl(config), {
    method: "PUT",
    headers: requestHeaders(config),
    body: encodeJson(file),
  });
  if (!response.ok) {
    throw new Error(`Failed to save vault to WebDAV: ${response.status} ${response.statusText}`);
  }
}

export async function probeVault(config: WebDavConfig) {
  const response = await fetch(resolveVaultUrl(config), {
    method: "HEAD",
    headers: requestHeaders(config, "text/plain"),
    cache: "no-store",
  });
  if (response.status === 404) {
    return { exists: false, etag: null };
  }
  if (!response.ok && response.status !== 405) {
    throw new Error(`Failed to probe WebDAV vault: ${response.status} ${response.statusText}`);
  }
  return {
    exists: response.ok,
    etag: response.headers.get("etag"),
  };
}
