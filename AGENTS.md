# AGENTS.md — ds-web-ui 项目指南

> 本文件是给 AI 编码助手（pi / Claude Code / Cursor 等）看的项目说明书：
> 结构、架构、关键实现、Windows 兼容性坑、开发与发布流程。
> 修改本文件后，在 pi 中运行 `/reload` 生效。

## 1. 项目是什么

ds-web-ui 是 **DeepSeek Harness (DSH)** 的 Web 聊天界面：浏览器里对话（思考块/工具调用/流式输出）、
文件树 + 预览、内置终端（xterm.js + node-pty）、会话管理（DSH JSONL）、多对话并行、模型切换、
状态栏（token/上下文 1M 窗口/花费估算）。

- **前端**：从 [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui) 0.16.2 照搬源码（React 18 + Vite 6），
  品牌定制为 ds-web-ui（D logo、ds-web-ui 文案）
- **后端**：DSH stdio JSON-RPC runtime（官方 Node 版，随包自带，**Windows/macOS/Linux 均可运行**），
  与 pi-web-ui 的 pi SDK 后端不同
- 仓库（公开）：`git@github.com:xing-shuyin/ds-web-ui.git`
- npm 包：`ds-web-ui`（发布者 npm 账号 `xingshuyin`，GitHub 同账号）
- Node 要求：**>= 22.19.0**；全 JavaScript，零 Python 依赖
- 版本：`package.json` 与 `package-lock.json` 两处同步维护；发布用 `npm run release` 一键完成

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node + Express（静态 + `/api/health`）+ `ws`（`/ws` WebSocket） |
| 前端 | React 18 + Vite 6 + react-markdown + highlight.js + xterm.js（源码在 `web/src/`） |
| agent 后端 | 官方 DSH jsonrpc runtime：`vendor/runtime/dsh-jsonrpc-agent-launcher.js` + `cordis.yml`，经 stdio JSON-RPC 2.0（newline-delimited） |
| DSH 插件 | `@deepseek-ai/dsh-sdk-jsonrpc-demo/server`、`dsh-agent-spine-demo`、`dsh-llm-deepseek` 等 8 个包（dependencies） |
| 终端 | node-pty（服务端 PTY）+ `@xterm/xterm`（浏览器渲染，经 terminal bridge 转发） |
| 样式 | 单文件 `web/src/styles.css`（CSS 变量主题，深色） |

## 3. 目录结构

```
ds-web-ui/
├── server/                     # 后端（Node ESM）
│   ├── index.js                # 入口：express 静态 + /ws、消息分发、心跳、优雅停机、--port 解析、自动开浏览器
│   ├── agent-service.js        # 核心：ClientSession（每客户端）+ Conversation（每对话）
│   │                           #   · DSH 事件 → UI 快照（60ms 节流 scheduleSnapshot/flushSnapshot）
│   │                           #   · workspacePath() 工作区路径校验（根请求返回 cwd，路径用正斜杠）
│   │                           #   · 文件树/预览/补全（completePath 支持任意盘符、~、双分隔符）
│   │                           #   · token 统计（runtime usage 事件累计）+ 花费估算（官方定价）
│   │                           #   · isConfigured：~/.ds-web/dsh-key.json → ~/.pi/agent/auth.json（os.homedir()！）
│   │                           #   · setCwd 切换工作区（重启 runtime + 会话根）
│   ├── dsh-client.js           # DshRuntime：spawn launcher + stdio JSON-RPC 客户端（initialize/prompt/事件通知）
│   ├── serialize.js            # DSH 消息 → UiMessage 序列化（截断、稳定 id）
│   └── terminals.js            # TerminalManager（PTY 生命周期）+ .pi/commands.json 读写
├── web/                        # 前端（从 pi-web-ui 0.16.2 照搬源码 + 构建）
│   ├── src/                    # React 源码（品牌定制在源码层：TopBar/i18n/MessageList/FooterBar）
│   ├── dist/                   # vite 构建产物（发布内容，勿手改！改源码后 npm run build:web 重建）
│   ├── index.html              # 构建模板（title: ds-web-ui — DSH 编码智能体）
│   ├── public/                 # favicon/icon（D 版，构建时复制到 dist）
│   └── vite.config.ts
├── vendor/runtime/             # ★ 自带的 Node 版 DSH runtime（Windows 关键）
│   ├── dsh-jsonrpc-agent-launcher.js   # 入口：副作用 import @deepseek-ai/dsh-sdk-jsonrpc-demo/bin
│   └── cordis.yml              # 官方 SDK 捆绑配置（jsonrpc server + agent spine + llm + sessions + bash + fs）
├── assets/                     # README 截图（shot.jpeg，jsdelivr 引用）
├── scripts/release.mjs         # 一键发布（bump → npm publish → push → gh release）
├── e2e-test.mjs                # 端到端冒烟（需服务运行 + 有效 key）
├── README.md / README.en.md    # 中文默认 + 英文版（结构参照 pi-web-ui）
└── package.json                # bin: ds-web-ui → server/index.js（必须带 shebang！）
```

