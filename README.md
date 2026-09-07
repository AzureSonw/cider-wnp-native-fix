# Cider WNP Native Metadata Fix

这是一个面向 Windows 版 Cider 4.x 的非官方修复：当 Cider 已经播放新歌，但 WebNowPlaying、OBS 的 WebNowPlaying 或 Rainmeter 仍显示上一首歌时，把 Cider 当前的 RPC 播放信息重新提交给 Cider 自己的原生 Windows 媒体会话。

它不会启动第二个播放器、后台服务或网络桥接，也不要求安装 `Cider2WNP`。WebNowPlaying 可以继续使用 Cider 的原生 Windows 媒体会话。脚本只修改 Cider 安装目录下的 `Resources\scripts\preload.js`，并在修改前保存可校验的原文件备份。

## 使用

1. 完全退出 Cider，包括托盘中的 Cider。
2. 解压本仓库，双击 `install.cmd`。
3. 重新启动 Cider，播放一首歌后检查 WNP 或 OBS。

命令行也可以显式指定 Cider 安装目录：

```cmd
install.cmd -CiderPath "C:\Users\you\AppData\Local\Programs\Cider"
check.cmd -CiderPath "C:\Users\you\AppData\Local\Programs\Cider"
restore.cmd -CiderPath "C:\Users\you\AppData\Local\Programs\Cider"
```

三个 CMD 文件都只是调用同目录的 PowerShell 脚本；`ExecutionPolicy Bypass` 只作用于这一次 PowerShell 进程，不会永久修改系统策略。

安装器会自动寻找以下位置：`%LOCALAPPDATA%\Programs\Cider`、`%ProgramFiles%\Cider` 和 `%ProgramFiles(x86)%\Cider`。找不到时使用 `-CiderPath`。安装和恢复都要求 Cider 已关闭。

## 原理

Cider 的前端 `CiderApp.RPC.nowPlayingAttributes` 是当前播放器的权威歌曲状态；旧的 `musicKitStore.player` 在部分 Cider 4.x 构建中已经不再提供当前项目。修复每秒读取一次当前状态，用歌曲标题、艺人、专辑、封面和时长合并重复通知，等待原生媒体会话的切换完成后调用现有的：

```js
window.chrome.webview.hostObjects.playbackState.SetNowPlaying(json)
```

遇到自动切歌或原生封面异步处理丢更新时，适配器会再次提交最新歌曲一次；如果原生调用临时失败，最多重试三次。它不会向外部服务上传歌曲、封面、配置或账号信息。

## 检查与回退

`check.cmd` 会检查托管区块和 SHA-256。`restore.cmd` 只有在当前文件仍与安装记录相符、备份校验通过时才会恢复，检测到用户后来改过文件会停止以避免覆盖改动。Cider 更新后可能覆盖 `preload.js`，此时重新运行 `check.cmd`；若确认安装目录来自新版本，再重新运行 `install.cmd`。

## 验证

仓库中的 Node.js 测试不需要依赖：

```cmd
node tests\test-native-metadata.cjs
node tests\test-native-preload.cjs
```

覆盖重复事件合并、自动切歌、原生调用间隔、恢复提交、临时失败重试、轮询稳定性、延迟启动、封面 URL 格式化、重复注入和卸载清理。

实际修复在 Cider.NET 前端 4.0.7、Windows 原生媒体会话、WebNowPlaying 和 OBS WebNowPlaying 上验证过。Cider 或 WebNowPlaying 的未来版本可能改变内部接口；如果 `check.cmd` 显示文件已被更新，请先保留备份并重新验证。

## 文件

```text
src/native-metadata-publisher.js  合并、节流、重试逻辑
src/native-metadata-preload.js    Cider 页面内的 RPC 适配器
scripts/cider-wnp.ps1             安装、检查、恢复
install.cmd / check.cmd / restore.cmd
tests/                            无依赖 Node.js 测试
```

本仓库只包含新写的修复代码和安装器，不包含 Cider 二进制、签名更新包、原始前端文件、用户配置、播放记录或调试日志。项目与 Cider、WebNowPlaying、OBS 无隶属关系。

