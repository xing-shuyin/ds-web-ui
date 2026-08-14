# ds-web-ui

Web 聊天界面，为 **DeepSeek Harness (DSH)** 打造。UI 从 [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui) 忠实移植（同一个前端产物、同一套 WebSocket 协议，样式/交互 100% 还原）；agent 后端从 pi SDK 换成了 **DSH stdio JSON-RPC runtime**。**全 JavaScript，零 Python 依赖。**

## 特性

- 💬 聊天：流式输出、思考块（reasoning）、工具调用块、工具结果展示、错误透传
- 🖥️ 内置终端：xterm.js + node-pty，支持 `.pi/commands.json` 快捷命令
- 📁 文件树 + 预览面板：图片/视频/文本预览，文件变更自动刷新
- 💾 会话管理：DSH JSONL 持久化，重启后可恢复/切换历史会话
- 🔀 多对话并行：新聊天不中断进行中的回合
- 📊 状态栏：token 用量统计
- ⚙️ 模型切换：deepseek-v4-flash / deepseek-v4-pro

## 快速开始

```bash
npm install          # 安装依赖
export DEEPSEEK_API_KEY="sk-..."     # 或写入 ~/.ds-web/dsh-key.json
npm start            # http://localhost:8989
```

### API Key 配置（三选一）

1. 环境变量：`DEEPSEEK_API_KEY`（runtime 子进程自动继承）
2. 密钥文件：`~/.ds-web/dsh-key.json`
   ```json
   { "apiKey": "sk-...", "baseUrl": "https://..." }
   ```
3. 自动复用 pi 的凭据：若存在 `~/.pi/agent/auth.json` 且含 `deepseek.key`，自动注入

### DSH runtime 二进制

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
dsh-jsonrpc-agent（官方单文件 runtime，spawn 子进程）
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

## 与 pi-web-ui 的差异

- agent 后端：pi SDK（进程内）→ DSH runtime（子进程 JSON-RPC）
- 会话存储：`~/.pi/agent/sessions/` → `~/.ds-web/sessions/`（DSH JSONL 格式）
- 模型：pi 多模型 → DSH 内置 DeepSeek 适配器（deepseek-v4-*）
- 思考级别：DSH 由适配器控制，UI 仅提供 off
- 无中断：DSH 协议暂无 cancel 方法（abort 会提示）
- 无应用内自更新

## 开发

```bash
npm run dev        # node --watch
node e2e-test.mjs  # 端到端冒烟（需已启动服务 + 有效 key）
```

## License

MIT
