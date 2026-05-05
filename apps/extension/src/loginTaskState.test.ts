import { describe, expect, it } from "vitest";
import {
  appendActionPageKey,
  canReuseTaskForEntry,
  isActiveLoginTaskState,
  shouldAllowPageAction,
} from "./loginTaskState";
import type { LoginTask } from "./loginProtocol";

function makeTask(overrides: Partial<LoginTask> = {}): LoginTask {
  return {
    taskId: "task-1",
    entryId: "entry-1",
    targetUrl: "https://github.com/login",
    expectedHost: "github.com",
    state: "detecting",
    startedAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    submitCount: 0,
    actionPageKeys: [],
    ...overrides,
  };
}

describe("loginTaskState", () => {
  it("treats manual_required as active for same-entry tab reuse", () => {
    expect(isActiveLoginTaskState("manual_required")).toBe(true);
    expect(canReuseTaskForEntry(makeTask({ state: "manual_required", tabId: 7 }))).toBe(true);
  });

  it("does not treat failed tasks as reusable", () => {
    expect(isActiveLoginTaskState("failed")).toBe(false);
    expect(canReuseTaskForEntry(makeTask({ state: "failed", tabId: 7 }))).toBe(false);
  });

  it("allows a page action only once per pageKey", () => {
    const task = makeTask();
    expect(shouldAllowPageAction(task, "github|login|1")).toBe(true);
    const next = appendActionPageKey(task, "github|login|1");
    expect(shouldAllowPageAction(next, "github|login|1")).toBe(false);
  });
});
