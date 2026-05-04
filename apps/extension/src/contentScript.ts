import type { VaultEntry } from "@password-webdav/core";

interface DetectedLoginCandidate {
  username: string;
  password: string;
  url: string;
  title: string;
}

let lastCandidate: DetectedLoginCandidate | null = null;
let promptEl: HTMLDivElement | null = null;

function dispatchInputEvents(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function visibleInput(input: HTMLInputElement) {
  return !input.disabled && input.offsetParent !== null;
}

function findPasswordField(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).find(visibleInput) ?? null;
}

function findUsernameField(root: ParentNode = document) {
  const preferred = root.querySelector<HTMLInputElement>(
    'input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[type="email"]',
  );
  if (preferred && visibleInput(preferred)) return preferred;

  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) =>
      visibleInput(input) &&
      input.type !== "password" &&
      input.type !== "hidden" &&
      input.type !== "checkbox" &&
      input.type !== "radio" &&
      input.type !== "submit" &&
      input.type !== "button",
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

function candidateFromPasswordInput(input: HTMLInputElement): DetectedLoginCandidate | null {
  if (!input.value) return null;
  const form = input.form;
  const usernameField = form ? findUsernameField(form) : findUsernameField();
  return {
    username: usernameField?.value || "",
    password: input.value,
    url: location.origin,
    title: document.title || location.hostname,
  };
}

function candidateFromForm(form: HTMLFormElement): DetectedLoginCandidate | null {
  const passwordField = findPasswordField(form);
  if (!passwordField?.value) return null;
  return candidateFromPasswordInput(passwordField);
}

function sendRuntimeMessage<T>(message: unknown) {
  return new Promise<T | undefined>((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(response as T);
    });
  });
}

function rememberCandidate(candidate: DetectedLoginCandidate | null) {
  if (!candidate) return;
  lastCandidate = candidate;
}

async function stageCandidate(candidate: DetectedLoginCandidate | null) {
  rememberCandidate(candidate);
  if (!candidate) return;
  await sendRuntimeMessage({
    type: "password-webdav.stage-detected-login",
    entry: candidate,
  });
}

function removePrompt() {
  promptEl?.remove();
  promptEl = null;
}

function appendText(parent: HTMLElement, text: string) {
  parent.appendChild(document.createTextNode(text));
}

function createButton(label: string, variant: "primary" | "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.height = "34px";
  button.style.borderRadius = "6px";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";

  if (variant === "primary") {
    button.style.flex = "1";
    button.style.border = "0";
    button.style.background = "#0f766e";
    button.style.color = "#fff";
  } else {
    button.style.border = "1px solid #d1d5db";
    button.style.background = "#f8fafc";
    button.style.color = "#111827";
  }

  return button;
}

function showSavePrompt() {
  if (!lastCandidate || promptEl) return;

  promptEl = document.createElement("div");
  promptEl.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "width:320px",
    "padding:14px",
    "border:1px solid #cbd5e1",
    "border-radius:8px",
    "background:#fff",
    "box-shadow:0 18px 50px rgba(15,23,42,.18)",
    "font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "color:#111827",
  ].join(";");

  const title = document.createElement("div");
  title.style.fontWeight = "800";
  title.style.marginBottom = "6px";
  appendText(title, "保存到 Password WebDAV？");

  const account = document.createElement("div");
  account.style.cssText = "font-size:12px;color:#4b5563;margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  appendText(account, lastCandidate.username || location.hostname);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";

  const saveButton = createButton("保存", "primary");
  const dismissButton = createButton("不保存", "secondary");
  actions.append(saveButton, dismissButton);

  const status = document.createElement("div");
  status.style.cssText = "font-size:12px;color:#4b5563;margin-top:8px";

  promptEl.append(title, account, actions, status);

  dismissButton.addEventListener("click", () => {
    void sendRuntimeMessage({ type: "password-webdav.dismiss-detected-login" });
    removePrompt();
  });

  saveButton.addEventListener("click", () => {
    status.textContent = "正在保存...";
    void sendRuntimeMessage<{ ok?: boolean; message?: string }>({
      type: "password-webdav.save-detected-login",
      entry: lastCandidate,
    }).then((response) => {
      status.textContent = response?.message || "已处理。";
      if (response?.ok) {
        setTimeout(removePrompt, 1200);
      }
    });
  });

  document.documentElement.appendChild(promptEl);
}

function showPromptWhenLoginPageDisappears() {
  window.setTimeout(() => {
    if (lastCandidate && !findPasswordField()) {
      showSavePrompt();
    }
  }, 700);
}

function handleLikelySubmit(form: HTMLFormElement | null) {
  if (!form) return;
  void stageCandidate(candidateFromForm(form));
  showPromptWhenLoginPageDisappears();
}

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (form instanceof HTMLFormElement) {
      handleLikelySubmit(form);
    }
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"], input[type="button"]',
    );
    if (!button) return;
    handleLikelySubmit(button.form ?? button.closest("form"));
  },
  true,
);

document.addEventListener(
  "input",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "password") {
      rememberCandidate(candidateFromPasswordInput(target));
    }
  },
  true,
);

document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "password") {
      rememberCandidate(candidateFromPasswordInput(target));
    }
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter") return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const form = target.form;
    if (form) {
      handleLikelySubmit(form);
      return;
    }

    const passwordField = findPasswordField();
    if (passwordField?.value) {
      void stageCandidate(candidateFromPasswordInput(passwordField));
      showPromptWhenLoginPageDisappears();
    }
  },
  true,
);

window.setTimeout(() => {
  void sendRuntimeMessage<{ ok?: boolean; entry?: DetectedLoginCandidate | null }>({
    type: "password-webdav.get-pending-detected-login",
    url: location.href,
  }).then((response) => {
    if (!response?.entry || findPasswordField()) return;
    lastCandidate = response.entry;
    showSavePrompt();
  });
}, 800);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "password-webdav.fill-entry") {
    sendResponse(fillEntry(message.entry as VaultEntry));
    return true;
  }
  return undefined;
});
