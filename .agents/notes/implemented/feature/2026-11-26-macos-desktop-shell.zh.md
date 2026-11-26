# Agent Note：基于 Web UI 的 macOS 桌面外壳

Status: implemented

[English](2026-11-26-macos-desktop-shell.md) | 中文

## 问题

企业内部用户希望以 macOS 桌面应用的形式使用 DeepSeek Harness，并采用工作台式布局：任务侧栏、首页问候语与快捷任务、原生窗口外观与菜单。Web UI 已提供会话、工作区、模型配置、审批与设置，所有智能体能力都运行在 `dsh web` 之后。

## 决策

**`apps/desktop` 是包在未修改的 `dsh web` 进程之外的 Electron 外壳。** 主进程以子进程启动 `dsh web --host 127.0.0.1 --port <空闲端口>`，以 stdout 中的 `dsh web: <url>` 行作为就绪信号并加载该 URL。不修改任何 harness 包；服务端保留自身的信任边界、设置和凭据。

**服务运行在真正的 Node.js 二进制上，而不是 Electron 内置的 Node。** Cordis loader 通过 Node 内部 ESM 加载器解析插件；在 `ELECTRON_RUN_AS_NODE` 下插件导入无法解析。开发模式使用登录 shell 中的 `node`；打包应用附带经过校验和验证下载的官方 Node。

**打包运行时是 `@deepseek-ai/dsh` 的 `pnpm deploy` 结果，再由依赖闭包遍历补全。** `pnpm deploy --legacy` 会遗漏 peer 依赖和 `link:` 形式的 vendored 覆盖，因此 `scripts/stage-runtime.mjs` 从工作区或已解析位置复制每个缺失的依赖或 peer，直到闭包完整，并解除链接。由于 electron-builder 会从 `extraResources` 中丢弃 `node_modules`，`scripts/after-pack.cjs` 负责把它放入 `Contents/Resources`。

**桌面样式由注入的样式表和 preload 脚本实现。** `assets/desktop.css` 以 `!important` 覆盖 `--dsw-alias-*` 变量（ui-layout 会把它们以内联方式写在 `<body>` 上）并调整框架布局；preload 负责问候语、快捷任务卡片、拖拽条，以及通过点击现有 Web UI 控件实现的菜单命令。

## 考虑过的替代方案

**基于 JSON-RPC SDK 的全新渲染层。** 第一版不采用：它会重复 Web UI 已有的会话、审批、设置和引导界面。

**Web UI 客户端名单中的 `ui-*` 插件。** 暂缓：这是首页卡片和主题的稳定扩展途径，但需要桌面专用的 bundle patch 与前端构建集成。

**通过 `ELECTRON_RUN_AS_NODE` 使用 Electron 内置 Node。** 不采用，原因是 loader 在其中无法解析插件（见决策）。

## 影响

桌面应用无需改代码即可跟随 Web UI 的行为。皮肤依赖 CSS Module 类名后缀与 `data-slot`，二者不是稳定接口，Web UI 重命名可能悄然破坏样式；[包 README](../../../../apps/desktop/README.md) 记录了这一限制。由于运行时包含本机原生模块，打包必须在目标架构的 Mac 上进行。
