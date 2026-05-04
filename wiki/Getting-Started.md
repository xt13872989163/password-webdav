# Getting Started

## 1. 安装依赖

在项目根目录运行：

```bash
npm install
```

## 2. 构建 Chrome 插件

```bash
npm --workspace @password-webdav/extension run build
```

构建产物在：

```text
apps/extension/dist
```

## 3. 安装 Chrome 插件

1. 打开 Chrome。
2. 进入 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `apps/extension/dist`。

## 4. 首次创建密码库

1. 点击 Chrome 工具栏里的 Password WebDAV 图标。
2. 填写 WebDAV 根地址，例如 `https://dav.jianguoyun.com/dav/`。
3. 填写 WebDAV 用户名。
4. 填写 WebDAV 密码或应用密码。
5. 填写 vault 子路径，例如 `password-vault.json` 或 `work/password-vault.json`。扩展会固定保存到 `PasswordWebDAV/` 目录下。
6. 输入主密码。
7. 点击“解锁或创建”。

如果 WebDAV 上没有 vault 文件，插件会自动创建新的加密 vault。保存时也会自动创建父目录。

## 5. 管理密码

解锁后可以：

- 点击加号新增密码。
- 在右侧编辑标题、网址、用户名、密码、标签和备注。
- 点击“保存同步”加密并上传到 WebDAV。
- 点击复制按钮复制账号或密码。
- 点击“填充”把账号和密码填入当前登录页。
- 点击锁图标清空当前会话里的解锁状态。
- 在左侧“文件夹”区域输入 `工作/GitHub` 这样的路径并点击创建，就能建立子文件夹；编辑时也可以直接修改条目的“文件夹”字段。
- 新建条目时，标题、网址、用户名和文件夹会优先提示当前网站已有数据；输入精确匹配的账号时会自动带出已保存密码。

## 6. 登录后提示保存

自动保存提示的使用步骤：

1. 先打开 Password WebDAV 插件并完成解锁。
2. 去目标网站登录，例如 GitHub。
3. 插件在你提交登录表单时会临时记住本次输入。
4. 如果登录页跳转成功，页面右下角会出现“保存到 Password WebDAV？”。
5. 点击“保存”后，插件会重新读取 WebDAV 上的最新 vault，解密、合并该账号，再加密上传。
6. 点击“不保存”会丢弃本次临时记录。

如果没有先解锁插件，点击保存时会提示你先解锁 vault。插件不会自动静默保存密码，必须由你点击“保存”确认。

## 7. 开发模式

如果你正在开发插件，可以运行：

```bash
npm run dev:extension
```

然后在 `chrome://extensions` 里重新加载插件。
