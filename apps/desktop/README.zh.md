# `@deepseek-ai/dsh-desktop`（ZHarness 桌面版）

[English](README.md) | 中文

ZHarness 是 DeepSeek Harness 的 macOS 桌面应用。它是一个 Electron 外壳：在本机 `127.0.0.1` 的空闲端口上启动并托管 `dsh web` 服务，在窗口中加载该 Web UI，并注入桌面端样式与交互增强。智能体能力、会话、工作区、模型与权限设置全部沿用 `dsh web`，桌面端不改动任何 harness 包。

## 功能

- **托管本地服务**：启动页显示进度；服务启动失败或意外退出时显示日志尾部，并提供「重试」「打开日志」。退出应用时先 SIGTERM，5 秒后 SIGKILL。
- **桌面布局**：半透明侧栏（macOS vibrancy）+ 内嵌圆角内容卡片、隐藏式标题栏与红绿灯、蓝紫渐变主色、浅色/深色主题。
- **首页**：按时段问候语，输入框下方的「试试这些任务」快捷卡片；未选择工作区时点击卡片会先打开工作区选择，选定后自动填入任务。
- **原生菜单与快捷键**：⌘N 新建任务、⌘L 聚焦输入框、⌘\ 切换侧边栏、⌘, 设置；帮助菜单可重启本地服务、打开日志目录与数据目录。
- **独立数据目录**：桌面版的设置、API Key 和会话保存在 `~/.zharness`（可用 `ZHARNESS_DSH_HOME` 覆盖），不与命令行 `dsh` 的 `~/.dsh` 共用，因为两者可能是不同版本，dsh 会拒绝其他版本写入的磁盘格式。
- **环境继承**：读取登录 shell 的 PATH（并补充 Homebrew 路径），让智能体的 shell 工具能找到 `brew`、`nvm` 等安装的命令；外部链接用系统浏览器打开。

## 开发运行

```sh
pnpm install
pnpm run build                                  # 仓库根目录：构建 dsh 包与前端
pnpm --filter @deepseek-ai/dsh-desktop start    # 编译桌面壳并启动 Electron
```

开发模式使用工作区内构建好的 `@deepseek-ai/dsh`，以及登录 shell PATH 中的 `node`（需 Node.js 22.19+）；`DSH_DESKTOP_NODE` 可指定其他 Node。`dev` 脚本会额外打开开发者工具。若 Electron 二进制未下载，运行 `node apps/desktop/node_modules/electron/install.js`。

## 打包 .dmg

在与目标架构一致的 Mac 上运行（Apple Silicon 默认 arm64）：

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac       # arm64 → apps/desktop/dist/*.dmg / *.zip
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac:x64   # Intel Mac 上构建 x64
```

打包流程：

1. `scripts/stage-runtime.mjs` 用 `pnpm deploy` 导出 `@deepseek-ai/dsh` 及其生产依赖到 `.stage/dsh-runtime`，并补齐 deploy 遗漏的 peer 依赖与 vendored 包，去除符号链接。
2. `scripts/fetch-node.mjs` 下载官方 Node.js（校验 SHA-256）到 `.stage/node/<arch>`。dsh 的 loader 依赖 Node 内部 ESM 加载器，Electron 内置 Node（`ELECTRON_RUN_AS_NODE`）无法运行它，所以应用内附带独立 Node。
3. `electron-builder` 打包；`scripts/after-pack.cjs` 把 `.stage/dsh-runtime` 复制进 `Contents/Resources`（electron-builder 不会通过 `extraResources` 复制 `node_modules`）。

运行时（node-pty、sharp、koffi）含本机原生模块，所以需在目标架构的 Mac 上暂存与打包。

默认不签名（企业内部分发）。首次打开未签名应用：右键 → 打开，或执行 `xattr -dr com.apple.quarantine /Applications/ZHarness.app`。如需签名公证，设置 `CSC_LINK`/`CSC_NAME` 并在 `electron-builder.yml` 中移除 `identity: null`。

## 实现说明

| 文件 | 作用 |
|---|---|
| `src/main.ts` | 窗口、生命周期、导航限制（仅允许本地服务源，其他链接交给系统浏览器）、单实例 |
| `src/server.ts` | 选择空闲端口、启动 `dsh web --host 127.0.0.1 --port <p>`、以 `dsh web: <url>` 行判定就绪、日志写入 `~/Library/Logs/ZHarness/dsh-web.log` |
| `src/runtime.ts` | 定位 Node 与 dsh 入口、登录 shell PATH、子进程环境（`DSH_DESKTOP=1`） |
| `src/menu.ts` | 中文应用菜单 |
| `src/preload.cts` | 启动页桥接、首页问候语与快捷任务卡片、菜单命令驱动 Web UI 控件 |
| `assets/desktop.css` | 桌面皮肤：覆盖 `--dsw-alias-*` 主题变量并调整布局 |

桌面样式按 CSS Module 类名的可读后缀匹配（如 `[class*="_newSession"]`）以及 `data-slot` 属性。Web UI 重命名这些类或 slot 时，桌面皮肤需要同步调整。

## Known Limitations and Deferred Work

- 仅适配 macOS；Windows/Linux 可以运行但未做专门适配与打包配置。
- 皮肤依赖 Web UI 的类名后缀与 `data-slot`，不是稳定的扩展接口；长期应改为客户端 `ui-*` 插件或主题注册。
- 快捷任务卡片内容为固定列表，尚不可配置。
- 未接入自动更新与代码签名。
