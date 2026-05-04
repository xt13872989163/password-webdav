# Password WebDAV Wiki

## 页面目录

- [Getting Started](Getting-Started.md)：安装、构建、加载 Chrome 插件。
- [WebDAV Setup](WebDAV-Setup.md)：WebDAV 地址、账号、应用密码、目录创建。
- [Architecture](Architecture.md)：插件、core、WebDAV 分别负责什么，以及加解密流程。
- [FAQ](FAQ.md)：常见问题和恢复建议。

## 第一版功能

- Chrome 插件创建或解锁加密 vault。
- Chrome 插件新增、编辑、删除、搜索密码条目。
- Chrome 插件复制账号和密码。
- Chrome 插件手动刷新 WebDAV vault。
- Chrome 插件按当前页面域名排序候选密码。
- Chrome 插件一键填充当前页面用户名和密码。

## 当前限制

- 插件使用 `<all_urls>` 权限，适合个人自用原型；正式发布前建议改成更精细的动态权限。
- 当前版本没有冲突合并机制，多设备同时编辑时以后保存的一方会覆盖先保存的一方。
- 当前版本只做基础字段识别，少数定制化登录页可能需要后续单独适配。

