import { describe, expect, it } from "vitest";
import { createEmptyVault } from "./crypto";
import {
  entryFolder,
  entryMatchesFolder,
  entryMatchesFolderTree,
  folderAncestors,
  mergeVaultFolders,
  normalizeFolderPath,
  moveEntryToFolder,
  moveVaultFolder,
  renameVaultFolder,
  removeVaultFolder,
} from "./folders";
import type { VaultEntry } from "./types";

const baseEntry: VaultEntry = {
  id: "1",
  title: "GitHub",
  username: "user@example.com",
  password: "secret",
  url: "https://github.com",
  folder: "Work/Accounts",
  notes: "",
  tags: ["work"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("folders", () => {
  it("normalizes folder paths", () => {
    expect(normalizeFolderPath(" /Work//Accounts/ ")).toBe("Work/Accounts");
  });

  it("builds ancestor folders", () => {
    expect(folderAncestors("Work/Accounts/Email")).toEqual(["Work", "Work/Accounts", "Work/Accounts/Email"]);
  });

  it("merges vault folders", () => {
    const vault = createEmptyVault();
    expect(mergeVaultFolders(vault, ["Work/Accounts"])).toEqual(["Work", "Work/Accounts"]);
  });

  it("matches entry folder exactly", () => {
    expect(entryFolder(baseEntry)).toBe("Work/Accounts");
    expect(entryMatchesFolder(baseEntry, "Work/Accounts")).toBe(true);
    expect(entryMatchesFolder(baseEntry, "Work")).toBe(false);
  });

  it("matches entries inside a folder tree", () => {
    expect(entryMatchesFolderTree(baseEntry, "Work")).toBe(true);
    expect(entryMatchesFolderTree(baseEntry, "Personal")).toBe(false);
  });

  it("removes a folder tree and moves entries to uncategorized", () => {
    const vault = createEmptyVault();
    vault.folders = ["Work", "Work/Accounts", "Personal"];
    vault.entries = [
      baseEntry,
      { ...baseEntry, id: "2", folder: "Personal", title: "Mail" },
    ];

    const nextVault = removeVaultFolder(vault, "Work");

    expect(nextVault.folders).toEqual(["Personal"]);
    expect(nextVault.entries[0]?.folder).toBe("");
    expect(nextVault.entries[1]?.folder).toBe("Personal");
  });

  it("moves an entry into a different folder", () => {
    const vault = createEmptyVault();
    vault.entries = [baseEntry];

    const nextVault = moveEntryToFolder(vault, "1", "Teams/GitHub");

    expect(nextVault.entries[0]?.folder).toBe("Teams/GitHub");
    expect(nextVault.folders).toEqual(["Teams", "Teams/GitHub"]);
  });

  it("moves a folder tree under a new parent", () => {
    const vault = createEmptyVault();
    vault.folders = ["Work", "Work/Accounts", "Work/Accounts/Email", "Personal"];
    vault.entries = [baseEntry, { ...baseEntry, id: "2", folder: "Work/Accounts/Email", title: "Mail" }];

    const nextVault = moveVaultFolder(vault, "Work/Accounts", "Teams");

    expect(nextVault.folders).toEqual(["Personal", "Teams", "Teams/Accounts", "Teams/Accounts/Email", "Work"]);
    expect(nextVault.entries[0]?.folder).toBe("Teams/Accounts");
    expect(nextVault.entries[1]?.folder).toBe("Teams/Accounts/Email");
  });

  it("renames a folder tree leaf", () => {
    const vault = createEmptyVault();
    vault.folders = ["Work", "Work/Accounts", "Work/Accounts/Email"];

    const nextVault = renameVaultFolder(vault, "Work/Accounts", "Projects");

    expect(nextVault.folders).toEqual(["Work", "Work/Projects", "Work/Projects/Email"]);
  });
});
