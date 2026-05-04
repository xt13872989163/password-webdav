import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadVaultFile,
  normalizeStoredVaultPath,
  normalizeVaultSubpath,
  saveVaultFile,
  vaultSubpathFromStoredPath,
} from "./webdav";
import type { EncryptedVaultFile, WebDavConfig } from "./types";

const config: WebDavConfig = {
  baseUrl: "https://example.com/dav/",
  username: "user",
  password: "pass",
  vaultPath: "passwords/private/password-vault.json",
};

const file: EncryptedVaultFile = {
  schemaVersion: 1,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600000,
    salt: "salt",
  },
  wrappedVaultKey: {
    algorithm: "AES-GCM",
    iv: "iv",
    wrappedKey: "key",
  },
  vault: {
    algorithm: "AES-GCM",
    iv: "iv",
    ciphertext: "cipher",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webdav", () => {
  it("treats missing WebDAV parent paths as an empty vault location", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadVaultFile(config)).resolves.toBeNull();
  });

  it("creates nested vault directories before saving the vault file", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveVaultFile(config, file);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://example.com/dav/PasswordWebDAV/", "MKCOL"],
      ["https://example.com/dav/PasswordWebDAV/passwords/", "MKCOL"],
      ["https://example.com/dav/PasswordWebDAV/passwords/private/", "MKCOL"],
      ["https://example.com/dav/PasswordWebDAV/passwords/private/password-vault.json", "PUT"],
    ]);
  });

  it("keeps PasswordWebDAV as a fixed root folder for all providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveVaultFile(
      {
        baseUrl: "https://dav.jianguoyun.com/dav/",
        username: "user",
        password: "pass",
        vaultPath: "password-vault.json",
      },
      file,
    );

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://dav.jianguoyun.com/dav/PasswordWebDAV/", "MKCOL"],
      ["https://dav.jianguoyun.com/dav/PasswordWebDAV/password-vault.json", "PUT"],
    ]);
  });

  it("normalizes user-entered vault subpaths", () => {
    expect(normalizeVaultSubpath("PasswordWebDAV/work/password-vault.json")).toBe("work/password-vault.json");
    expect(normalizeStoredVaultPath("work/password-vault.json")).toBe("PasswordWebDAV/work/password-vault.json");
    expect(vaultSubpathFromStoredPath("PasswordWebDAV/password-vault.json")).toBe("password-vault.json");
  });
});
