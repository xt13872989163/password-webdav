# Password WebDAV Popup Redesign Design

## Summary

This design updates the Chrome extension UI for `Password WebDAV` so the extension popup behaves like a compact daily-use password tool instead of a mini admin console. The popup remains the primary interface. We are not reintroducing the web app, and we are not switching the main workflow to a side panel in this iteration.

The approved direction is:

- Keep the product as a Chrome extension only
- Keep the main surface as the popup
- Use a compact two-column layout in folder view
- Keep an "all accounts" view for quick browsing
- Add a visible settings entry point
- Allow passwords to stay masked by default and reveal on demand
- Move detailed editing out of the main list view into a settings/detail view

## Goals

- Make the popup feel like a real browser extension rather than a shrunk web page
- Keep the main view optimized for quick browse, fill, copy, save, reveal, and delete actions
- Make folders and subfolders obvious at a glance
- Preserve WebDAV-backed encrypted vault behavior and current session unlock behavior
- Reduce visual and cognitive load in the main UI

## Non-Goals

- Reintroducing the standalone web UI
- Making the Chrome popup manually resizable by dragging
- Moving the primary workflow to `chrome.sidePanel` in this iteration
- Changing the encryption model, WebDAV storage model, or vault file format

## Current Codebase Context

- `apps/extension/src/popup.tsx` currently renders a wide three-pane manager with folder list, entry list, and inline editor
- `apps/extension/src/popup.css` currently styles a desktop-like management layout
- `apps/extension/src/options.tsx` already exists for extension settings
- `apps/extension/src/extensionState.ts` stores config in `chrome.storage.local` and unlocked vault plus session master password in `chrome.storage.session`
- `packages/core/src/folders.ts` already supports normalized folder paths, folder tree matching, and folder deletion that moves entries to uncategorized

The redesign should build on these files instead of inventing a second management surface.

## Information Architecture

### Primary Surface

The primary surface remains the extension popup opened from the Chrome toolbar button.

The popup has two top-level browsing modes:

1. `Folder view`
2. `All accounts view`

### Secondary Surface

The popup gets a dedicated `Settings / Detail` view reachable from a fixed settings button in the popup header.

This secondary view stays inside the popup shell. The existing Chrome `options_page` can remain as a fallback place for global configuration, but it is not the primary daily-use path for this redesign.

This secondary view is where we place:

- WebDAV configuration
- Vault subpath configuration under fixed `PasswordWebDAV/`
- Detailed entry editing
- Tags
- Notes
- Password generation rules or advanced controls if they already exist or are added in the same implementation pass
- Auto-save related controls if already present

The main popup view should no longer show a full-width inline editor panel.

## Popup Layout

### Locked State

The locked state remains simple and form-based:

- WebDAV base URL
- WebDAV username
- WebDAV password or app password
- Vault subpath input under fixed `PasswordWebDAV/`
- Master password
- Unlock or create action
- Status and error feedback

This screen can continue to use the current practical structure, but visual styling should match the more compact plugin look.

### Unlocked State

The unlocked state becomes a compact plugin manager instead of a three-pane workspace.

Header:

- Product title
- View toggle: `Folder view` / `All accounts`
- Fixed `Settings` button

Body:

- Search input
- Main content area based on active view

Footer or status area:

- Small status messages
- Dirty-state messaging when relevant

## Folder View

Folder view uses a compact two-column layout inside the popup.

### Left Column: Folders

The left column shows:

- `All`
- `Uncategorized`
- Folder tree
- Subfolder indentation
- Create folder control

Folder interactions:

- Click to filter current list
- Double-click to rename
- Hover to reveal delete action
- Drag and drop to move a folder into another folder and reparent the folder tree

Folder drag-and-drop must update the moved folder path and all descendant folder paths consistently. Arbitrary sibling sort order remains out of scope.

Deleting a folder keeps the current behavior:

- The folder and its descendants are removed from the explicit folder list
- Entries inside the removed folder tree are moved to uncategorized

### Right Column: Accounts

The right column shows the accounts for the active folder scope.

Each row is compact and includes:

- Drag handle
- Title
- Site or host directly in the title line
- Username on a second line
- Small recency or context chip when useful
- Delete action visible on hover or on the selected row

The main list view stays intentionally lightweight. It should not show the full edit form.

## All Accounts View

The all-accounts view uses the same compact account-row style as the folder view's right column.

Requirements:

- Single list
- No large detail panel
- Keep folder context visible in a small chip or sublabel
- Keep delete available from the list row
- Keep password reveal available from the row

## Password Reveal Interaction

Each account row should support a compact password reveal interaction.

Behavior:

