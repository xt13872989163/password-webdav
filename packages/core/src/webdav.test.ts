import { afterEach, describe, expect, it, vi } from "vitest";
import { saveVaultFile } from "./webdav";
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
  it("creates nested vault directories before saving the vault file", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: "Created",
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveVaultFile(config, file);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://example.com/dav/passwords/", "MKCOL"],
      ["https://example.com/dav/passwords/private/", "MKCOL"],
      ["https://example.com/dav/passwords/private/password-vault.json", "PUT"],
    ]);
  });
});
