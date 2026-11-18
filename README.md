# EvpProxies

EvpProxies 是用 Tauri、React 和 MUI 构建的 Windows 桌面 HTTP 代理映射管理工具。[下载最新 Windows x64 安装包](https://github.com/Evanpatchouli/evp-proxies/releases/latest)

## 映射管理

1. 填写源路径与目标 HTTP 地址，例如 `/api` 和 `http://localhost:8080`。需要替换路径前缀时填写「重写」。
2. 点击「添加」后规则立即启用。请求默认发往 `http://localhost:9420`，代理按最长的已启用前缀转发。未匹配的路径返回 404。
3. 在卡片上可启用、停用、查看详情或删除规则。顶栏显示启用数量。

从 v1.0.1 起，添加、覆盖、启停和删除规则都会立即写入当前 Windows 用户的 `%LOCALAPPDATA%\com.evanpatchouli.evp-proxies\proxy-mappings.sqlite3`。应用重启或原地更新后自动使用已保存的规则及其状态。要备份规则，可在关闭应用后复制该数据库。

**从 v1.0.0 首次升级**：请先记下源路径、目标、重写和启停状态。旧版只在内存中保存规则，首次升级后需要重新添加一次。

代理默认监听 `0.0.0.0:9420`，可访问该端口的设备也能使用已启用的映射。

## 顶栏菜单

| 菜单 | 功能 |
| --- | --- |
| 更多 → 视图 | 放大、缩小（每次 10%，范围 50%–200%）、切换全屏 |
| 更多 → 帮助 → 新功能 | 查看正式版的发布说明、刷新记录或展开更早版本。离线时显示缓存或内置记录 |
| 更多 → 帮助 → 反馈 | 在系统浏览器打开项目的 GitHub Issues |
| 更多 → 帮助 → 检查更新 | 手动检查最新正式版，查看说明并选择是否安装 |
| 更多 → 帮助 → 关于 | 查看应用简介、当前版本与发布日期 |
| 更多 → 帮助 → 文档 | 预留入口，悬停显示「敬请期待」 |
| 更多 → 关闭 | 关闭当前窗口 |

应用在启动约 2 秒后检查一次 GitHub Release，之后每 15 分钟再检查一次。后台检查仅在发现新版时弹窗。选择「稍后再说」可以继续使用当前版本。「立即更新」会重新核对版本，下载 Windows 安装包，核验文件大小、文件头和 GitHub 提供的 SHA-256 摘要，然后静默安装并重启。下载期间可以取消。

## 本地开发

Windows 构建需要 Node.js 22.12+、npm、Rust stable MSVC x64 工具链、Visual Studio C++ 桌面开发工具、Windows SDK 和 WebView2。首次打包还需要网络以获取 NSIS 工具。

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc
npm ci
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc"
npm run tauri dev
```

`npm run build` 执行 TypeScript 检查并构建前端。`cargo test --locked --manifest-path src-tauri/Cargo.toml` 运行 Rust 测试。

## 构建与发布

1. 更新 `package.json` 的 `version`、`releaseDate` 和 `src-tauri/Cargo.toml` 的版本。Tauri 直接从 `package.json` 读取应用版本。同步 npm 与 Cargo 锁文件。
2. 在 `resources/changelog.json` 顶部添加对应 tag、发布日期与 Markdown 说明。构建脚本会核对这些信息，并生成同一份 Release 正文。
3. 执行 `npm ci` 和 `npm run release`（别名 `npm run dist:win`）。脚本构建 Windows x64 NSIS 安装包，输出到 `release/<version>/`。
4. 提交并推送版本改动及对应 tag，然后创建 GitHub 正式 Release。以 v1.0.1 为例，在已验证并暂存变更后执行：

```powershell
git commit -m "chore(release): 发布 v1.0.1"
git tag v1.0.1
git push --atomic origin master v1.0.1
gh release create v1.0.1 release/1.0.1/EvpProxies.Setup.1.0.1.exe release/1.0.1/SHA256SUMS.txt --verify-tag --title "EvpProxies v1.0.1" --notes-file release/1.0.1/notes.md
```

发布后核对 Release 的 tag、安装包名称和 GitHub 资产的 `digest` 与本地 `SHA256SUMS.txt`。保留 `EvpProxies.Setup.<version>.exe` 的命名，应用内更新依赖此约定。当前安装包未进行 Windows 代码签名，首次运行时系统可能显示未知发布者。

可在 GitHub Actions 中手动运行 **Test Windows release upgrade**，选择对应发布提交并填写旧版 tag。在独立 Windows 环境中，它会从旧版的「立即更新」开始，检查自动重启、版本号、规则恢复和实际 HTTP 转发。
