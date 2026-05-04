# Architecture

## 组件

```text
apps/extension
  Chrome MV3 插件，负责配置、创建 vault、解锁、管理条目、复制和填充当前页面

packages/core
  共享 vault 类型、加密、WebDAV 客户端、域名匹配逻辑

WebDAV
  只保存加密后的 vault JSON 文件
```

## WebDAV 保存什么

WebDAV 文件大致长这样：

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-05-04T00:00:00.000Z",
  "updatedAt": "2026-05-04T00:00:00.000Z",
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 600000,
    "salt": "base64..."
  },
  "wrappedVaultKey": {
    "algorithm": "AES-GCM",
    "iv": "base64...",
    "wrappedKey": "base64..."
  },
  "vault": {
    "algorithm": "AES-GCM",
    "iv": "base64...",
    "ciphertext": "base64..."
  }
}
```

解密后的 vault 内容里才会有文件夹路径和条目，例如：

```json
{
  "schemaVersion": 1,
  "folders": ["工作", "工作/GitHub"],
  "entries": [
    {
      "title": "GitHub",
      "folder": "工作/GitHub",
      "username": "user@example.com"
    }
  ]
}
```

WebDAV 不保存：

- 主密码
- 明文网站密码
- 明文文件夹和条目内容
- 明文 vault key
- 解锁后的密码库

## 加密流程

创建或同步 vault 时：

1. 插件生成随机 vault key。
2. 插件生成随机 salt。
3. 用“主密码 + salt + PBKDF2 参数”派生 wrapping key。
4. 用 wrapping key 加密 vault key，得到 `wrappedVaultKey`。
5. 用 vault key 加密完整密码库，得到 `vault.ciphertext`。
6. 把密文 JSON 上传到 WebDAV。

解锁 vault 时：

1. 插件从 WebDAV 下载密文 JSON。
2. 用户输入主密码。
3. 插件用同一个 salt 和 KDF 参数重新派生 wrapping key。
4. 用 wrapping key 解开 `wrappedVaultKey`。
5. 用解出的 vault key 解开 `vault.ciphertext`。
6. 解密后的密码只保存在当前浏览器会话状态中。

## 插件保存什么

- `chrome.storage.local`：保存 WebDAV 配置。
- `chrome.storage.session`：保存当前浏览器会话里的解锁 vault。
- `chrome.storage.session`：登录表单提交后，短时间保存一条待确认的候选账号密码，用于页面跳转后弹出“保存”提示。

主密码不会写入 WebDAV 或 Chrome 存储。解锁后，扩展后台只在内存里临时持有主密码，用来处理“登录后点击保存”的加密上传；点击锁定、扩展后台重启或浏览器关闭后需要重新解锁。

## 同步策略

当前版本是手动同步：

- 保存条目时会加密并上传 WebDAV。
- 创建文件夹时会把文件夹路径写入 vault，再加密上传 WebDAV。
- 刷新按钮会从 WebDAV 重新读取 vault。
- 当前没有冲突合并，多设备同时编辑时需要人为避免覆盖。
