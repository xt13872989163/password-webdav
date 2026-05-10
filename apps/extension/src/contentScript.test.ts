// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChromeStub = {
  runtime: {
    lastError?: unknown;
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: { addListener: ReturnType<typeof vi.fn> };
  };
  storage: {
    local: { get: ReturnType<typeof vi.fn> };
    onChanged: { addListener: ReturnType<typeof vi.fn> };
  };
};

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

function installChromeStub() {
  const messages: unknown[] = [];
  const chromeStub: ChromeStub = {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn((message: unknown, callback?: (response: unknown) => void) => {
        messages.push(message);
        callback?.({ ok: true, entry: null });
      }),
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}) },
      onChanged: { addListener: vi.fn() },
    },
  };
  (globalThis as typeof globalThis & { chrome: ChromeStub }).chrome = chromeStub;
  return messages;
}

describe("contentScript login detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = "";
    history.replaceState({}, "", "/login");
    document.title = "1Panel";
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return document.body;
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    if (originalOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
    }
    delete (globalThis as Partial<typeof globalThis> & { chrome?: unknown }).chrome;
  });

  it("stages credentials when a JavaScript login button is clicked outside a native form", async () => {
    const messages = installChromeStub();
    await import("./contentScript");
    document.body.innerHTML = `
      <div class="el-form">
        <div class="el-form-item">
          <input type="text" autocomplete="username" placeholder="用户名" value="admin" />
        </div>
        <div class="el-form-item">
          <input type="password" autocomplete="current-password" placeholder="密码" value="secret-123" />
        </div>
        <button type="button">登录</button>
      </div>
    `;

    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(6000);

    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "password-webdav.stage-detected-login",
        entry: expect.objectContaining({
          username: "admin",
          password: "secret-123",
        }),
      }),
    );
  });

  it("does not stage credentials for a non-login JavaScript button", async () => {
    const messages = installChromeStub();
    await import("./contentScript");
    document.body.innerHTML = `
      <form>
        <input type="text" placeholder="用户名" value="admin" />
        <input type="password" placeholder="密码" value="secret-123" />
        <button type="button">保存设置</button>
      </form>
    `;

    document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(6000);

    expect(messages).not.toContainEqual(
      expect.objectContaining({
        type: "password-webdav.stage-detected-login",
      }),
    );
  });
});
