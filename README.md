# ds-web-ui

A web chat interface for **DeepSeek Harness (DSH)** — the agent runs out-of-process
via the official DSH stdio JSON-RPC runtime (bundled in pure Node, works on
Windows / macOS / Linux) and streams events to the browser over WebSocket. The UI
is faithfully ported from [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui)
(same front-end bundle, same WebSocket protocol, 100% restored styling and
interaction); the agent backend is swapped from the pi SDK to the **DSH runtime**.
All JavaScript, no Python.

## Screenshots

![ds-web-ui main interface](https://cdn.jsdelivr.net/gh/xing-shuyin/ds-web-ui@master/assets/shot.png)

## 特性

- 💬 聊天：流式输出、思考块（reasoning）、工具调用块、工具结果展示、错误透传
- 🖥️ 内置终端：xterm.js + node-pty，支持 `.pi/commands.json` 快捷命令
- 📁 文件树 + 预览面板：图片/视频/文本预览，文件变更自动刷新
- 💾 会话管理：DSH JSONL 持久化，重启后可恢复/切换历史会话
- 🔀 多对话并行：新聊天不中断进行中的回合
- 📊 状态栏：token 用量、上下文占用（1M 窗口）、花费估算
- ⚙️ 模型切换：deepseek-v4-flash / deepseek-v4-pro

## Install

```bash
npm i -g ds-web-ui            # 全局安装（推荐）
npx --yes ds-web-ui           # 或免安装直接运行（最新版，默认 :8989）
git clone git@github.com:xing-shuyin/ds-web-ui.git && cd ds-web-ui && npm install
```

## Start

```bash
ds-web-ui                                  # 前台运行，http://localhost:8989
ds-web-ui --port 9099                      # 指定端口
DS_WEB_CWD=/path/to/project ds-web-ui      # 指定工作区
```

端口优先级：`--port` 参数 > `DS_WEB_PORT` > `PORT` > 8989。

## API Key 配置（三选一）

1. 环境变量：`DEEPSEEK_API_KEY`（runtime 子进程自动继承）
2. 密钥文件：`~/.ds-web/dsh-key.json`
   ```json
   { "apiKey": "sk-...", "baseUrl": "https://..." }
   ```
3. 自动复用 pi 的凭据：若存在 `~/.pi/agent/auth.json` 且含 `deepseek.key`，自动注入

## DSH runtime 二进制

后端 spawn 官方 `dsh-jsonrpc-agent`（stdio JSON-RPC）。项目自带 **Node 版 runtime**（`vendor/runtime/`，Windows/macOS/Linux 均可直接运行，无需 Python），按顺序探测：

1. `DSH_RUNTIME_BIN` 环境变量
2. 项目 `vendor/runtime/`（自带 Node 启动器 + cordis.yml + `@deepseek-ai/dsh-sdk-jsonrpc-*` 插件，随 npm install 安装）
3. `pip install deepseek-harness-sdk` 安装的 Python 单文件 runtime（`deepseek_harness_runtime/runtime/dsh-jsonrpc-agent-*`，仅 Linux/macOS）

`cordis.yml` 默认取 runtime 同目录的捆绑配置；可用 `DSH_CORDIS_CONFIG` 覆盖。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DS_WEB_PORT` | 8989 | HTTP 端口（兼容 `PORT`） |
| `DS_WEB_CWD` | 进程 cwd | agent 工作目录 |
| `DS_WEB_DATA_DIR` | `~/.ds-web` | 会话 JSONL、客户端状态、密钥文件 |
| `DSH_RUNTIME_BIN` | 自动探测（vendor/runtime 自带） | runtime 可执行路径 |
| `DSH_CORDIS_CONFIG` | runtime 旁 cordis.yml | DSH 插件组合配置 |
| `DEEPSEEK_API_KEY` | - | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | 官方 API | 可指向本地代理 |

## 与 pi-web-ui 的差异

- agent 后端：pi SDK（进程内）→ DSH runtime（子进程 JSON-RPC）
- 会话存储：`~/.pi/agent/sessions/` → `~/.ds-web/sessions/`（DSH JSONL 格式）
- 模型：pi 多模型 → DSH 内置 DeepSeek 适配器（deepseek-v4-*）
- 思考级别：DSH 由适配器控制，UI 仅提供 off
- 无中断：DSH 协议暂无 cancel 方法（abort 会提示）
- 无应用内自更新

## 架构

```
浏览器 (pi-web-ui 前端产物)
   │  WebSocket /ws  (pi-web-ui 协议：snapshot/tool_delta/terminal_* ...)
   ▼
server/index.js  ── Express + ws ── 静态前端 + /api/file 预览
   │
server/agent-service.js  ── 每客户端一个会话；DSH 事件 → UI 快照（60ms 节流）
   │
server/dsh-client.js  ── stdio JSON-RPC 2.0（newline-delimited）
   ▼
dsh-jsonrpc-agent（官方 Node runtime，spawn 子进程，vendor/runtime 自带）
   │  session.event / session.status / subagent.*
   ▼
DeepSeek V4 模型
```

DSH 会话事件 → UI 消息映射：

| DSH 事件 | UI |
|---|---|
| `agent/inbox/spliced` / `user/message` | 用户消息 |
| `assistant/chunk` (text/reasoning/tool-call delta) | 流式 streamingMessage |
| `assistant/message` | 助手消息（文本 + 思考块 + 工具调用块） |
| `tool/call` + `tool/result` | 工具结果消息 + tool_status |
| `session.status` (running/idle) | isStreaming |
| `turn/end` reason.error | 错误横幅 |

## 开发

```bash
npm install
npm run dev        # node --watch 后端
npm run build:web  # vite 从 web/src 构建前端 → web/dist
npm run build      # 构建前端
node e2e-test.mjs  # 端到端冒烟（需已启动服务 + 有效 key）
```

前端源码在 `web/src/`（React + Vite，从 pi-web-ui 0.16.2 照搬），品牌定制（D logo、ds-web-ui 文案）均在源码层，重建不丢失。

## License

MIT
