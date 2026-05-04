import type { VaultEntry } from "@password-webdav/core";

function dispatchInputEvents(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findPasswordField() {
  return document.querySelector<HTMLInputElement>('input[type="password"]');
}

function findUsernameField() {
  const preferred = document.querySelector<HTMLInputElement>(
    'input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[type="email"]',
  );
  if (preferred) return preferred;
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) => input.type !== "password" && !input.disabled && input.offsetParent !== null,
  );
  return inputs[0] ?? null;
}

function fillEntry(entry: VaultEntry) {
  const passwordField = findPasswordField();
  if (!passwordField) {
    return { ok: false, message: "未找到密码输入框。" };
  }

  const usernameField = findUsernameField();
  if (usernameField && entry.username) {
    dispatchInputEvents(usernameField, entry.username);
  }
  dispatchInputEvents(passwordField, entry.password);
  passwordField.focus();
  passwordField.select();
  return { ok: true, message: "已填充密码。", filledUsername: Boolean(usernameField && entry.username) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "password-webdav.fill-entry") {
    sendResponse(fillEntry(message.entry as VaultEntry));
    return true;
  }
  return undefined;
});

