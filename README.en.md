# ds-web-ui

**English** | [简体中文](README.md)

A web chat interface for **DeepSeek Harness (DSH)** — the agent runs out-of-process
via the official DSH stdio JSON-RPC runtime (pure Node, bundled, works on
Windows / macOS / Linux) and streams events to the browser over WebSocket. The UI
is faithfully ported from [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui)
(same front-end bundle, same WebSocket protocol, 100% restored styling and
interaction); the agent backend is swapped from the pi SDK to the **DSH runtime**.
All JavaScript, no Python.

## Screenshots

![ds-web-ui main interface](https://cdn.jsdelivr.net/gh/xing-shuyin/ds-web-ui@master/assets/shot.jpeg)

## Features

- 💬 Chat: streaming output, thinking (reasoning) blocks, tool-call blocks, tool results, error pass-through
- 🖥️ Built-in terminal: xterm.js + node-pty, with `.pi/commands.json` quick commands
- 📁 File tree + preview panel: image/video/text preview, auto-refresh on file change
- 💾 Session management: DSH JSONL persistence, history sessions recoverable after restart
- 🔀 Parallel conversations: a new chat does not interrupt an in-flight turn
- 📊 Status bar: token usage, context occupancy (1M window), cost estimate
- ⚙️ Model switching: deepseek-v4-flash / deepseek-v4-pro

## Install

```bash
npm i -g ds-web-ui            # global install (recommended)
npx --yes ds-web-ui           # run without installing (latest, default :8989)
git clone git@github.com:xing-shuyin/ds-web-ui.git && cd ds-web-ui && npm install
```

## Start

```bash
ds-web-ui                                  # foreground, http://localhost:8989
ds-web-ui --port 9099                      # custom port
DS_WEB_CWD=/path/to/project ds-web-ui      # custom workspace
```

Port precedence: `--port` argv > `DS_WEB_PORT` > `PORT` > 8989.

## API Key configuration (pick one)

1. Environment variable: `DEEPSEEK_API_KEY` (inherited by the runtime subprocess)
2. Key file: `~/.ds-web/dsh-key.json`
   ```json
   { "apiKey": "sk-...", "baseUrl": "https://..." }
   ```
3. Reuse pi credentials: if `~/.pi/agent/auth.json` exists and contains `deepseek.key`, it is injected automatically

## DSH runtime binary

The backend spawns the official `dsh-jsonrpc-agent` (stdio JSON-RPC). A **Node runtime** is bundled in `vendor/runtime/` (runs on Windows/macOS/Linux, no Python). Resolution order:

1. `DSH_RUNTIME_BIN` environment variable
2. Project `vendor/runtime/` (bundled Node launcher + cordis.yml + `@deepseek-ai/dsh-sdk-jsonrpc-*` plugins, installed via npm)
3. Python single-file runtime from `pip install deepseek-harness-sdk` (`deepseek_harness_runtime/runtime/dsh-jsonrpc-agent-*`, Linux/macOS only)

`cordis.yml` defaults to the bundled config next to the runtime; override with `DSH_CORDIS_CONFIG`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DS_WEB_PORT` | 8989 | HTTP port (falls back to `PORT`) |
| `DS_WEB_CWD` | process cwd | agent workspace |
| `DS_WEB_DATA_DIR` | `~/.ds-web` | session JSONL, client state, key file |
| `DSH_RUNTIME_BIN` | auto-detect (bundled) | runtime executable path |
| `DSH_CORDIS_CONFIG` | cordis.yml next to runtime | DSH plugin composition config |
| `DEEPSEEK_API_KEY` | - | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | official API | point to a local proxy |

## Differences from pi-web-ui

- Agent backend: pi SDK (in-process) → DSH runtime (child-process JSON-RPC)
- Session storage: `~/.pi/agent/sessions/` → `~/.ds-web/sessions/` (DSH JSONL)
- Models: pi multi-model → DSH built-in DeepSeek adapter (deepseek-v4-*)
- Thinking level: controlled by the DSH adapter; the UI only offers off
- No cancellation: the DSH protocol has no cancel method yet (abort shows a notice)
- No in-app self-update

## Architecture

```
Browser (pi-web-ui front-end bundle)
   │  WebSocket /ws  (pi-web-ui protocol: snapshot/tool_delta/terminal_* ...)
   ▼
server/index.js  ── Express + ws ── static front-end + /api/file preview
   │
server/agent-service.js  ── one session per client; DSH events → UI snapshot (60ms throttle)
   │
server/dsh-client.js  ── stdio JSON-RPC 2.0 (newline-delimited)
   ▼
dsh-jsonrpc-agent (official Node runtime, spawned child process, bundled in vendor/runtime)
   │  session.event / session.status / subagent.*
   ▼
DeepSeek V4 model
```

DSH session events → UI messages:

| DSH event | UI |
|---|---|
| `agent/inbox/spliced` / `user/message` | user message |
| `assistant/chunk` (text/reasoning/tool-call delta) | streaming message |
| `assistant/message` | assistant message (text + thinking block + tool-call blocks) |
| `tool/call` + `tool/result` | tool-result message + tool_status |
| `session.status` (running/idle) | isStreaming |
| `turn/end` reason.error | error banner |

## Development

```bash
npm install
npm run dev        # node --watch backend
npm run build:web  # vite build web/src → web/dist
npm run build      # build the front-end
node e2e-test.mjs  # end-to-end smoke test (needs a running server + valid key)
```

The front-end source lives in `web/src/` (React + Vite, ported from pi-web-ui 0.16.2); all branding (D logo, ds-web-ui copy) is applied at the source level and survives rebuilds.

## License

MIT
