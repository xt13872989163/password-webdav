import { describe, expect, it } from "vitest";
import { createEmptyVault, decryptVault, encryptVault, generatePassword } from "./crypto";

describe("crypto", () => {
  it("round-trips a vault", async () => {
    const vault = createEmptyVault();
    vault.entries.push({
      id: "1",
      title: "GitHub",
      username: "me@example.com",
      password: "secret",
      url: "https://github.com",
      notes: "",
      tags: ["work"],
      createdAt: vault.createdAt,
      updatedAt: vault.updatedAt,
    });

    const file = await encryptVault("master password", vault);
    const decrypted = await decryptVault("master password", file);

    expect(decrypted.entries).toHaveLength(1);
    expect(decrypted.entries[0]?.password).toBe("secret");
  });

  it("generates passwords with a default length", () => {
    expect(generatePassword()).toHaveLength(20);
  });
});