- Default state shows masked password text such as `••••••••••••`
- A `Show` control reveals the plaintext password
- A second click hides it again
- Reveal state is local UI state only and is not persisted
- Revealed values should disappear when switching away, reloading, locking, or collapsing the row

This interaction belongs in the main usage flow, not hidden in advanced settings.

## Entry Actions in Main View

The main popup view should prioritize direct-use actions.

Required actions available from the main view:

- Fill current page
- Copy username
- Copy password
- Reveal or hide password
- Delete account
- Create new account

Editing detailed metadata should move to the settings/detail view instead of living inline in the main list.

## Settings / Detail View

Clicking the header settings button opens a secondary popup view rather than forcing the user to leave the popup context.

This view should include two logical sections:

1. `Vault settings`
2. `Entry details`

### Vault Settings

Vault settings should expose:

- WebDAV base URL
- Username
- Password or app password
- Vault subpath
- Reminder that root path is fixed to `PasswordWebDAV/`
- Lock current session
- Refresh or resync where relevant

### Entry Details

When an entry is selected from the main view, the settings/detail view should allow:

- Edit title
- Edit URL
- Edit username
- Edit password
- Generate password
- Edit folder path
- Edit tags
- Edit notes
- Save
- Delete

If no entry is selected, the entry-details section can show an empty state.

## Suggestions and Assisted Input

When creating or editing an account:

- Title, URL, username, and folder inputs should continue using suggestions from existing vault data
- Suggested usernames for the current host remain supported
- Suggestions should feel automatic rather than hidden behind advanced mode

This preserves the previously approved requirement that input should be assisted by known data where possible.

## Dragging and Moving

The user explicitly requested mouse-driven movement.

Implementation expectations:

- Account rows expose a drag affordance
- Dropping an account onto a folder moves that account into the target folder
- Folder rows expose a drag affordance
- Dropping a folder onto another folder reparents that folder tree by updating folder paths for that subtree and affected entries

Because folder paths are path-based strings, folder moving must normalize and rewrite descendant folder paths consistently.

## Visual Design Rules

- The UI should look compact and calm with a light, slightly technical aesthetic
- It should feel like a browser extension, not a dashboard
- Main surfaces should use small radii, dense spacing, and restrained chrome
- Avoid a right-side large details pane in the main usage view
- Keep row density high enough that folder structure and account lists remain visible without scrolling immediately
- Do not hide the settings entry point

## Behavioral Requirements

- Successful unlock should continue to cache the unlocked vault and master password only for the current browser session
- Saving should not require re-entering the master password during the same session
- WebDAV root remains fixed as `PasswordWebDAV/`
- Only the vault subpath under that root is user-configurable
- Auto-create missing WebDAV directories must continue to work
- Save-detected-login behavior must not regress

## File and Module Impact

Expected primary implementation files:

- `apps/extension/src/popup.tsx`
- `apps/extension/src/popup.css`
- `apps/extension/src/options.tsx` for fallback/global config parity only
- `apps/extension/src/extensionState.ts`
- `packages/core/src/folders.ts`
- `packages/core/src/folders.test.ts`
- `README.md`
- `wiki/Home.md`
- `wiki/Getting-Started.md`
- `wiki/Architecture.md`
- `wiki/FAQ.md`

New components may be introduced if they reduce complexity, but the split should follow clear responsibilities:

- popup shell and mode switching
- folder tree
- account list
- reveal-password row behavior
- popup-local settings/detail view

## Testing Expectations

Testing should cover:

- Folder tree filtering still works
- Account move to folder works
- Folder delete still moves descendants to uncategorized
- Password reveal hides by default and toggles locally
- Main popup remains usable without the old inline editor
- Session unlock still avoids repeated master-password prompts until lock or browser restart

## Risks

### Settings Scope Confusion

The existing codebase already has a Chrome `options_page`, but this redesign chooses the popup-local settings/detail view as the primary path. The Chrome options page may remain for fallback/global config parity, but it must not become the main place where users are expected to manage day-to-day password entries.

### Drag Complexity

Folder path reparenting is more invasive than row-level dragging. The implementation plan should land account dragging before folder dragging so the simpler move flow is stable first.

### Popup Size Constraints

Chrome popup sizing is constrained by the browser. The layout must be compact by design and should not assume user-resizable width.

## Final Approved Scope For This Iteration

This implementation iteration should deliver:

- extension-only experience
- compact popup locked state
- compact popup unlocked state
- folder view with two columns
- all-accounts view
- header settings entry
- password reveal and hide
- lightweight main rows
- detailed editing moved out of the main view
- docs updated to match the new interaction model