## 4. 架构

```
浏览器 (pi-web-ui 前端产物，web/dist)
   │  WebSocket /ws  (pi-web-ui 协议：snapshot/tool_delta/terminal_* ...)
   ▼
server/index.js  ── Express + ws ── 静态前端 + /api/health
   │
server/agent-service.js  ── 每客户端一个会话；DSH 事件 → UI 快照（60ms 节流）
   │
server/dsh-client.js  ── stdio JSON-RPC 2.0（newline-delimited）
   ▼
vendor/runtime/dsh-jsonrpc-agent-launcher.js（Node）→ cordis.yml 插件组合
   │  session.event / session.status / subagent.*
   ▼
DeepSeek V4 模型（deepseek-v4-flash / deepseek-v4-pro）
```

### WebSocket 协议（pi-web-ui 协议，前端为事实来源）

客户端 → 服务端：`hello`、`prompt`、`abort`、`new_chat`、`switch_conversation`、
`edit_message`、`list_files`（path 可空=根）、`read_file`、`complete_path`、`set_cwd`、
`list_commands`、`save_commands`、`list_models`、`set_model`、终端消息（`terminal_*`）等。

服务端 → 客户端：`ready`、`snapshot`（含 state）、`notice`、`tool_status`、`file_content`、
`files`、`path_completions`、`commands`、`slash_commands`、`conversations`、`models`、
`terminal_add/remove/exit/restart` 等。

**协议字段对齐要点（踩过坑）**：
- `file_content` 必须带 `content` 字段（前端读 `t.content`，`text` 也保留）
- `files.path/parent` 用**正斜杠**；一级目录 parent 为 `""`（不是 `"."`）
- `list_files` 不带 path = 根目录请求，`workspacePath` 须返回 cwd（空路径不能拒）
- `commands` 消息的 `commands`/`path` 必须真实（async 函数要 await）
- `piConfigured` 前端据此隐藏/显示配置向导——ds-web-ui 已移除 pi 安装向导（PiSetupModal），
  但字段保留（isConfigured 反映 DSH key 状态）

### DSH 会话事件 → UI 消息映射

| DSH 事件 | UI |
|---|---|
| `agent/inbox/spliced` / `user/message` | 用户消息 |
| `assistant/chunk` (text/reasoning/tool-call delta) | 流式 streamingMessage |
| `assistant/message` | 助手消息（文本 + 思考块 + 工具调用块） |
| `tool/call` + `tool/result` | 工具结果消息 + tool_status |
| `session.status` (running/idle) | isStreaming |
| `turn/end` reason.error | 错误横幅 |

## 4.5 问题排查第一参考：官方仓库

遇到 DSH runtime / 协议 / 前端行为问题，**先看 `E:\deepseek-harness`**（官方 deepseek-ai/deepseek-harness 源码仓库，本机已 clone）：

- `apps/web/` + `packages/client/`：官方 web UI 完整实现（协议、组件、状态管理的事实来源）
- `packages/llm/llm-deepseek/`：模型目录、`DEFAULT_CONTEXT_WINDOW = 1_000_000` 等事实常量
- `packages/session*`、`packages/agent*`：会话持久化 / agent 生命周期（resume/create、id collision 等）
- `packages/examples/`：jsonrpc-demo（dsh-jsonrpc-agent Node 入口）、headless、acp 示例组合
- `python/sdk-runtime/`：SDK 捆绑 cordis.yml（本仓库 vendor/runtime/cordis.yml 的源头）
- `apps/cli/config/agent-presets/`：官方 agent 组合（bash/pwsh 平台切换、persona 等的正确写法）
- 官方 web 的 npm 包本体在 `node_modules/@deepseek-ai/*`（0.1.0-rc.6），问题定位先看这里；
  仓库源码更新（master）可能是 npm 发布版的后续

## 4.5 官方仓库参考（deepseek-ai/deepseek-harness）

本项目的 agent 后端（DSH runtime / 协议 / 插件组合）以官方实现为参照，**改 runtime 相关行为前，先对照官方仓库的正确写法再动手**，不要凭猜测改 cordis.yml / 协议字段。

- 仓库：https://github.com/deepseek-ai/deepseek-harness（本机已 clone 到 `E:\deepseek-harness`，upstream 指向官方）
- `apps/web/` + `packages/client/`：官方 web UI 完整实现（协议、组件、状态管理）
- `packages/llm/llm-deepseek/`：模型目录、`DEFAULT_CONTEXT_WINDOW = 1_000_000` 等事实常量
- `packages/session*`、`packages/agent*`：会话持久化 / agent 生命周期（create / resume）
- `packages/examples/jsonrpc-demo`：dsh-jsonrpc-agent Node 入口（本仓库 vendor/runtime launcher 的源头）
- `python/sdk-runtime/`：SDK 捆绑 cordis.yml（本仓库 vendor/runtime/cordis.yml 的源头）
- `apps/cli/config/agent-presets/`：官方 agent 组合（bash/pwsh 平台切换、persona 的正确写法）
- 已安装的 npm 包本体在 `node_modules/@deepseek-ai/*`（0.1.0-rc.6）；仓库 master 可能比 npm 发布版新

