import type { ExtensionLanguage, ExtensionTheme } from "./extensionState";

type MessageSet = {
  all: string;
  uncategorized: string;
  newEntry: string;
  unnamed: string;
  noUrl: string;
  noAccount: string;
  account: string;
  url: string;
  password: string;
  tag: string;
  folder: string;
  settings: string;
  details: string;
  currentPassword: string;
  selectEntryHint: string;
  currentPageNoHost: string;
  folders: string;
  allTab: string;
  searchPlaceholder: string;
  createEntry: string;
  refresh: string;
  lock: string;
  back: string;
  delete: string;
  deleteFolder: string;
  dragMove: string;
  renameTitle: string;
  copyAccount: string;
  copyUrl: string;
  copyPassword: string;
  showPassword: string;
  hidePassword: string;
  expand: string;
  collapse: string;
  folderHeader: string;
  folderHint: string;
  newFolderPlaceholder: string;
  newFolder: string;
  allAccounts: string;
  entryCount: (count: number) => string;
  noEntriesInScope: string;
  noEntriesFound: string;
  vaultSettings: string;
  vaultRootFixed: string;
  webdavBaseUrl: string;
  username: string;
  webdavPassword: string;
  vaultSubpath: string;
  uiSettings: string;
  uiSettingsHint: string;
  savePromptWaitSeconds: string;
  savePromptWaitHint: string;
  theme: string;
  language: string;
  saveSettings: string;
  openOptionsPage: string;
  title: string;
  notes: string;
  notesPlaceholder: string;
  tags: string;
  tagPlaceholder: string;
  addTagPlaceholder: string;
  editTag: string;
  deleteTag: string;
  generatePassword: string;
  saveSync: string;
  saving: string;
  passwordFolderPlaceholder: string;
  lockedSubtitle: string;
  openSettingsPage: string;
  masterPassword: string;
  unlockOrCreate: string;
  processing: string;
  processingWait: string;
  unlockHint: string;
  fixedRootHelp: string;
  fixedRootHelpTail: string;
  debugHint: string;
  stuckHint: string;
  debugLog: string;
  debugLogHint: string;
  clear: string;
  emptyDebugLog: string;
  dirtySuffix: string;
  optionsTitle: string;
  optionsSubtitle: string;
  noFolder: string;
  validation: {
    baseUrl: string;
    username: string;
    password: string;
    vaultPath: string;
    masterPassword: string;
  };
  status: {
    matchedExisting: (label: string) => string;
    switchedAccount: string;
    synced: string;
    validationFailed: (error: string) => string;
    checkingWebdav: string;
    unlockStart: (url: string) => string;
    configSaved: string;
    creatingVault: string;
    createdVault: string;
    createdVaultLog: string;
    decryptingVault: string;
    decryptingVaultLog: string;
    unlocked: (count: number) => string;
    unlockSuccess: (count: number) => string;
    unlockFailed: (error: string) => string;
    refreshNeedsPassword: string;
    refreshing: string;
    noVaultFile: string;
    refreshed: string;
    refreshFailed: string;
    syncing: string;
    saveFailed: string;
    deleting: string;
    deleted: string;
    deleteFailed: string;
    deletingFolder: (folder: string) => string;
    deletedFolder: (folder: string) => string;
    deleteFolderFailed: string;
    folderRequired: string;
    creatingFolder: string;
    createdFolder: (folder: string) => string;
    createFolderFailed: string;
    newEntryCreated: string;
    emptyValue: (label: string) => string;
    copied: (label: string) => string;
    locked: string;
    settingsSaved: string;
    titleUpdated: string;
    updateTitleFailed: string;
    folderNameRequired: string;
    renamedFolder: (from: string, to: string) => string;
    renameFolderFailed: string;
    movedEntryRoot: string;
    movedEntryUncategorized: string;
    movedEntryFolder: (folder: string) => string;
    movedFolder: (folder: string) => string;
    dragFailed: string;
  };
  errors: {
    unlockFailed: string;
    timeout: (url: string, raw: string) => string;
    auth: (url: string) => string;
    path: (url: string) => string;
    load: (url: string, raw: string) => string;
    save: (url: string, raw: string) => string;
    mkdir: (url: string, raw: string) => string;
  };
};

