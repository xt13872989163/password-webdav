import type { PageClassification } from "./loginProtocol";

export interface PageSignals {
  url: string;
  title: string;
  hasVisiblePassword: boolean;
  visiblePasswordCount: number;
  hasVisibleUsernameField: boolean;
  visibleSubmitCount: number;
  hasCaptcha: boolean;
  hasOtp: boolean;
  hasAccountChooser: boolean;
  hasConsentScreen: boolean;
  hasBusinessShell: boolean;
  hasErrorText: boolean;
  errorText?: string;
}

export interface PageInspection {
  classification: PageClassification;
  signals: PageSignals;
}

export interface LoginFieldTargets {
  username: HTMLInputElement | null;
  password: HTMLInputElement | null;
  submit: HTMLButtonElement | HTMLInputElement | null;
  form: HTMLFormElement | null;
}

const LOGIN_TEXT_RE = /\b(sign in|log in|login|continue|next)\b|登录/i;
const PASSWORD_STEP_RE = /\b(password|enter your password)\b|密码/i;
const CAPTCHA_RE = /\b(captcha|recaptcha|hcaptcha)\b|验证码/i;
const OTP_RE = /\b(otp|2fa|mfa|verification code|one-time code|authenticator)\b|短信验证码|邮箱验证码/i;
const ACCOUNT_CHOOSER_RE = /\b(choose an account|select an account|pick an account)\b|选择账号/i;
const CONSENT_RE = /\b(allow|authorize|consent|approve|grant access)\b|授权|批准/i;
const VERIFY_RE = /\b(verify it's you|verify your identity|security check|passkey)\b|安全验证|确认是你本人/i;
const ERROR_RE =
  /\b(incorrect password|wrong password|invalid credentials|login failed|sign in failed|try again)\b|账号或密码错误|用户名或密码错误|登录失败/i;
const LOGGED_IN_TEXT_RE = /\b(log out|logout|sign out|dashboard|workspace|projects|settings|profile)\b|退出登录|工作台|控制台/i;

function normalizedText(root: ParentNode = document) {
  const body = root instanceof Document ? root.body : root;
  return (body?.textContent || "").replace(/\s+/g, " ").trim();
}

function isProbablyVisible(element: Element | null) {
  if (!element) return false;
  if (element.hasAttribute("hidden")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const html = element as HTMLElement;
  const style = html.style;
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  return true;
}

function visibleInputs(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input")).filter((input) => {
    if (!isProbablyVisible(input)) return false;
    const type = input.type.toLowerCase();
    return type !== "hidden" && !input.disabled && !input.readOnly;
  });
}

function visiblePasswordFields(root: ParentNode = document) {
  return visibleInputs(root).filter((input) => input.type.toLowerCase() === "password");
}

function visibleUsernameFields(root: ParentNode = document) {
  return visibleInputs(root).filter((input) => {
    const type = input.type.toLowerCase();
    if (type === "password" || type === "search" || type === "number") return false;
    const autocomplete = input.getAttribute("autocomplete")?.toLowerCase() || "";
    const hint = `${input.name} ${input.id} ${input.placeholder}`.toLowerCase();
    return (
      autocomplete.includes("username") ||
      autocomplete.includes("email") ||
      type === "email" ||
      /user(name)?|login|account|email|mail|identifier|phone|mobile|账号|用户|邮箱|手机/.test(hint)
    );
  });
}

function visibleSubmitButtons(root: ParentNode = document) {
  return Array.from(
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"], input[type="button"]',
    ),
  ).filter((button) => {
    if (!isProbablyVisible(button) || button.disabled) return false;
    const text = button instanceof HTMLInputElement ? button.value : button.textContent || "";
    return LOGIN_TEXT_RE.test(text) || button.getAttribute("type") === "submit";
  });
}

function findErrorText(root: ParentNode = document) {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('[role="alert"], [aria-live], .error, .alert, .message, .flash-error'),
  )
    .filter(isProbablyVisible)
    .map((element) => element.textContent?.trim() || "")
    .filter(Boolean);
  const matched = candidates.find((value) => ERROR_RE.test(value));
  return matched || "";
}

function hasBusinessShell(root: ParentNode = document) {
  const navigation = root.querySelector("nav, aside, [role='navigation'], header");
  const text = normalizedText(root);
  const logoutLink = root.querySelector('a[href*="logout" i], a[href*="signout" i], button[aria-label*="logout" i]');
  return Boolean((navigation && isProbablyVisible(navigation)) || logoutLink || LOGGED_IN_TEXT_RE.test(text));
}