## 5. Windows 兼容性（踩过的坑，务必遵守）

1. **bin 入口必须有 `#!/usr/bin/env node` shebang**（`server/index.js` 第一行）。
   没有 shebang 时 npm 生成的 `.cmd` shim 不带 node 前缀 → Windows Script Host/JScript 报语法错误。
2. **路径补全/文件列表一律用正斜杠**发前端（`rel.split(sep).join("/")`），前端做严格相等比较。
3. **`~` 展开用 `os.homedir()`，不要用 `process.env.HOME`**（cmd/PowerShell 无 HOME，只有 USERPROFILE）。
4. **vendor/runtime 定位基于 `import.meta.url`（模块位置），不要用 `process.cwd()`**——
   全局安装/任意目录启动都会失败（切换目录时必现）。
5. 盘符输入 `E:`：在 `resolve` **之前**处理成 `E:\`（resolve 会把 `E:` 当盘相对路径）。
6. `spawn` .js launcher 时用 `process.execPath` 执行（Windows 不能直接 spawn .js）。
7. 测试端口时要确认监听 pid 与 `$!` 一致（Git Bash 下可能不同），残留进程会导致 EADDRINUSE 假象。
8. bash heredoc 写含 `\\` 的 JS 测试脚本会被吃掉反斜杠（`\W` 变成无效转义被忽略）——用 write 工具写测试文件。

## 6. 常见任务

- **改前端**：改 `web/src/`（React 源码），然后 `npm run build:web` 重建 `web/dist`。**不要手改 dist 压缩文件**。
- **品牌定制**：`web/src/components/TopBar.tsx`（brand-logo/brand-name）、`i18n.tsx`（文案）、
  `MessageList.tsx`（empty-logo）、`web/public/`（favicon/icon）。
- **改后端**：`server/*.js` 直接生效（`npm run dev` = `node --watch`）。
- **换模型/价格**：`server/agent-service.js` 顶部 `DSH_MODELS`、`DSH_CONTEXT_WINDOW`、`DSH_PRICE_*`。
- **升级 runtime**：`vendor/runtime/cordis.yml`（插件组合）+ dependencies 里的 `@deepseek-ai/dsh-*` 版本。
- **看日志**：runtime 子进程 stderr 会并入服务日志（dsh-client 的 stderrTail）。

## 7. 开发 / 构建 / 发布

```bash
npm install           # 依赖（含 DSH runtime 8 件套 + React 前端）
npm run dev           # node --watch 后端（http://localhost:8989，自动开浏览器）
npm run build:web     # vite 构建前端 → web/dist
npm run build         # 构建前端
node e2e-test.mjs     # 端到端冒烟（需服务运行 + 有效 key）

npm run release              # 一键发布（patch）
npm run release -- minor     # 或 minor/major
# 流程：npm version → npm publish（自动构建）→ git push --tags → gh release create（自动 changelog）
```

### 发布细节

- npm 包 `files` 白名单：`server/`、`web/dist/`、`vendor/runtime/`（2 个文件）、`README*`、`LICENSE`
- `prepublishOnly`/`prepack` 自动构建前端
- GitHub 分支是 **master**（不是 main）；截图用 jsdelivr `@master` 路径
- 仓库话题已加：`dsh-plugin`、`deepseek`、`dsh`、`web-ui`、`chat`、`coding-agent`

## 8. 配置与密钥

- API key 三选一：`DEEPSEEK_API_KEY` 环境变量 / `~/.ds-web/dsh-key.json` / 复用 `~/.pi/agent/auth.json`（deepseek.key）
- 环境变量：`DS_WEB_PORT`（默认 8989，兼容 `PORT`）、`DS_WEB_CWD`、`DS_WEB_DATA_DIR`、
  `DSH_RUNTIME_BIN`、`DSH_CORDIS_CONFIG`、`DEEPSEEK_BASE_URL`
- 端口优先级：`--port` 参数 > `DS_WEB_PORT` > `PORT` > 8989；`--no-open` 关闭自动开浏览器

## 9. 与 pi-web-ui 的差异（移植版注意）

- agent 后端：pi SDK（进程内）→ DSH runtime（子进程 JSON-RPC）
- 会话存储：`~/.ds-web/sessions/`（DSH JSONL）；无 pi 的模型管理/自更新
- 思考级别：DSH 由适配器控制，UI 仅提供 off；无中断（协议无 cancel）
- 前端源码跟随 pi-web-ui 上游，但**品牌、协议字段适配在 ds-web-ui 侧维护**，升级上游前先 diff `web/src/`
