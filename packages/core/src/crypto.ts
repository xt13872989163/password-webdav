import type {
  EncryptedVaultData,
  EncryptedVaultFile,
  KdfParams,
  PlainVault,
  WrappedVaultKey,
} from "./types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const DEFAULT_KDF_ITERATIONS = 600_000;
export const VAULT_SCHEMA_VERSION = 1 as const;

function ensureCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is unavailable in this environment.");
  }
  return globalThis.crypto;
}

export function nowIso() {
  return new Date().toISOString();
}

export function uuid() {
  return ensureCrypto().randomUUID();
}

export function createEmptyVault(): PlainVault {
  const now = nowIso();
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
}

export function generatePassword(length = 20) {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+";
  const bytes = ensureCrypto().getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function utf8ToBytes(value: string) {
  return textEncoder.encode(value);
}

function bytesToUtf8(bytes: Uint8Array) {
  return textDecoder.decode(bytes);
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

export function createKdfParams(
  salt: Uint8Array = ensureCrypto().getRandomValues(new Uint8Array(16)),
  iterations = DEFAULT_KDF_ITERATIONS,
): KdfParams {
  return {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations,
    salt: bytesToBase64(salt),
  };
}

async function deriveWrappingKey(masterPassword: string, kdf: KdfParams) {
  const crypto = ensureCrypto();
  const material = await crypto.subtle.importKey(
    "raw",
    utf8ToBytes(masterPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(kdf.salt),
      iterations: kdf.iterations,
      hash: kdf.hash,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importVaultKey(rawKey: Uint8Array) {
  const crypto = ensureCrypto();
  return crypto.subtle.importKey("raw", toArrayBuffer(rawKey), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function wrapVaultKey(masterPassword: string, vaultKey: Uint8Array, kdf: KdfParams) {
  const crypto = ensureCrypto();
  const wrappingKey = await deriveWrappingKey(masterPassword, kdf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, toArrayBuffer(vaultKey));
  const result: WrappedVaultKey = {
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    wrappedKey: bytesToBase64(new Uint8Array(wrapped)),
  };
  return result;
}

async function unwrapVaultKey(masterPassword: string, wrapped: WrappedVaultKey, kdf: KdfParams) {
  const crypto = ensureCrypto();
  const wrappingKey = await deriveWrappingKey(masterPassword, kdf);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(wrapped.iv),
    },
    wrappingKey,
    toArrayBuffer(base64ToBytes(wrapped.wrappedKey)),
  );
  return new Uint8Array(plain);
}

async function encryptVaultData(vault: PlainVault, vaultKey: Uint8Array) {
  const crypto = ensureCrypto();
  const key = await importVaultKey(vaultKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8ToBytes(JSON.stringify(vault));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const result: EncryptedVaultData = {
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return result;
}

async function decryptVaultData(vault: EncryptedVaultData, vaultKey: Uint8Array) {
  const key = await importVaultKey(vaultKey);
  const plain = await ensureCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(vault.iv) },
    key,
    base64ToBytes(vault.ciphertext),
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plain))) as PlainVault;
}

export async function encryptVault(masterPassword: string, vault: PlainVault, createdAt = nowIso()) {
  const crypto = ensureCrypto();
  const vaultKey = crypto.getRandomValues(new Uint8Array(32));
  const kdf = createKdfParams();
  const wrappedVaultKey = await wrapVaultKey(masterPassword, vaultKey, kdf);
  const vaultData = await encryptVaultData(
    {
      ...vault,
      updatedAt: nowIso(),
      createdAt: vault.createdAt || createdAt,
    },
    vaultKey,
  );
  const file: EncryptedVaultFile = {
    schemaVersion: VAULT_SCHEMA_VERSION,
    createdAt: vault.createdAt || createdAt,
    updatedAt: nowIso(),
    kdf,
    wrappedVaultKey,
    vault: vaultData,
  };
  return file;
}

export async function decryptVault(masterPassword: string, file: EncryptedVaultFile) {
  const vaultKey = await unwrapVaultKey(masterPassword, file.wrappedVaultKey, file.kdf);
  return decryptVaultData(file.vault, vaultKey);
}

export function encodeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function decodeEncryptedVaultFile(raw: string) {
  return JSON.parse(raw) as EncryptedVaultFile;
}
