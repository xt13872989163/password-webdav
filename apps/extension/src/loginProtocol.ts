export type LoginTaskState =
  | "created"
  | "opening_tab"
  | "waiting_page"
  | "detecting"
  | "filling"
  | "submitting"
  | "waiting_result"
  | "success"
  | "manual_required"
  | "failed"
  | "cancelled"
  | "timeout";

export type PageClassification =
  | "login_form"
  | "password_only"
  | "already_logged_in"
  | "manual_required"
  | "failed"
  | "unknown";

export type ManualReason = "otp" | "captcha" | "account_chooser" | "unknown" | "confirm";

export type LoginRowStatus = "logging_in" | "continue" | "failed" | "entered";

export interface LoginTask {
  taskId: string;
  entryId: string;
  tabId?: number;
  targetUrl: string;
  expectedHost: string;
  state: LoginTaskState;
  startedAt: string;
  updatedAt: string;
  lastUrl?: string;
  lastClassification?: PageClassification;
  submitCount: number;
  actionPageKeys: string[];
  lastError?: string;
  manualReason?: ManualReason;
}

export interface LoginPageSignals {
  url: string;
  title: string;
  hasVisiblePassword: boolean;
  visiblePasswordCount: number;
  hasVisibleUsernameField: boolean;
  visibleSubmitCount: number;
  hasOtp: boolean;
  hasCaptcha: boolean;
  hasAccountChooser: boolean;
  hasConsentScreen: boolean;
  hasBusinessShell: boolean;
  hasErrorText: boolean;
  errorText?: string;
}

export type LoginStartMessage = {
  type: "login.start";
  entryId: string;
};

export type LoginStatusMessage = {
  type: "login.status";
  taskId: string;
};

export type LoginCancelMessage = {
  type: "login.cancel";
  taskId: string;
};

export type LoginSnapshotMessage = {
  type: "login.snapshot";
  entryIds?: string[];
};

export type LoginHandshakeMessage = {
  type: "login.handshake";
  url: string;
};

export type LoginPageStateMessage = {
  type: "login.page_state";
  taskId: string;
  pageKey: string;
  url: string;
  classification: PageClassification;
  signals: LoginPageSignals;
};

export type LoginActionDoneMessage = {
  type: "login.action_done";
  taskId: string;
  pageKey: string;
  action: "fill" | "submit";
  ok: boolean;
  url: string;
  error?: string;
};

export type LoginCommand =
  | { type: "login.command"; command: "noop" }
  | {
      type: "login.command";
      command: "fill_and_submit";
      taskId: string;
      pageKey: string;
      username: string;
      password: string;
    }
  | { type: "login.command"; command: "finish_success" }
  | {
      type: "login.command";
      command: "manual_required";
      reason: ManualReason;
    };

export type LoginMessage =
  | LoginStartMessage
  | LoginStatusMessage
  | LoginCancelMessage
  | LoginSnapshotMessage
  | LoginHandshakeMessage
  | LoginPageStateMessage
  | LoginActionDoneMessage;

export function mapLoginTaskStateToRowStatus(state: LoginTaskState): LoginRowStatus | null {
  if (
    state === "opening_tab" ||
    state === "waiting_page" ||
    state === "detecting" ||
    state === "filling" ||
    state === "submitting" ||
    state === "waiting_result"
  ) {
    return "logging_in";
  }
  if (state === "manual_required") return "continue";
  if (state === "failed") return "failed";
  if (state === "success") return "entered";
  return null;
}