function currentUrl() {
  return `${location.host}${location.pathname}`;
}

function usesAuthPath() {
  return /\/(login|signin|sign-in|auth|account|session)/i.test(location.pathname);
}

function collectPageSignals(root: ParentNode = document): PageSignals {
  const text = normalizedText(root);
  const passwordFields = visiblePasswordFields(root);
  const usernameFields = visibleUsernameFields(root);
  const submitButtons = visibleSubmitButtons(root);
  const iframeSources = Array.from(root.querySelectorAll("iframe"))
    .map((frame) => frame.getAttribute("src") || "")
    .join(" ");
  const errorText = findErrorText(root);

  return {
    url: location.href,
    title: document.title || "",
    hasVisiblePassword: passwordFields.length > 0,
    visiblePasswordCount: passwordFields.length,
    hasVisibleUsernameField: usernameFields.length > 0,
    visibleSubmitCount: submitButtons.length,
    hasCaptcha: CAPTCHA_RE.test(text) || CAPTCHA_RE.test(iframeSources),
    hasOtp: OTP_RE.test(text),
    hasAccountChooser: ACCOUNT_CHOOSER_RE.test(text),
    hasConsentScreen: CONSENT_RE.test(text) || VERIFY_RE.test(text),
    hasBusinessShell: hasBusinessShell(root),
    hasErrorText: Boolean(errorText),
    errorText: errorText || undefined,
  };
}

export function classifyPageSignals(signals: PageSignals): PageClassification {
  if (signals.hasCaptcha || signals.hasOtp || signals.hasAccountChooser || signals.hasConsentScreen) {
    return "manual_required";
  }
  if (signals.hasErrorText) {
    return "failed";
  }
  if (!signals.hasVisiblePassword && (signals.hasBusinessShell || !usesAuthPath())) {
    return "already_logged_in";
  }
  if (signals.hasVisiblePassword && signals.hasVisibleUsernameField && signals.visibleSubmitCount > 0) {
    return "login_form";
  }
  if (signals.hasVisiblePassword && PASSWORD_STEP_RE.test(`${signals.title} ${signals.url}`)) {
    return "password_only";
  }
  if (signals.hasVisiblePassword && !signals.hasVisibleUsernameField && signals.visibleSubmitCount > 0) {
    return "password_only";
  }
  if (!signals.hasVisiblePassword && signals.visibleSubmitCount > 0 && LOGIN_TEXT_RE.test(signals.title)) {
    return "login_form";
  }
  return "unknown";
}

export function buildPageKey(root: ParentNode = document) {
  const forms = root.querySelectorAll("form").length;
  const passwords = root.querySelectorAll('input[type="password"]').length;
  return `${currentUrl()}|${forms}|${passwords}`;
}

export function classifyCurrentPage(root: ParentNode = document): PageInspection {
  const signals = collectPageSignals(root);
  return {
    classification: classifyPageSignals(signals),
    signals,
  };
}

export function findPrimaryLoginFields(root: ParentNode = document): LoginFieldTargets | null {
  const password = visiblePasswordFields(root)[0] ?? null;
  const username = visibleUsernameFields(root)[0] ?? null;
  const submit = visibleSubmitButtons(root)[0] ?? null;
  const form = password?.form ?? username?.form ?? submit?.form ?? root.querySelector("form");
  if (!password && !username && !submit && !form) return null;
  return {
    username,
    password,
    submit,
    form: form instanceof HTMLFormElement ? form : null,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillLoginFields(username: string, password: string, root: ParentNode = document) {
  const targets = findPrimaryLoginFields(root);
  if (!targets) return false;
  if (targets.username && username) {
    setInputValue(targets.username, username);
  }
  if (targets.password) {
    setInputValue(targets.password, password);
  }
  return Boolean(targets.password || targets.username);
}

export function submitPrimaryLogin(root: ParentNode = document) {
  const targets = findPrimaryLoginFields(root);
  if (!targets) return false;
  if (targets.submit) {
    targets.submit.click();
    return true;
  }
  if (targets.form?.requestSubmit) {
    targets.form.requestSubmit();
    return true;
  }
  if (targets.form) {
    targets.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return true;
  }
  return false;
}
