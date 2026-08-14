/**
 * ds-web-ui server entry — Web chat interface for DeepSeek Harness (DSH).
 *
 * UI faithfully ported from pi-web-ui (same frontend bundle, same WebSocket
 * protocol); the agent backend is swapped from the pi SDK to the DSH runtime
 * spawned over stdio JSON-RPC (server/dsh-client.js). All JavaScript.
 *
 * Env:
 *   PORT            HTTP port (default 8787)
 *   DS_WEB_CWD      workspace the agent operates in (default: process.cwd())
 *   DS_WEB_DATA_DIR per-client UI state + DSH session JSONL + dsh-key.json
 *                   (default: <home>/.ds-web)
 *   DSH_RUNTIME_BIN explicit path to the dsh-jsonrpc-agent executable
 *   DSH_CORDIS_CONFIG explicit cordis.yml (defaults: next to the runtime)
 *   DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL — inherited by the runtime
 */
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { AgentService, previewKind, workspacePath } from "./agent-service.js";

const PORT = Number(process.env.PORT ?? 8787);
const CWD = resolve(process.env.DS_WEB_CWD ?? process.cwd());
const DATA_DIR = resolve(process.env.DS_WEB_DATA_DIR ?? join(homedir(), ".ds-web"));
const SESSION_DIR_ROOT = join(DATA_DIR, "sessions");

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
	res.json({ ok: true, dsh: true, cwd: CWD, pid: process.pid });
});

/** Stream a workspace file over HTTP (media preview / download). */
app.get("/api/file", async (req, res) => {
	try {
		const raw = typeof req.query.path === "string" ? req.query.path : "";
		const cid = typeof req.query.clientId === "string" ? req.query.clientId : "";
		const cs = cid ? service.get(cid) : undefined;
		const wp = workspacePath(cs?.cwd ?? CWD, raw);
		if (!wp) {
			res.status(400).end("path outside workspace");
			return;
		}
		const abs = wp.abs;
		const name = basename(abs);
		const kind = previewKind(name);
		const isDownload = req.query.download === "1";
		if (!isDownload && kind !== "image" && kind !== "video") {
			res.status(400).end("not a previewable media file");
			return;
		}
		const st = await stat(abs);
		if (!st.isFile()) {
			res.status(400).end("not a file");
			return;
		}
		if (isDownload) {
			res.download(abs, name);
		} else {
			res.sendFile(abs);
		}
	} catch {
		res.status(404).end("not found");
	}
});

// Serve the built frontend (web/dist) — the pi-web-ui bundle, unchanged.
const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/server
const pkgRoot = resolve(here, "..");
const webDist = join(pkgRoot, "web", "dist");
if (existsSync(webDist)) {
	app.use(express.static(webDist));
	app.get(/^\/(?!api\/|ws).*/, (_req, res) => {
		res.sendFile(join(webDist, "index.html"));
	});
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const heartbeatTimer = setInterval(() => {
	for (const ws of wss.clients) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "heartbeat" }));
		}
	}
}, 10_000);

const service = new AgentService(CWD, join(DATA_DIR, "client-state.json"));

wss.on("connection", (ws) => {
	let clientId = null;
	let closed = false;
	let pending = [];

	const send = (msg) => {
		if (!closed && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	};

	const dispatch = (msg) => {
		if (!clientId) {
			pending.push(msg);
			return;
		}
		const cs = service.get(clientId);
		if (!cs) {
			pending.push(msg);
			return;
		}
		switch (msg.type) {
			case "prompt":
				void cs.prompt(msg.text, msg.attachments);
				break;
			case "abort":
				void cs.abort();
				break;
			case "new_chat":
				void cs.newChat();
				break;
			case "edit_message":
				void cs.editMessage(msg.messageId, msg.text);
				break;
			case "cycle_model":
				void cs.cycleModel();
				break;
			case "cycle_thinking":
				cs.cycleThinking();
				break;
			case "get_state":
				cs.flushSnapshot();
				break;
			case "get_commands":
				void cs.pushSlashCommands();
				break;
			case "list_sessions":
				void cs.refreshSessions();
				break;
			case "list_projects":
				void cs.pushProjects();
				break;
			case "switch_session":
				void cs.switchSession(msg.path);
				break;
			case "switch_conversation":
				void cs.switchConversation(msg.id);
				break;
			case "list_files":
				void cs.listFiles(msg.path);
				break;
			case "read_file":
				void cs.readFile(msg.path);
				break;
			case "list_models":
				void cs.listModels();
				break;
			case "set_model":
				void cs.setModel(msg.modelId);
				break;
			case "set_thinking":
				cs.setThinking(msg.level);
				break;
			case "set_cwd":
				void cs.setCwd(msg.path);
				break;
			case "complete_path":
				void cs.completePath(msg.path);
				break;
			case "dialog_response":
				cs.resolveDialog(msg.id, msg.value);
				break;
			case "install_pi_agent":
				void cs.installPiAgent();
				break;
			case "set_provider_api_key":
				void cs.setProviderApiKey(msg.provider, msg.apiKey);
				break;
			case "list_models_config":
				void cs.listModelsConfig();
				break;
			case "save_model_config":
				void cs.saveModelConfig(msg.providerId, msg.config);
				break;
			case "delete_model_config":
				void cs.deleteModelConfig(msg.providerId);
				break;
			case "list_providers":
				void cs.listProviders();
				break;
			case "check_update":
				void cs.checkUpdate();
				break;
			case "update_app":
				void cs.updateApp();
				break;
			case "terminal_create":
				cs.terminals.create(msg.terminalId, msg.cwd, msg.cols, msg.rows, cs.cwd);
				break;
			case "terminal_input":
				cs.terminals.input(msg.terminalId, msg.data);
				break;
			case "terminal_resize":
				cs.terminals.resize(msg.terminalId, msg.cols, msg.rows);
				break;
			case "terminal_kill":
				cs.terminals.kill(msg.terminalId);
				break;
			case "run_command":
				cs.terminals.runCommand(msg.terminalId, msg.command, msg.cols, msg.rows, cs.cwd);
				break;
			case "list_commands":
				void cs.listCommands();
				break;
			case "save_commands":
				void cs.saveCommands(msg.commands);
				break;
			default:
				break;
		}
	};

	ws.on("message", (data) => {
		let msg;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return;
		}
		if (msg.type === "hello") {
			const cid = msg.clientId || randomUUID();
			clientId = cid;
			service
				.attach(cid, send)
				.then((cs) => {
					if (closed) return;
					send({ type: "ready", clientId: cid, serverVersion: "0.1.0" });
					cs.flushSnapshot();
					const queued = pending;
					pending = [];
					for (const m of queued) dispatch(m);
				})
				.catch((err) => {
					send({
						type: "notice",
						level: "error",
						text: `会话初始化失败：${err.message}`,
					});
				});
			return;
		}
		dispatch(msg);
	});

	ws.on("close", () => {
		closed = true;
		pending = [];
		if (clientId) service.detach(clientId, send);
	});
});

httpServer.listen(PORT, () => {
	console.log("");
	console.log("  ⚡ ds-web-ui — web chat for DeepSeek Harness");
	console.log(`    http://localhost:${PORT}`);
	console.log(`    workspace   : ${CWD}`);
	console.log(`    session dir : ${SESSION_DIR_ROOT}`);
	console.log("");
});

let shuttingDown = false;
async function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log("\nshutting down…");
	clearInterval(heartbeatTimer);
	await service.disposeAll();
	wss.close();
	httpServer.close();
	process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
