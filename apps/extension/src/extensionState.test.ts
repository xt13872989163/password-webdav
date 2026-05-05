import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVE_PROMPT_WAIT_MS,
  MAX_SAVE_PROMPT_WAIT_MS,
  MIN_SAVE_PROMPT_WAIT_MS,
  normalizeSavePromptWaitMs,
} from "./extensionState";

describe("normalizeSavePromptWaitMs", () => {
  it("uses the default for invalid values", () => {
    expect(normalizeSavePromptWaitMs(undefined)).toBe(DEFAULT_SAVE_PROMPT_WAIT_MS);
    expect(normalizeSavePromptWaitMs("nope")).toBe(DEFAULT_SAVE_PROMPT_WAIT_MS);
  });

  it("clamps the configured wait range", () => {
    expect(normalizeSavePromptWaitMs(500)).toBe(MIN_SAVE_PROMPT_WAIT_MS);
    expect(normalizeSavePromptWaitMs(20000)).toBe(MAX_SAVE_PROMPT_WAIT_MS);
  });

  it("keeps valid millisecond values", () => {
    expect(normalizeSavePromptWaitMs(5000)).toBe(5000);
    expect(normalizeSavePromptWaitMs("3000")).toBe(3000);
  });
});
