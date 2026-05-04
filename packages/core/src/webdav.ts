import type { EncryptedVaultFile, WebDavConfig } from "./types";
import { decodeEncryptedVaultFile, encodeJson } from "./crypto";

export const DEFAULT_VAULT_FILENAME = "password-vault.json";
export const VAULT_ROOT_FOLDER = "PasswordWebDAV";
const DEFAULT_WEBDAV_TIMEOUT_MS = 15_000;

function trimLeadingSlashes(value: string) {
  return value.replace(/^\/+/, "");
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export function normalizeVaultSubpath(value: string) {
  const trimmed = trimLeadingSlashes(value || "");
  const withoutRoot = trimmed.toLowerCase().startsWith(`${VAULT_ROOT_FOLDER.toLowerCase()}/`)
    ? trimmed.slice(VAULT_ROOT_FOLDER.length + 1)
    : trimmed.toLowerCase() === VAULT_ROOT_FOLDER.toLowerCase()
      ? ""
      : trimmed;
  const normalized = withoutRoot
    .split("/")
    .map((part) => trimTrailingSlashes(part.trim()))
    .filter(Boolean)
    .join("/");

  return normalized || DEFAULT_VAULT_FILENAME;
}

export function normalizeStoredVaultPath(value: string) {
  return `${VAULT_ROOT_FOLDER}/${normalizeVaultSubpath(value)}`;
}

export function vaultSubpathFromStoredPath(value: string) {
  return normalizeVaultSubpath(value);
}

export function resolveVaultUrl(config: WebDavConfig) {
  const base = new URL(ensureTrailingSlash(config.baseUrl));
  return new URL(normalizeVaultPath(config), base).toString();
}

export function normalizeVaultPath(config: WebDavConfig) {
  return normalizeStoredVaultPath(config.vaultPath || DEFAULT_VAULT_FILENAME);
}

function resolveVaultParentUrls(config: WebDavConfig) {
  const base = new URL(ensureTrailingSlash(config.baseUrl));
  const parts = normalizeVaultPath(config)
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

async function webdavFetch(url: string, init: RequestInit, action: string) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), DEFAULT_WEBDAV_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`WebDAV request timed out after ${DEFAULT_WEBDAV_TIMEOUT_MS}ms during ${action}`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function ensureVaultDirectories(config: WebDavConfig) {
  const parentUrls = resolveVaultParentUrls(config);
  for (const parentUrl of parentUrls) {
    const response = await webdavFetch(
      parentUrl,
      {
      method: "MKCOL",
      headers: requestHeaders(config, "text/plain"),
      },
      `MKCOL ${parentUrl}`,
    );
    if (response.ok || response.status === 405 || response.status === 409) {
      continue;
    }
    throw new Error(`Failed to create WebDAV directory: ${response.status} ${response.statusText}`);
  }
}

export async function loadVaultFile(config: WebDavConfig) {
  const url = resolveVaultUrl(config);
  const response = await webdavFetch(
    url,
    {
      method: "GET",
      headers: requestHeaders(config),
      cache: "no-store",
    },
    `GET ${url}`,
  );
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
  const url = resolveVaultUrl(config);
  const response = await webdavFetch(
    url,
    {
      method: "PUT",
      headers: requestHeaders(config),
      body: encodeJson(file),
    },
    `PUT ${url}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to save vault to WebDAV: ${response.status} ${response.statusText}`);
  }
}

export async function probeVault(config: WebDavConfig) {
  const url = resolveVaultUrl(config);
  const response = await webdavFetch(
    url,
    {
      method: "HEAD",
      headers: requestHeaders(config, "text/plain"),
      cache: "no-store",
    },
    `HEAD ${url}`,
  );
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
