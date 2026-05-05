# Password WebDAV Login Automation Design

## Goal

Add a `Login` action to each saved account in the Chrome extension popup. Clicking it should open a new tab to the entry's existing `url`, detect whether the page is already logged in or still at a login flow, and only when the page is clearly a login page should the extension auto-fill credentials and perform a single safe submit.

## Product Decisions

- Login entry point always uses the existing `entry.url`.
- No new `loginUrl` field is added to vault data.
- The login page opens in a new tab.
- Different accounts may log in in parallel.
- The same account must reuse its current active login tab instead of opening duplicates.
- The automation must not retry the same action on the same page.
- If the page becomes uncertain, requires verification, or enters an SSO chooser/consent flow, the task stops and hands control back to the user.

## User Experience

### Popup entry row

- Add a compact `Login` button at the top-right of each account row.
- Default click behavior:
  - if the account has an active login task, switch to that tab
  - otherwise create a new login task and open a new tab

### Row status

Only the affected account row shows transient state:

- `Logging in`
- `Continue`
- `Failed`
- `Entered`

Status meanings:

- `Logging in`: automation is still opening/detecting/filling/submitting
- `Continue`: user action is required in the existing tab
- `Failed`: login flow stayed on a login path and exposed an explicit error
- `Entered`: target page was reached successfully, then clears shortly after

### Continue behavior

If a task is in `manual_required`, clicking the row's login action again must switch to the existing tab instead of creating a new task.

## Scope

### In scope

- Standard single-page login forms
- Clearly separated two-step login flows such as email page then password page
- Already-logged-in detection
- Manual handoff for OTP, captcha, account chooser, consent, or unclear states
- Parallel login tasks for different accounts
- Reuse of an existing active tab for the same account

### Out of scope for v1

- Site-specific SSO adapters
- Full account chooser automation
- Captcha solving
- OTP / MFA completion
- Automatic retries after failure
- New vault schema fields

## Architecture

The feature is split into four layers:

1. `popup.tsx`
   - renders the `Login` button
   - starts tasks by `entryId`
   - displays per-entry task state

2. `background.ts`
   - owns the login task registry and lifecycle
   - opens tabs
   - decides what command a page may execute
   - ensures the same page never receives duplicate submit actions

3. `contentScript.ts`
   - remains the only content script entrypoint
   - bridges page lifecycle events and runtime messages into login automation
   - continues to host existing password save/autofill features

4. `contentLogin.ts`
   - isolates login page classification, field detection, fill, and submit logic
   - contains no popup state and no vault persistence

Shared message and task types live in `loginProtocol.ts`.

## Login Task Model

```ts
type LoginTaskState =
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

type PageClassification =
  | "login_form"
  | "password_only"
  | "already_logged_in"
  | "manual_required"
  | "failed"
  | "unknown";

interface LoginTask {
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
  manualReason?: string;
}
```

Notes:

- The task stores `entryId`, not raw credentials.
- Username/password are fetched from the already unlocked vault only at command dispatch time.
- Tasks live in memory or `chrome.storage.session`, never in vault files.

## Active Task Indexing

`background.ts` keeps two registries:

- `tasksById: Map<string, LoginTask>`
- `activeTaskIdByEntryId: Map<string, string>`

Active states:

- `opening_tab`
- `waiting_page`
- `detecting`
- `filling`
- `submitting`
- `waiting_result`
- `manual_required`

Non-active terminal states:

- `success`
- `failed`
- `cancelled`
- `timeout`

When the popup starts login for an `entryId`:

- if the account has an active task and its tab still exists, focus that tab
- otherwise create a fresh task

## Main Flow

1. User clicks `Login` on an account row.
2. Popup sends `login.start(entryId)` to background.
3. Background either:
   - focuses the existing active tab for that account, or
   - creates a new task and opens a new tab to `entry.url`
4. Content script on that tab handshakes with background.
5. Background marks the task as active for that tab.
6. Content login classifier inspects the page and reports a classification.
7. Background decides:
   - `already_logged_in` -> success
   - `login_form` or `password_only` -> issue one `fill_and_submit` command
   - `manual_required` -> stop and expose `Continue`
   - `failed` -> stop and expose `Failed`
   - `unknown` -> keep waiting for page stabilization until timeout
8. After fill/submit, the content script reports completion once.
9. The background waits for URL/DOM changes and classifies the next page.
10. The task ends in `success`, `manual_required`, `failed`, `cancelled`, or `timeout`.

## No-Retry Rule

The design must avoid automatic retries.

Rules:

- The same page instance may only receive one automated submit.
- A field may only be auto-filled once for that page instance.
- If a submit does not clearly move the flow forward, the extension only observes; it does not click again.
- Two-step login is still supported because each new page is a new state, not a retry.

To enforce this, each classified page gets a stable `pageKey`. Once a `pageKey` has executed `fill_and_submit`, it is recorded in `task.actionPageKeys` and may not execute that action again.

## Page Classification

The content login module should classify the page into one of six states.