const themeLabels: Record<ExtensionLanguage, Record<ExtensionTheme, string>> = {
  zh: {
    fresh: "清爽",
    night: "夜间",
    contrast: "高对比",
    tech: "科技",
    forest: "森林",
    amber: "琥珀",
    graphite: "石墨",
  },
  en: {
    fresh: "Fresh",
    night: "Night",
    contrast: "High contrast",
    tech: "Tech",
    forest: "Forest",
    amber: "Amber",
    graphite: "Graphite",
  },
};

export const languageLabels: Record<ExtensionLanguage, string> = {
  zh: "zh",
  en: "en",
};

export function getThemeLabel(theme: ExtensionTheme, language: ExtensionLanguage) {
  return themeLabels[language][theme];
}

const zh: MessageSet = {
  all: "全部",
  uncategorized: "未分类",
  newEntry: "新条目",
  unnamed: "未命名",
  noUrl: "无网址",
  noAccount: "未填写账号",
  account: "账号",
  url: "网址",
  password: "密码",
  tag: "标签",
  folder: "文件夹",
  settings: "设置",
  details: "密码详情",
  currentPassword: "当前密码",
  selectEntryHint: "先在主界面选择一个条目",
  currentPageNoHost: "当前页面无可识别域名",
  folders: "文件夹",
  allTab: "全部",
  searchPlaceholder: "搜索标题、网址、账号、标签",
  createEntry: "新建账号",
  refresh: "刷新",
  lock: "锁定",
  back: "返回",
  delete: "删除",
  deleteFolder: "删除文件夹",
  dragMove: "拖拽移动",
  renameTitle: "双击修改标题",
  copyAccount: "点击复制账号",
  copyUrl: "点击复制网址",
  copyPassword: "点击复制密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  expand: "展开",
  collapse: "收起",
  folderHeader: "文件夹",
  folderHint: "双击改名，支持拖拽",
  newFolderPlaceholder: "例如 工作/GitHub",
  newFolder: "新建文件夹",
  allAccounts: "全部账号",
  entryCount: (count) => `${count} 条账号`,
  noEntriesInScope: "当前范围内没有匹配账号。",
  noEntriesFound: "没有找到匹配账号。",
  vaultSettings: "Vault 设置",
  vaultRootFixed: "根目录固定为 PasswordWebDAV/",
  webdavBaseUrl: "WebDAV 根地址",
  username: "用户名",
  webdavPassword: "密码或应用密码",
  vaultSubpath: "Vault 子路径",
  uiSettings: "界面设置",
  uiSettingsHint: "只保存在当前浏览器，不写入 WebDAV vault",
  savePromptWaitSeconds: "保存提示最长等待（秒）",
  savePromptWaitHint: "默认 5 秒。登录成功会提前弹出，超时仍未确认成功则不弹。",
  theme: "主题",
  language: "语言",
  saveSettings: "保存设置",
  openOptionsPage: "系统设置页",
  title: "标题",
  notes: "备注",
  notesPlaceholder: "例如恢复码、登录说明、二次验证提示",
  tags: "标签",
  tagPlaceholder: "例如 work，回车添加",
  addTagPlaceholder: "添加标签",
  editTag: "编辑标签",
  deleteTag: "删除标签",
  generatePassword: "生成密码",
  saveSync: "保存同步",
  saving: "保存中...",
  passwordFolderPlaceholder: "例如 工作/GitHub，留空为未分类",
  lockedSubtitle: "连接 WebDAV 并解锁当前会话",
  openSettingsPage: "打开设置页",
  masterPassword: "主密码",
  unlockOrCreate: "解锁或创建",
  processing: "处理中...",
  processingWait: "正在处理，请稍等...",
  unlockHint: "填写完连接信息后，点击按钮开始解锁或创建。",
  fixedRootHelp: "根目录固定为",
  fixedRootHelpTail: "这里只填写里面的子路径，例如",
  debugHint: "调试提示：如需更详细信息，请在扩展弹窗的开发者工具里查看 Console。",
  stuckHint: "如果卡住了，通常是 WebDAV 地址、用户名、应用密码或网络超时导致的。",
  debugLog: "调试日志",
  debugLogHint: "这里会打印解锁过程，便于定位卡在哪一步",
  clear: "清空",
  emptyDebugLog: "当前还没有解锁日志，点击“解锁或创建”后这里会出现详细过程。",
  dirtySuffix: "有未保存修改",
  optionsTitle: "Password WebDAV 设置",
  optionsSubtitle: "这是扩展的全局配置兜底页。日常管理密码请优先使用 popup 里的“设置 / 详情”视图。",
  noFolder: "无文件夹",
  validation: {
    baseUrl: "请填写 WebDAV 根地址。",
    username: "请填写 WebDAV 用户名。",
    password: "请填写 WebDAV 密码或应用密码。",
    vaultPath: "请填写 vault 子路径。",
    masterPassword: "主密码至少需要 8 位。",
  },
  status: {
    matchedExisting: (label) => `已根据${label}匹配到现有账号。`,
    switchedAccount: "已切换到匹配账号，可以继续编辑后保存同步。",
    synced: "已同步到 WebDAV。",
    validationFailed: (error) => `校验失败：${error}`,
    checkingWebdav: "正在检查 WebDAV 连接...",
    unlockStart: (url) => `开始解锁：${url}`,
    configSaved: "配置已保存，开始读取 WebDAV vault",
    creatingVault: "未找到 vault，正在创建新的加密密码库...",
    createdVault: "WebDAV 上没有找到 vault，已创建新的加密密码库。",
    createdVaultLog: "新 vault 创建成功，当前会话已解锁",
    decryptingVault: "正在解密并载入密码库...",
    decryptingVaultLog: "远端 vault 已读取，开始解密",
    unlocked: (count) => `已解锁 ${count} 条密码。`,
    unlockSuccess: (count) => `解锁成功：${count} 条密码`,
    unlockFailed: (error) => `解锁失败：${error}`,
    refreshNeedsPassword: "刷新前需要会话主密码，请先重新解锁。",
    refreshing: "正在刷新...",
    noVaultFile: "WebDAV 上没有找到 vault 文件。",
    refreshed: "已从 WebDAV 刷新。",
    refreshFailed: "刷新失败。",
    syncing: "正在加密并同步...",
    saveFailed: "保存失败。",
    deleting: "正在删除并同步...",
    deleted: "已删除并同步到 WebDAV。",
    deleteFailed: "删除失败。",
    deletingFolder: (folder) => `正在删除文件夹 ${folder}...`,
    deletedFolder: (folder) => `已删除文件夹 ${folder}，其中条目已移动到未分类。`,
    deleteFolderFailed: "删除文件夹失败。",
    folderRequired: "请填写文件夹路径，例如 工作/GitHub。",
    creatingFolder: "正在创建文件夹...",
    createdFolder: (folder) => `已创建文件夹：${folder}`,
    createFolderFailed: "创建文件夹失败。",
    newEntryCreated: "已新建条目，请在详情里补全并保存。",
    emptyValue: (label) => `${label}为空。`,
    copied: (label) => `已复制${label}。`,
    locked: "已锁定。",
    settingsSaved: "已保存设置。",
    titleUpdated: "已更新标题。",
    updateTitleFailed: "更新标题失败。",
    folderNameRequired: "文件夹名称不能为空。",
    renamedFolder: (from, to) => `已重命名文件夹：${from} -> ${to}`,
    renameFolderFailed: "重命名文件夹失败。",
    movedEntryRoot: "已将账号移动到根层。",
    movedEntryUncategorized: "已将账号移动到未分类。",
    movedEntryFolder: (folder) => `已将账号移动到 ${folder}。`,
    movedFolder: (folder) => `已移动文件夹到 ${folder || "根目录"}。`,
    dragFailed: "拖拽移动失败。",
  },
  errors: {
    unlockFailed: "解锁失败。",
    timeout: (url, raw) => `连接 WebDAV 超时，请检查网络、WebDAV 地址或服务响应。目标地址：${url}。${raw}`,
    auth: (url) => `WebDAV 认证失败，请检查用户名和应用密码。目标地址：${url}`,
    path: (url) => `WebDAV 路径未就绪，尝试创建目录时失败。目标地址：${url}`,
    load: (url, raw) => `无法读取 WebDAV 上的 vault。目标地址：${url}。${raw}`,
    save: (url, raw) => `无法写入 WebDAV 上的 vault。目标地址：${url}。${raw}`,
    mkdir: (url, raw) => `无法创建 WebDAV 目录。目标地址：${url}。${raw}`,
  },
};

