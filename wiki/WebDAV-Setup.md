# WebDAV Setup

## WebDAV 根地址

根地址应该指向你的 WebDAV 文件目录，而不是某个单独文件。

坚果云示例：

```text
https://dav.jianguoyun.com/dav/
```

Nextcloud 示例：

```text
https://example.com/remote.php/dav/files/your-user/
```

Vault 文件路径示例：

```text
password-vault.json
```

如果你想放在子目录：

```text
passwords/password-vault.json
```

插件保存时会自动用 WebDAV `MKCOL` 创建 `passwords` 这样的父目录。如果你的 WebDAV 服务不支持 `MKCOL`，请手动创建目录后再保存。

## 用户名和密码

建议使用 WebDAV 服务提供的应用密码，而不是主账号密码。

坚果云通常需要在“安全选项 / 第三方应用管理”中创建应用密码。

## 文件权限

Vault 文件里只有密文，但仍建议：

- 不要把 vault 文件放到公开目录。
- 不要共享 WebDAV 账号。
- 定期备份 `password-vault.json`。