### `login_form`

Strong signals:

- exactly one visible password field
- a visible username/email input or a clear username step
- one dominant submit button or form submit path
- login text such as `Sign in`, `Log in`, `Continue`, `Next`

Action:

- fill username/password if available for the current step
- submit once

### `password_only`

Strong signals:

- visible password field
- username already locked in or rendered in the page
- page wording clearly requests password entry

Action:

- fill password
- submit once

### `already_logged_in`

Strong signals:

- no visible password field
- URL or final host is already inside the business app
- business shell is visible, such as nav, avatar, dashboard, workspace, sign-out control

Action:

- mark task `success`

### `manual_required`

Any of the following must immediately stop automation:

- captcha / recaptcha / hcaptcha / verification-code challenge
- OTP / 2FA / MFA / verification code
- account chooser pages
- consent / authorization screens
- risk verification / "verify it's you"
- passkey / WebAuthn prompts
- multiple conflicting candidate forms

Action:

- stop automation
- mark task `manual_required`
- popup displays `Continue`

### `failed`

Must be used only for explicit failures:

- clear wrong-password or invalid-credentials message
- login page remains and exposes a strong error banner
- `aria-invalid` or equivalent error state plus visible failure message
- URL parameters clearly indicating login error

Action:

- mark task `failed`
- popup displays `Failed`

### `unknown`

Signals:

- page still loading or redirecting
- DOM not yet stable
- no clear login or app shell evidence

Action:

- wait for stabilization
- if it never becomes clear before timeout, treat as `manual_required`

### Classification priority

1. `manual_required`
2. `failed`
3. `already_logged_in`
4. `login_form`
5. `password_only`
6. `unknown`

## Communication Protocol

### Popup to background

```ts
{ type: "login.start"; entryId: string }
{ type: "login.status"; taskId: string }
{ type: "login.cancel"; taskId: string }
```

### Content script to background

```ts
{ type: "login.handshake"; url: string }

{
  type: "login.page_state";
  taskId: string;
  pageKey: string;
  url: string;
  classification: PageClassification;
  signals: {
    hasVisiblePassword: boolean;
    hasUsernameField: boolean;
    hasSubmitButton: boolean;
    hasOtp: boolean;
    hasCaptcha: boolean;
    hasAccountChooser: boolean;
  };
}

{
  type: "login.action_done";
  taskId: string;
  pageKey: string;
  action: "fill" | "submit";
  ok: boolean;
  url: string;
  error?: string;
}
```

### Background to content script

```ts
{ type: "login.command"; command: "noop" }

{
  type: "login.command";
  command: "fill_and_submit";
  taskId: string;
  pageKey: string;
  username: string;
  password: string;
}

{ type: "login.command"; command: "finish_success" }

{
  type: "login.command";
  command: "manual_required";
  reason: "otp" | "captcha" | "account_chooser" | "unknown" | "confirm";
}
```

## UI State Mapping

Popup row badge mapping:

- `opening_tab`, `waiting_page`, `detecting`, `filling`, `submitting`, `waiting_result` -> `Logging in`
- `manual_required` -> `Continue`
- `failed` -> `Failed`
- `success` -> `Entered`

Additional behavior:

- clicking `Continue` focuses the existing tab
- clicking `Failed` focuses the failed tab so the user can inspect it
- terminal success status clears after a short delay

## Time Limits

No retries, but still bounded observation:

- total task timeout: 45 seconds
- if page classification never stabilizes, end as `manual_required`
- if the tab closes mid-task, end as `cancelled`

## Files To Change

### Create

- `apps/extension/src/loginProtocol.ts`
- `apps/extension/src/contentLogin.ts`
- `docs/superpowers/specs/2026-05-05-password-webdav-login-automation-design.md`

### Modify

- `apps/extension/src/background.ts`
- `apps/extension/src/contentScript.ts`
- `apps/extension/src/popup.tsx`
- `apps/extension/src/i18n.ts`

### No data model changes

- no vault schema changes
- no `loginUrl`
- no persistent login history for v1

## Implementation Order

1. Add shared types in `loginProtocol.ts`
2. Add task registry and runtime message handling in `background.ts`
3. Add popup login button and per-entry task status UI
4. Add page classifier and action helpers in `contentLogin.ts`
5. Bridge content lifecycle events in `contentScript.ts`
6. Add status strings in `i18n.ts`
7. Validate with real login pages

## Acceptance Criteria

1. Clicking `Login` opens a new tab to `entry.url`.
2. If the account already has an active login task, the extension focuses the existing tab instead of opening another.
3. Standard login pages auto-fill and submit once.
4. Two-step login can advance page by page without repeating the same submit.
5. If the page is already logged in, the task finishes successfully without filling.
6. Captcha/OTP/account chooser/consent flows stop and expose `Continue`.
7. Explicit credential errors surface as `Failed`.
8. Closing the tab marks the task `Cancelled`.
9. Different accounts can have concurrent login tasks.
10. No new vault field is required.
