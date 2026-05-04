import { describe, expect, it } from "vitest";
import { entryMatchesHost, extractHost, sortEntriesForHost } from "./domain";
import type { VaultEntry } from "./types";

const baseEntry: VaultEntry = {
  id: "1",
  title: "GitHub",
  username: "me@example.com",
  password: "secret",
  url: "https://github.com",
  notes: "",
  tags: ["work"],
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
};

describe("domain matching", () => {
  it("extracts a host from a URL", () => {
    expect(extractHost("https://accounts.github.com/login")).toBe("accounts.github.com");
  });

  it("matches exact and parent domains", () => {
    expect(entryMatchesHost(baseEntry, "github.com")).toBe(true);
    expect(entryMatchesHost(baseEntry, "docs.github.com")).toBe(true);
  });

  it("sorts the best match first", () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, id: "2", title: "Docs", url: "https://example.com", tags: [] },
      { ...baseEntry },
    ];

    expect(sortEntriesForHost(entries, "github.com")[0]?.id).toBe("1");
  });
});
