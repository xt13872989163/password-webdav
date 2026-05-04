# Password WebDAV

Password WebDAV 是一个 Chrome 插件版密码管理工具。它直接使用 WebDAV 保存加密后的 vault 文件，不需要单独后端服务，也不再提供网页端版本。

## 功能

- 在 Chrome 插件弹窗中创建或解锁加密密码库。
- 新增、编辑、删除、搜索密码条目。
- 创建文件夹和子文件夹，用于分类保存密码。
- 复制账号和密码。
- 给当前登录页面一键填充账号和密码。
- 登录成功后提示是否保存识别到的账号和密码。
- 手动刷新 WebDAV 上的 vault。
- 保存时自动创建 vault 文件的父目录。

## 快速开始

安装依赖：

```bash
npm install
```

构建插件：

```bash
npm --workspace @password-webdav/extension run build
```

在 Chrome 安装：

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `apps/extension/dist`。

开发时监听构建：

```bash
npm run dev:extension
```

## 使用方式

1. 点击 Chrome 工具栏里的 Password WebDAV 图标。
2. 填写 WebDAV 根地址、用户名、密码或应用密码、vault 子路径。
3. 输入主密码。
4. 点击“解锁或创建”。
5. 如果 WebDAV 上没有 vault，插件会自动创建一个加密 vault。
6. 解锁后可以新增、编辑、删除、保存同步、复制和填充密码。
7. 在左侧“文件夹”里输入 `工作/GitHub` 这样的路径并点击创建，即可创建子文件夹；编辑密码时也可以把“文件夹”字段改成同样的路径。
8. 在网站登录时，插件会识别标准登录表单；登录页跳转后右下角会提示“保存到 Password WebDAV？”，点击“保存”才会写入 WebDAV。

自动保存提示需要先解锁插件。插件不会静默保存密码，也不会保存主密码；主密码只在当前扩展后台内存中用于本次会话加密。
`PasswordWebDAV/` 是固定根目录，设置里只填写它后面的子路径。
成功解锁后，当前浏览器会话里会暂存主密码，这样你关闭再打开弹窗时，保存修改不需要重新输入；锁定或关闭浏览器后会清掉。

## 安全模型

主密码不会保存到 WebDAV。插件使用主密码通过 PBKDF2 派生包裹密钥，再解开随机 vault key，最后用 vault key 解密密码库数据。WebDAV 文件中只有 salt、KDF 参数、加密后的 vault key 和加密后的密码库内容。

## 常用命令

```bash
npm run test
npm run build
npm run dev:extension
```

完整说明见 [wiki/Home.md](wiki/Home.md)。