const en: MessageSet = {
  all: "All",
  uncategorized: "Uncategorized",
  newEntry: "New entry",
  unnamed: "Untitled",
  noUrl: "No URL",
  noAccount: "No account",
  account: "Account",
  url: "URL",
  password: "Password",
  tag: "Tag",
  folder: "Folder",
  settings: "Settings",
  details: "Password details",
  currentPassword: "Current password",
  selectEntryHint: "Select an account on the main screen first.",
  currentPageNoHost: "No recognizable domain",
  folders: "Folders",
  allTab: "All",
  searchPlaceholder: "Search title, URL, account, tag",
  createEntry: "New account",
  refresh: "Refresh",
  lock: "Lock",
  back: "Back",
  delete: "Delete",
  deleteFolder: "Delete folder",
  dragMove: "Drag to move",
  renameTitle: "Double-click to rename",
  copyAccount: "Click to copy account",
  copyUrl: "Click to copy URL",
  copyPassword: "Click to copy password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  expand: "Expand",
  collapse: "Collapse",
  folderHeader: "Folders",
  folderHint: "Double-click to rename, drag to move",
  newFolderPlaceholder: "e.g. Work/GitHub",
  newFolder: "New folder",
  allAccounts: "All accounts",
  entryCount: (count) => `${count} accounts`,
  noEntriesInScope: "No matching accounts in this range.",
  noEntriesFound: "No matching accounts.",
  vaultSettings: "Vault settings",
  vaultRootFixed: "Root folder is fixed to PasswordWebDAV/",
  webdavBaseUrl: "WebDAV base URL",
  username: "Username",
  webdavPassword: "Password or app password",
  vaultSubpath: "Vault subpath",
  uiSettings: "Interface",
  uiSettingsHint: "Saved only in this browser, not in the WebDAV vault",
  savePromptWaitSeconds: "Save prompt max wait (seconds)",
  savePromptWaitHint: "Default 5 seconds. Show earlier when login succeeds. Do not show if success is still unconfirmed after timeout.",
  theme: "Theme",
  language: "Language",
  saveSettings: "Save settings",
  openOptionsPage: "System settings page",
  title: "Title",
  notes: "Notes",
  notesPlaceholder: "Recovery codes, login notes, 2FA hints",
  tags: "Tags",
  tagPlaceholder: "e.g. work, press Enter",
  addTagPlaceholder: "Add tag",
  editTag: "Edit tag",
  deleteTag: "Delete tag",
  generatePassword: "Generate password",
  saveSync: "Save and sync",
  saving: "Saving...",
  passwordFolderPlaceholder: "e.g. Work/GitHub, leave blank for uncategorized",
  lockedSubtitle: "Connect WebDAV and unlock this session",
  openSettingsPage: "Open settings page",
  masterPassword: "Master password",
  unlockOrCreate: "Unlock or create",
  processing: "Processing...",
  processingWait: "Processing, please wait...",
  unlockHint: "Fill in connection details, then unlock or create.",
  fixedRootHelp: "Root folder is fixed to",
  fixedRootHelpTail: "Only enter the subpath inside it, for example",
  debugHint: "For details, open Console in the extension popup developer tools.",
  stuckHint: "If it gets stuck, it is usually WebDAV URL, username, app password, or network timeout.",
  debugLog: "Debug log",
  debugLogHint: "Unlock steps are logged here to locate where it stops.",
  clear: "Clear",
  emptyDebugLog: "No unlock log yet. Click unlock or create to see details.",
  dirtySuffix: "unsaved changes",
  optionsTitle: "Password WebDAV Settings",
  optionsSubtitle: "Global fallback configuration for the extension. Use the popup settings and details views for daily password management.",
  noFolder: "No folder",
  validation: {
    baseUrl: "Please enter the WebDAV base URL.",
    username: "Please enter the WebDAV username.",
    password: "Please enter the WebDAV password or app password.",
    vaultPath: "Please enter the vault subpath.",
    masterPassword: "Master password must be at least 8 characters.",
  },
  status: {
    matchedExisting: (label) => `Matched an existing account by ${label}.`,
    switchedAccount: "Switched to the matched account. You can edit and save it.",
    synced: "Synced to WebDAV.",
    validationFailed: (error) => `Validation failed: ${error}`,
    checkingWebdav: "Checking WebDAV connection...",
    unlockStart: (url) => `Unlock started: ${url}`,
    configSaved: "Settings saved. Loading WebDAV vault.",
    creatingVault: "No vault found. Creating a new encrypted vault...",
    createdVault: "No vault found on WebDAV. Created a new encrypted vault.",
    createdVaultLog: "New vault created and this session is unlocked.",
    decryptingVault: "Decrypting and loading vault...",
    decryptingVaultLog: "Remote vault loaded. Decrypting.",
    unlocked: (count) => `Unlocked ${count} passwords.`,
    unlockSuccess: (count) => `Unlock succeeded: ${count} passwords`,
    unlockFailed: (error) => `Unlock failed: ${error}`,
    refreshNeedsPassword: "Session master password is required. Please unlock again first.",
    refreshing: "Refreshing...",
    noVaultFile: "No vault file found on WebDAV.",
    refreshed: "Refreshed from WebDAV.",
    refreshFailed: "Refresh failed.",
    syncing: "Encrypting and syncing...",
    saveFailed: "Save failed.",
    deleting: "Deleting and syncing...",
    deleted: "Deleted and synced to WebDAV.",
    deleteFailed: "Delete failed.",
    deletingFolder: (folder) => `Deleting folder ${folder}...`,
    deletedFolder: (folder) => `Deleted folder ${folder}; entries moved to uncategorized.`,
    deleteFolderFailed: "Delete folder failed.",
    folderRequired: "Enter a folder path, e.g. Work/GitHub.",
    creatingFolder: "Creating folder...",
    createdFolder: (folder) => `Created folder: ${folder}`,
    createFolderFailed: "Create folder failed.",
    newEntryCreated: "New entry created. Fill details and save.",
    emptyValue: (label) => `${label} is empty.`,
    copied: (label) => `Copied ${label}.`,
    locked: "Locked.",
    settingsSaved: "Settings saved.",
    titleUpdated: "Title updated.",
    updateTitleFailed: "Update title failed.",
    folderNameRequired: "Folder name cannot be empty.",
    renamedFolder: (from, to) => `Renamed folder: ${from} -> ${to}`,
    renameFolderFailed: "Rename folder failed.",
    movedEntryRoot: "Moved account to root.",
    movedEntryUncategorized: "Moved account to uncategorized.",
    movedEntryFolder: (folder) => `Moved account to ${folder}.`,
    movedFolder: (folder) => `Moved folder to ${folder || "root"}.`,
    dragFailed: "Drag move failed.",
  },
  errors: {
    unlockFailed: "Unlock failed.",
    timeout: (url, raw) => `WebDAV timed out. Check network, URL, or service response. Target: ${url}. ${raw}`,
    auth: (url) => `WebDAV authentication failed. Check username and app password. Target: ${url}`,
    path: (url) => `WebDAV path is not ready and directory creation failed. Target: ${url}`,
    load: (url, raw) => `Cannot read the WebDAV vault. Target: ${url}. ${raw}`,
    save: (url, raw) => `Cannot write the WebDAV vault. Target: ${url}. ${raw}`,
    mkdir: (url, raw) => `Cannot create the WebDAV directory. Target: ${url}. ${raw}`,
  },
};

export function getMessages(language: ExtensionLanguage): MessageSet {
  return language === "en" ? en : zh;
}
