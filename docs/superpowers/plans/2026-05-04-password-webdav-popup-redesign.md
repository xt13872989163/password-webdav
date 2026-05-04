# Password WebDAV Popup Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扩展 popup 改成紧凑的双视图密码工具，支持设置 / 详情视图、密码显示 / 隐藏，以及条目 / 文件夹拖拽移动。

**Architecture:** 保留现有扩展和 WebDAV / 加密模型，只重构 `popup.tsx` 和 `popup.css` 的交互结构。主界面改成“文件夹视图 / 全部账号视图 + popup 内设置视图”，同时在 `packages/core/src/folders.ts` 增加路径移动能力，测试补到 core 层，文档同步改成新的使用方式。

**Tech Stack:** TypeScript, React, Vite, Chrome Extension MV3, Vitest.

---

### Task 1: 扩展 core 文件夹移动能力

**Files:**
- Modify: `packages/core/src/folders.ts`
- Modify: `packages/core/src/folders.test.ts`
- Test: `packages/core/src/folders.test.ts`

- [ ] **Step 1: 先补失败测试，覆盖账号移动和文件夹重挂载**

```ts
it("moves an entry into a target folder", () => {
  const nextVault = moveEntryToFolder(vault, "1", "Work/Git");
  expect(nextVault.entries[0]?.folder).toBe("Work/Git");
});

it("reparents a folder tree and rewrites descendants", () => {
  const nextVault = moveVaultFolder(vault, "Work/Accounts", "Teams");
  expect(nextVault.folders).toContain("Teams/Accounts");
  expect(nextVault.entries[0]?.folder).toBe("Teams/Accounts");
});
```

- [ ] **Step 2: 跑 core 测试确认当前失败**

Run: `npm --workspace @password-webdav/core run test -- folders`

- [ ] **Step 3: 在 `folders.ts` 增加移动 helper**

```ts
export function moveEntryToFolder(vault: PlainVault, entryId: string, folder: string) {
  // 更新单个 entry.folder，并合并祖先 folders
}

export function moveVaultFolder(vault: PlainVault, source: string, targetParent: string) {
  // 计算新的前缀，重写 folders 和 entries
}
```

- [ ] **Step 4: 再跑 core 测试确认通过**

Run: `npm --workspace @password-webdav/core run test -- folders`

### Task 2: 重构 popup 结构

**Files:**
- Modify: `apps/extension/src/popup.tsx`
- Modify: `apps/extension/src/popup.css`

- [ ] **Step 1: 先把 popup 状态模型改成三种主视图**

```ts
type PopupView = "folders" | "all" | "settings";

const [view, setView] = useState<PopupView>("folders");
const [revealedEntryId, setRevealedEntryId] = useState<string | null>(null);
const [detailDraft, setDetailDraft] = useState<VaultEntry | null>(null);
```

- [ ] **Step 2: 删除旧的三栏工作台结构，改成紧凑 popup 布局**

```tsx
{view === "folders" && <FolderView ... />}
{view === "all" && <AllEntriesView ... />}
{view === "settings" && <SettingsDetailView ... />}
```

- [ ] **Step 3: 在主列表里补直接动作**

```tsx
<button onClick={() => toggleReveal(entry.id)}>
  {revealedEntryId === entry.id ? "隐藏" : "显示"}
</button>
<button onClick={() => void handleFill(entry)}>填充</button>
<button onClick={() => void copyToClipboard(entry.username, "用户名")}>复制账号</button>
<button onClick={() => void copyToClipboard(entry.password, "密码")}>复制密码</button>
```

- [ ] **Step 4: 在设置视图中承接详细编辑**

```tsx
<input value={draft.title} ... />
<input value={draft.url} ... />
<input type="password" value={draft.password} ... />
<textarea value={draft.notes} ... />
```

### Task 3: 接入拖拽移动

**Files:**
- Modify: `apps/extension/src/popup.tsx`
- Modify: `apps/extension/src/popup.css`

- [ ] **Step 1: 先接 entry -> folder 拖拽**

```tsx
draggable
onDragStart={() => setDraggedItem({ type: "entry", id: entry.id })}
onDrop={() => handleDropOnFolder(folder)}
```

- [ ] **Step 2: 再接 folder -> folder 拖拽**

```tsx
onDragStart={() => setDraggedItem({ type: "folder", path: folder })}
onDrop={() => handleFolderDrop(folder)}
```

- [ ] **Step 3: 给拖拽目标和悬停状态补样式**

```css
.drop-target { outline: 1px solid #0f766e; }
.drag-handle { cursor: grab; }
```

### Task 4: 同步文档并验证

**Files:**
- Modify: `README.md`
- Modify: `wiki/Home.md`
- Modify: `wiki/Getting-Started.md`
- Modify: `wiki/Architecture.md`
- Modify: `wiki/FAQ.md`

- [ ] **Step 1: 文档改成 popup 双视图 + 设置详情视图**
- [ ] **Step 2: 说明密码显示 / 隐藏、拖拽移动和固定 `PasswordWebDAV/` 根目录**
- [ ] **Step 3: 跑测试**

Run: `npm run test --workspaces`

- [ ] **Step 4: 跑构建**

Run: `npm run build --workspaces`
