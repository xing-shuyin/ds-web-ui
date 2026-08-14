# ds-web-ui

**English** | [简体中文](https://github.com/xing-shuyin/ds-web-ui/blob/master/README.md)

A web chat interface for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) — the agent runs
out-of-process via the official DSH stdio JSON-RPC runtime (pure Node, bundled)
and streams events to the browser over WebSocket. Chat with thinking blocks and
tool calls, attach files, use a built-in terminal, switch models, and more. The
UI is faithfully ported from [pi-web-ui](https://github.com/xing-shuyin/pi-web-ui).
Requires Node.js ≥ 22.19 and a valid DeepSeek API key.

## Screenshots

![ds-web-ui main interface](https://cdn.jsdelivr.net/gh/xing-shuyin/ds-web-ui@master/assets/shot.jpeg)

## Install

```bash
npm i -g ds-web-ui            # global install (recommended)
npx --yes ds-web-ui           # or run without installing (latest, starts on :8989)
npm i -g .                    # or install the local checkout
```

## Start

```bash
ds-web-ui                                           # foreground, http://localhost:8989
ds-web-ui --port 9099                               # custom port
DS_WEB_CWD=/path/to/project ds-web-ui               # custom workspace
```

Port precedence: `--port` argv > `DS_WEB_PORT` > `PORT` > 8989. The API key is
provided via the `DEEPSEEK_API_KEY` environment variable, `~/.ds-web/dsh-key.json`,
or automatically reused from `~/.pi/agent/auth.json`.

## Stop

- **Foreground**: press `Ctrl+C` in the terminal running it.

## Update

```bash
npm i -g ds-web-ui@latest     # upgrade to the latest published version
```

## Uninstall

```bash
npm uninstall -g ds-web-ui
```

Uninstalling does **not** delete your chats — session data lives in `~/.ds-web`
(or `DS_WEB_DATA_DIR`) and survives uninstall/upgrade.

## Run as a system service (auto-start on boot)

ds-web-ui has no built-in `server` subcommand yet; use [pm2](https://pm2.keymetrics.io/)
(cross-platform: Windows / macOS / Linux):

```bash
npm i -g pm2
pm2 start ds-web-ui --name ds-web-ui -- --port 9000    # start
pm2 save                                                # persist the process list
pm2 startup                                             # enable auto-start (run the printed command)
pm2 status / pm2 logs ds-web-ui / pm2 restart ds-web-ui
```

For a custom port or workspace: `pm2 start ds-web-ui -- --port 9000`,
`pm2 start ds-web-ui -- --port 9099 --cwd /path/to/project` (or pass `DS_WEB_CWD`
as an env var). systemd (Linux), launchd (macOS), and Task Scheduler (Windows)
also work.

## License

MIT
