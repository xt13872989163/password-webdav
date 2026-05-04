import { describe, expect, it } from "vitest";
import { createEmptyVault } from "./crypto";
import {
  entryFolder,
  entryMatchesFolder,
  entryMatchesFolderTree,
  folderAncestors,
  mergeVaultFolders,
  normalizeFolderPath,
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
});
