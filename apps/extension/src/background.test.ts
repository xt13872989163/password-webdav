import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void;

function installChromeStub() {
  const sessionStore: Record<string, unknown> = {};
  const listeners: MessageListener[] = [];
  const event = () => ({ addListener: vi.fn() });
  const chromeStub = {
    action: { setBadgeText: vi.fn().mockResolvedValue(undefined) },
    runtime: {
      onInstalled: event(),
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          listeners.push(listener);
        }),
      },
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}) },
      session: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (typeof keys === "string") return { [keys]: sessionStore[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, sessionStore[key]]));
          }
          return { ...sessionStore };
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionStore, values);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStore[key];
        }),
      },
    },
    tabs: {
      create: vi.fn(),
      get: vi.fn(),
      sendMessage: vi.fn(),
      update: vi.fn(),
      onRemoved: event(),
      onUpdated: event(),
    },
    windows: { update: vi.fn() },
  };
  (globalThis as typeof globalThis & { chrome: typeof chromeStub }).chrome = chromeStub;
  return { chromeStub, listeners, sessionStore };
}

describe("background detected login handling", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Partial<typeof globalThis> & { chrome?: unknown }).chrome;
  });

  it("keeps the full login URL when staging a detected login", async () => {
    const { listeners, sessionStore } = installChromeStub();
    await import("./background");

    const response = await new Promise<{ ok?: boolean }>((resolve) => {
      listeners[0](
        {
          type: "password-webdav.stage-detected-login",
          entry: {
            username: "admin",
            password: "secret-123",
            url: "http://43.162.114.3:40619/de8ae79dac",
            title: "1Panel",
          },
        },
        {},
        (value) => resolve(value as { ok?: boolean }),
      );
    });

    expect(response.ok).toBe(true);
    expect(sessionStore["password-webdav.extension.pendingLogin"]).toEqual(
      expect.objectContaining({
        username: "admin",
        url: "http://43.162.114.3:40619/de8ae79dac",
      }),
    );
  });

  it("uses the current tab URL for origin-only saved login URLs on the same host", async () => {
    const { chromeStub, listeners, sessionStore } = installChromeStub();
    chromeStub.tabs.create.mockResolvedValue({ id: 9 });
    sessionStore["password-webdav.extension.vault"] = {
      version: 1,
      updatedAt: "2026-05-10T00:00:00.000Z",
      folders: [],
      entries: [
        {
          id: "entry-1",
          title: "1Panel",
          username: "admin",
          password: "secret-123",
          url: "http://43.162.114.3:40619/",
          folder: "",
          notes: "",
          tags: [],
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    };
    await import("./background");

    const response = await new Promise<{ ok?: boolean; task?: { targetUrl?: string } }>((resolve) => {
      listeners[0](
        {
          type: "login.start",
          entryId: "entry-1",
          currentUrl: "http://43.162.114.3:40619/de8ae79dac",
        },
        {},
        (value) => resolve(value as { ok?: boolean; task?: { targetUrl?: string } }),
      );
    });

    expect(response.ok).toBe(true);
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({
      url: "http://43.162.114.3:40619/de8ae79dac",
      active: true,
    });
    expect(response.task?.targetUrl).toBe("http://43.162.114.3:40619/de8ae79dac");
  });

  it("treats the same origin and username as already saved", async () => {
    const { listeners, sessionStore } = installChromeStub();
    sessionStore["password-webdav.extension.vault"] = {
      version: 1,
      updatedAt: "2026-05-10T00:00:00.000Z",
      folders: ["servers"],
      entries: [
        {
          id: "entry-1",
          title: "1Panel",
          username: "admin",
          password: "secret-123",
          url: "http://43.162.114.3:40619/",
          folder: "servers",
          notes: "",
          tags: [],
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    };
    await import("./background");

    const response = await new Promise<{ alreadySaved?: boolean; defaultFolder?: string; defaultTitle?: string }>(
      (resolve) => {
        listeners[0](
          {
            type: "password-webdav.get-detected-login-folder-options",
            entry: {
              username: "admin",
              password: "secret-123",
              url: "http://43.162.114.3:40619/de8ae79dac",
              title: "1Panel Login",
            },
          },
          {},
          (value) => resolve(value as { alreadySaved?: boolean; defaultFolder?: string; defaultTitle?: string }),
        );
      },
    );

    expect(response.alreadySaved).toBe(true);
    expect(response.defaultFolder).toBe("servers");
    expect(response.defaultTitle).toBe("1Panel");
  });

  it("still prompts when the saved password changed on the same origin and username", async () => {
    const { listeners, sessionStore } = installChromeStub();
    sessionStore["password-webdav.extension.vault"] = {
      version: 1,
      updatedAt: "2026-05-10T00:00:00.000Z",
      folders: [],
      entries: [
        {
          id: "entry-1",
          title: "1Panel",
          username: "admin",
          password: "old-secret",
          url: "http://43.162.114.3:40619/",
          folder: "",
          notes: "",
          tags: [],
          createdAt: "2026-05-10T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    };
    await import("./background");

    const response = await new Promise<{ alreadySaved?: boolean }>((resolve) => {
      listeners[0](
        {
          type: "password-webdav.get-detected-login-folder-options",
          entry: {
            username: "admin",
            password: "new-secret",
            url: "http://43.162.114.3:40619/de8ae79dac",
            title: "1Panel",
          },
        },
        {},
        (value) => resolve(value as { alreadySaved?: boolean }),
      );
    });

    expect(response.alreadySaved).toBe(false);
  });
});
