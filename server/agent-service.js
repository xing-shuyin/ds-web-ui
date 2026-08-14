/**
 * agent-service.js — DeepSeek Harness backend for the pi-web-ui style frontend.
 *
 * Each browser client (identified by a persistent clientId) owns one DSH
 * runtime subprocess (stdio JSON-RPC) and one or more conversations. A
 * conversation maps 1:1 to a DSH session id; sessions persist as JSONL under
 * <dataDir>/sessions/ and are replayed on resume, so the conversation list
 * survives restarts.
 *
 * Streaming model: DSH pushes `session.event` notifications (turn/start,
 * assistant/chunk, assistant/message, tool/call, tool/result, …) and
 * `session.status` (running/idle). We fold them into a per-conversation
 * UiMessage list plus a live streaming message, then schedule throttled
 * full-state snapshots — the same snapshot-driven frontend contract the
 * pi-web-ui protocol defines.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	readFileSync,
	statSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	watch,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { DshRuntime, DshRpcError, DshTransportError } from "./dsh-client.js";
import {
	dshMessageToUiMessage,
	buildStreamingUiMessage,
	serializeAssistantContent,
} from "./serialize.js";
import {
	loadCommands,
	saveCommandsFile,
	TerminalManager,
} from "./terminals.js";

const SNAPSHOT_INTERVAL_MS = 60;
const WIDGET_REFRESH_MS = 2000;
/** Preview panel cap: only the first 512KB of a file is ever read/sent. */
const MAX_PREVIEW_BYTES = 512 * 1024;
/** Cap on simultaneously open conversations (each keeps session state alive). */
const MAX_OPEN_CONVERSATIONS = 8;
const DEFAULT_CONV_TITLE = "新对话";
/** DSH model options offered in the top bar model picker. */
const DSH_MODELS = [
	{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek" },
	{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek" },
];
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_PROVIDER = "deepseek-official";

// ---------------------------------------------------------------------------
// Preview kind classification (from pi-web-ui)
// ---------------------------------------------------------------------------

const PREVIEW_IMAGE_EXTS = new Set([
	"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "jfif",
	"tif", "tiff",
]);
const PREVIEW_VIDEO_EXTS = new Set([
	"mp4", "webm", "mov", "mkv", "avi", "m4v", "ogv", "mpg", "mpeg", "wmv", "flv",
]);
const PREVIEW_TEXT_EXTS = new Set([
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "jsm", "es6", "vue", "svelte", "py",
	"pyw", "ipynb", "go", "rs", "c", "h", "cpp", "hpp", "cc", "cxx", "java",
	"kt", "kts", "swift", "rb", "php", "cs", "fs", "fsx", "sh", "bash", "zsh",
	"fish", "ps1", "bat", "cmd", "toml", "yaml", "yml", "json", "jsonc",
	"xml", "html", "htm", "css", "scss", "sass", "less", "md", "markdown",
	"txt", "log", "csv", "tsv", "ini", "cfg", "conf", "env", "sql", "graphql",
	"proto", "dockerfile", "makefile", "cmake", "gradle", "lock", "diff", "patch",
	"editorconfig", "gitignore", "gitattributes", "nix", "tf", "tfvars", "lua",
	"r", "jl", "dart", "ex", "exs", "erl", "hrl", "clj", "cljs", "zig", "v",
	"hs", "ml", "mli", "scala", "groovy", "coffee", "styl", "tex", "bib",
	"rst", "adoc", "asciidoc", "m", "mm", "pl", "pm", "t", "s", "asm", "f",
	"f90", "f95", "vb", "vbs", "ahk", "bat", "ps1", "m4", "ninja", "mk",
]);
const PREVIEW_NONE_EXTS = new Set([
	"exe", "msi", "dll", "so", "dylib", "bin", "iso", "img", "jar", "war",
	"zip", "gz", "bz2", "xz", "7z", "rar", "tar", "pdf", "doc", "docx", "xls",
	"xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub", "apk", "ipa", "deb",
	"rpm", "dmg", "pkg", "class", "pyc", "wasm", "woff", "woff2", "ttf", "otf",
	"eot", "mp3", "wav", "ogg", "flac", "aac", "m4a", "webm", "3gp", "mkv",
]);
const MAX_LIST_ENTRIES = process.platform === "win32" ? 2000 : 500;

export function previewKind(name) {
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	if (PREVIEW_IMAGE_EXTS.has(ext)) return "image";
	if (PREVIEW_VIDEO_EXTS.has(ext)) return "video";
	if (PREVIEW_TEXT_EXTS.has(ext)) return "text";
	if (PREVIEW_NONE_EXTS.has(ext)) return "none";
	if (!ext) return "text";
	return "none";
}

/** Resolve a workspace-relative request path safely. Returns {abs, rel} or null. */
export function workspacePath(wsRoot, raw) {
	if (!wsRoot || typeof raw !== "string") return null;
	const root = resolve(wsRoot);
	const rel = raw.trim();
	// Empty/whitespace path = the workspace root itself (front-end root request).
	if (rel === "") return { abs: root, rel: "" };
	const abs = resolve(root, rel);
	if (abs !== root && !abs.startsWith(root + sep)) return null;
	return { abs, rel: relative(root, abs) };
}

function listDirSafe(abs, wsRoot) {
	try {
		const entries = readdirSync(abs, { withFileTypes: true })
			.filter((e) => !e.name.startsWith(".git"))
			.map((e) => {
				const full = join(abs, e.name);
				let kind;
				if (e.isDirectory()) {
					kind = undefined;
				} else {
					kind = previewKind(e.name);
				}
				return {
					name: e.name,
					path: relative(wsRoot, full).split(sep).join("/"),
					type: e.isDirectory() ? "dir" : "file",
					kind,
				};
			});
		const truncated = entries.length > MAX_LIST_ENTRIES;
		return { entries: entries.slice(0, MAX_LIST_ENTRIES), truncated };
	} catch {
		return { entries: [], truncated: false };
	}
}

// ---------------------------------------------------------------------------
// Per-client persisted UI state (last workspace + recent projects)
// ---------------------------------------------------------------------------

class ClientStateStore {
	constructor(file) {
		this.file = file;
		this.state = { projects: [] };
		try {
			this.state = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			this.state = { projects: [] };
		}
	}

	save() {
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(this.file, JSON.stringify(this.state, null, 2));
		} catch {
			// best-effort
		}
	}

	recordProject(cwd) {
		const now = Date.now();
		this.state.projects = [
			{ path: cwd, lastUsed: now },
			...this.state.projects.filter((p) => p.path !== cwd),
		].slice(0, 30);
		this.save();
	}

	get projects() {
		return this.state.projects ?? [];
	}
}

// ---------------------------------------------------------------------------
// DSH session-log replay (JSONL) helpers
// ---------------------------------------------------------------------------

/** Decode one JSONL line value into session events (expands packed chunk rows). */
function decodeStorageRecord(value) {
	if (!value || typeof value !== "object") return [];
	const t = value.type;
	if (t === "text-chunks" || t === "reasoning-chunks" || t === "tool-call-chunks") {
		const { seq0, time0, data } = value;
		if (!data || !Array.isArray(data.texts) && !Array.isArray(data.args)) return [];
		const count =
			t === "tool-call-chunks" ? (data.args ?? []).length : (data.texts ?? []).length;
		const events = [];
		let time = time0;
		for (let k = 0; k < count; k++) {
			if (k > 0 && Array.isArray(data.dt) && k - 1 < data.dt.length) {
				time += data.dt[k - 1];
			}
			const chunk =
				t === "text-chunks"
					? { type: "text-delta", index: data.index, text: data.texts[k] }
					: t === "reasoning-chunks"
						? { type: "reasoning-delta", index: data.index, text: data.texts[k] }
						: {
								type: "tool-call-delta",
								index: data.index,
								id: data.id,
								name: data.name,
								argumentsDelta: data.args[k],
							};
			events.push({
				type: "assistant/chunk",
				seq: seq0 + k,
				time,
				data: { turn: data.turn, step: data.step, chunk },
			});
		}
		return events;
	}
	return [value];
}

/** Read a session JSONL file → { header, events } (events in log order). */
export function readSessionLog(file) {
	const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
	let header = null;
	const events = [];
	for (const line of lines) {
		let value;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (!value || typeof value !== "object") continue;
		if (value.type === "session") {
			header = value;
			continue;
		}
		for (const ev of decodeStorageRecord(value)) events.push(ev);
	}
	return { header, events };
}

/** Recursively find *.jsonl session files under root. */
export function findSessionFiles(root) {
	if (!existsSync(root)) return [];
	const out = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (e.name.endsWith(".jsonl")) out.push(full);
		}
	};
	walk(root);
	return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** First user text in a list of DSH events, truncated for the session title. */
function eventsTitle(events) {
	for (const ev of events) {
		if (ev.type === "user/message") {
			const blocks = ev.data?.content;
			if (Array.isArray(blocks)) {
				for (const b of blocks) {
					if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
						const t = b.text.trim().replace(/\s+/g, " ");
						return t.length > 30 ? `${t.slice(0, 30)}…` : t;
					}
				}
			}
		}
	}
	return DEFAULT_CONV_TITLE;
}

// ---------------------------------------------------------------------------
// One conversation (chat thread) — maps 1:1 to a DSH session id
// ---------------------------------------------------------------------------

class Conversation {
	constructor(client, id, sessionId) {
		this.client = client;
		this.id = id;
		this.sessionId = sessionId;
		this.title = DEFAULT_CONV_TITLE;
		this.createdAt = Date.now();
		this.listed = false;
		this.promptedSinceActive = false;
		this.lastActiveAt = Date.now();

		// UI message list (ordered) + dedupe index.
		this.messages = [];
		this.msgIndex = new Map(); // uiId -> UiMessage
		// Streaming accumulator for the in-progress assistant turn.
		this.stream = null; // { text, thinking, toolCalls[], timestamp, model, provider }
		this.isStreaming = false;
		// tool call meta (tool/result → toolName).
		this.toolNames = new Map(); // callId -> name
		this.toolStartTimes = new Map(); // callId -> ts
		this.queueSteering = 0;
		this.queueFollowUp = 0;
		this.errorMessage = undefined;
		this.model = DEFAULT_MODEL;
		this.provider = DEFAULT_PROVIDER;
		// token stats
		this.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
		this.lastPromptMessageId = null;
	}

	/** Upsert a UiMessage by id (stable ids from DSH message ids). */
	_push(msg) {
		if (!msg || !msg.id) return;
		const existing = this.msgIndex.get(msg.id);
		if (existing) {
			const i = this.messages.indexOf(existing);
			if (i !== -1) this.messages[i] = msg;
		} else {
			this.msgIndex.set(msg.id, msg);
			this.messages.push(msg);
		}
		this._refreshTitle();
	}

	_refreshTitle() {
		if (this.title !== DEFAULT_CONV_TITLE) return;
		for (const m of this.messages) {
			if (m.role === "user") {
				const t = m.content
					.map((c) => (c.type === "text" ? c.text : ""))
					.join("")
					.trim()
					.replace(/\s+/g, " ");
				if (t) {
					this.title = t.length > 30 ? `${t.slice(0, 30)}…` : t;
					return;
				}
			}
		}
	}

	// -- DSH session event folding ------------------------------------------

	/** Handle one session.event notification payload. */
	onSessionEvent(ev) {
		switch (ev.type) {
			case "agent/inbox/spliced": {
				// Queued user messages entering the inbox.
				const inserted = Array.isArray(ev.data?.inserted) ? ev.data.inserted : [];
				for (const m of inserted) {
					if (!m || typeof m !== "object" || !m.id) continue;
					if (m.source?.kind && m.source.kind !== "user") continue;
					this._push(dshMessageToUiMessage({ ...m, time: ev.time }));
				}
				break;
			}
			case "user/message": {
				// Model-visible user message. Only surface direct human prompts
				// (injections stay hidden, like pi's attachment asides).
				const src = ev.data?.source;
				if (src?.kind && src.kind !== "user") break;
				const msg = dshMessageToUiMessage({ ...ev.data, time: ev.time });
				if (msg) this._push(msg);
				break;
			}
			case "assistant/chunk": {
				this._ensureStream(ev);
				const chunk = ev.data?.chunk;
				if (!chunk) break;
				switch (chunk.type) {
					case "text-delta":
						this.stream.text += chunk.text ?? "";
						break;
					case "reasoning-delta":
						this.stream.thinking += chunk.text ?? "";
						break;
					case "tool-call-delta": {
						let tc = this.stream.toolCalls.find((c) => c.id === chunk.id);
						if (!tc) {
							tc = { id: chunk.id, name: chunk.name, arguments: "" };
							this.stream.toolCalls.push(tc);
						}
						if (chunk.name) tc.name = chunk.name;
						tc.arguments += chunk.argumentsDelta ?? "";
						this.toolNames.set(chunk.id, chunk.name ?? tc.name);
						break;
					}
					case "block-end": {
						// Assemble the finished block into the stream immediately.
						const block = chunk.block;
						if (block?.type === "text") {
							this.stream.text = block.text ?? "";
						} else if (block?.type === "reasoning") {
							this.stream.thinking = block.text ?? "";
						} else if (block?.type === "tool-call") {
							const i = this.stream.toolCalls.findIndex((c) => c.id === block.id);
							const tc = {
								id: block.id,
								name: block.name,
								arguments: block.arguments ?? "",
							};
							if (i === -1) this.stream.toolCalls.push(tc);
							else this.stream.toolCalls[i] = tc;
							this.toolNames.set(block.id, block.name);
						}
						break;
					}
					default:
						break;
				}
				break;
			}
			case "assistant/message": {
				// Final assembled assistant message — commits the stream and
				// pushes the complete message (with tool-call blocks).
				const m = ev.data?.message;
				if (m) {
					const modelSrc = m.source;
					const ui = dshMessageToUiMessage({
						...m,
						time: ev.time,
						model: modelSrc?.model ?? this.model,
						provider: modelSrc?.provider ?? this.provider,
					});
					if (ui) {
						this._push(ui);
						this.model = modelSrc?.model ?? this.model;
						this.provider = modelSrc?.provider ?? this.provider;
					}
					// Commit usage accounting.
					const usage = ev.data?.usage;
					if (usage) this._addUsage(usage);
				}
				this.stream = null;
				break;
			}
			case "tool/call": {
				const { callId, name } = ev.data ?? {};
				if (callId) this.toolNames.set(callId, name);
				if (callId) this.toolStartTimes.set(callId, Date.now());
				break;
			}
			case "tool/result": {
				const msg = ev.data?.message;
				if (msg) {
					const tr = dshMessageToUiMessage({ ...msg, time: ev.time });
					if (tr) {
						const callId = tr.toolCallId;
						tr.toolName = this.toolNames.get(callId) ?? tr.toolName;
						this._push(tr);
						this.client.emitToolStatus(callId, tr.toolName, tr.isError);
					}
				}
				break;
			}
			case "turn/start": {
				this._ensureStream(ev);
				break;
			}
			case "turn/end": {
				const reason = ev.data?.reason;
				if (reason?.kind === "error") {
					this.errorMessage =
						reason.error?.message ?? "回合失败（provider 错误）";
				} else {
					this.errorMessage = undefined;
				}
				this.stream = null;
				break;
			}
			case "request/header": {
				const cfg = ev.data?.header?.config;
				if (cfg) {
					if (cfg.model) this.model = cfg.model;
					if (cfg.provider) this.provider = cfg.provider;
				}
				break;
			}
			case "session/end-seed":
			case "todo/write":
			case "step/start":
			case "step/end":
			case "request/context":
			default:
				break;
		}
		this.client.scheduleSnapshot();
	}

	_ensureStream(ev) {
		if (!this.stream) {
			this.stream = {
				text: "",
				thinking: "",
				toolCalls: [],
				timestamp: ev.time ?? Date.now(),
				model: this.model,
				provider: this.provider,
			};
		}
	}

	_addUsage(usage) {
		const t = this.tokens;
		t.input += usage.inputTokens ?? 0;
		t.output += usage.outputTokens ?? 0;
		t.cacheRead += usage.cacheReadTokens ?? 0;
		t.cacheWrite += usage.cacheWriteTokens ?? 0;
		t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
	}

	onStatus(status) {
		this.isStreaming = status === "running";
		this.client.scheduleSnapshot();
	}

	streamingUiMessage() {
		if (!this.stream) return null;
		return buildStreamingUiMessage(this.stream);
	}
}

// ---------------------------------------------------------------------------
// ClientSession — one browser client
// ---------------------------------------------------------------------------

export class ClientSession {
	constructor(clientId, cwd, dataDir, stateStore, emit) {
		this.clientId = clientId;
		this.cwd = cwd;
		this.dataDir = dataDir;
		this.stateStore = stateStore;
		this.emitFn = emit;

		this.convs = new Map();
		this.activeId = "";
		this.convSeq = 0;
		this.runtime = null;
		this.model = DEFAULT_MODEL;
		this.provider = DEFAULT_PROVIDER;
		this.thinkingLevel = "off";

		this.sinks = new Set();
		this.pendingNotices = [];
		this.snapshotTimer = null;
		this.sessionsTimer = null;
		this.version = 0;
		this.disposed = false;
		this.dshReady = false;
		this.configCheckCache = { at: 0, configured: false };

		this.terminals = new TerminalManager((msg) => this.emit(msg));
		this.fsWatcher = null;
		this.watchPath = null;
		this.watchTimer = null;

		this.sessionRoot = join(this.dataDir, "sessions", encodeURIComponent(cwd));
	}

	static async create(clientId, cwd, dataDir, stateStore, emit) {
		const cs = new ClientSession(clientId, cwd, dataDir, stateStore, emit);
		cs.stateStore.recordProject(cwd);
		await cs.initRuntime();
		await cs.resumeRecent();
		return cs;
	}

	// -- runtime lifecycle --------------------------------------------------

	async initRuntime() {
		await this.disposeRuntime();
		this.runtime = new DshRuntime({
			cwd: this.cwd,
			provider: this.provider,
			model: this.model,
			sessionRoot: this.sessionRoot,
			env: this.dshEnv(),
		});
		this.runtime.onNotification((method, params) => {
			try {
				this.onRuntimeNotification(method, params);
			} catch (err) {
				console.error("[dsh] notification error:", err);
			}
		});
		try {
			await this.runtime.start();
			this.dshReady = true;
		} catch (err) {
			this.dshReady = false;
			this.emit({
				type: "notice",
				level: "error",
				text: `DSH runtime 启动失败：${err.message}`,
			});
		}
	}

	/** Merge environment: DEEPSEEK_API_KEY / BASE_URL from the key file or the
	 *  pi agent's auth.json (~/.pi/agent/auth.json, deepseek provider). */
	dshEnv() {
		const env = {};
		try {
			const kf = JSON.parse(
				readFileSync(join(this.dataDir, "dsh-key.json"), "utf8"),
			);
			if (kf.apiKey) env.DEEPSEEK_API_KEY = kf.apiKey;
			if (kf.baseUrl) env.DEEPSEEK_BASE_URL = kf.baseUrl;
			return env;
		} catch {
			// no key file — fall through
		}
		// Reuse the pi agent's stored DeepSeek credential when present.
		for (const authPath of [
			join(process.env.HOME ?? "/root", ".pi", "agent", "auth.json"),
		]) {
			try {
				const auth = JSON.parse(readFileSync(authPath, "utf8"));
				const dk = auth?.deepseek;
				if (dk?.key) {
					env.DEEPSEEK_API_KEY = dk.key;
					if (dk.baseUrl) env.DEEPSEEK_BASE_URL = dk.baseUrl;
				}
			} catch {
				// continue
			}
		}
		return env;
	}

	async disposeRuntime() {
		if (this.runtime) {
			try {
				await this.runtime.close();
			} catch {
				/* ignore */
			}
			this.runtime = null;
		}
		this.dshReady = false;
	}

	onRuntimeNotification(method, params) {
		switch (method) {
			case "session.event": {
				const sessionId = params.sessionId;
				const conv = this.convBySession(sessionId);
				if (conv && params.event) conv.onSessionEvent(params.event);
				break;
			}
			case "session.status": {
				const conv = this.convBySession(params.sessionId);
				if (conv) conv.onStatus(params.status);
				break;
			}
			case "subagent.started":
			case "subagent.finished":
				// Subagent lifecycle — surfaced through parent events; ignored here.
				break;
			default:
				break;
		}
	}

	convBySession(sessionId) {
		for (const conv of this.convs.values()) {
			if (conv.sessionId === sessionId) return conv;
		}
		return undefined;
	}

	// -- conversations ------------------------------------------------------

	get activeConv() {
		const conv = this.convs.get(this.activeId);
		if (!conv) throw new Error("no active conversation");
		return conv;
	}

	makeConversation(sessionId) {
		const conv = new Conversation(this, `c${++this.convSeq}`, sessionId);
		this.convs.set(conv.id, conv);
		this.activeId = conv.id;
		return conv;
	}

	async resumeRecent() {
		const files = findSessionFiles(this.sessionRoot);
		const file = files[0];
		if (file) {
			await this.openSessionFile(file, true);
		} else {
			this.makeConversation(`web-${randomUUID()}`);
		}
	}

	/** Replay a session JSONL into a conversation (fresh or resumed). */
	async openSessionFile(file, makeActive = false) {
		let log;
		try {
			log = readSessionLog(file);
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: `会话读取失败：${err.message}` });
			return null;
		}
		const sessionId = log.header?.id ?? `web-${randomUUID()}`;
		const conv = this.convs.get(this.activeId)?.sessionId === sessionId
			? this.activeConv
			: this.makeConversation(sessionId);
		conv.messages = [];
		conv.msgIndex.clear();
		conv.stream = null;
		conv.isStreaming = false;
		conv.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
		for (const ev of log.events) {
			conv.onSessionEvent(ev);
		}
		conv.title = eventsTitle(log.events);
		conv.createdAt = log.header?.createdAt ?? Date.now();
		if (makeActive) this.activeId = conv.id;
		return conv;
	}

	// -- snapshot / emit ----------------------------------------------------

	emit(msg) {
		if (this.disposed) return;
		for (const sink of [...this.sinks]) sink(msg);
	}

	attachSink(send) {
		this.sinks.add(send);
		for (const msg of this.pendingNotices) send(msg);
		this.pendingNotices = [];
		this.emitConversations();
		void this.pushSlashCommands();
	}

	detachSink(send) {
		this.sinks.delete(send);
		if (this.sinks.size === 0) {
			this.terminals.killAll();
			this.unwatchDir();
		}
	}

	scheduleSnapshot() {
		if (this.disposed || this.snapshotTimer) return;
		this.snapshotTimer = setTimeout(() => {
			this.snapshotTimer = null;
			if (this.disposed) return;
			this.flushSnapshot();
		}, SNAPSHOT_INTERVAL_MS);
	}

	flushSnapshot() {
		try {
			this.emit({ type: "snapshot", state: this.snapshot() });
		} catch (err) {
			console.error("[dsh] snapshot error:", err);
		}
	}

	emitToolStatus(callId, toolName, isError) {
		const conv = this.activeConv;
		const startedAt = conv.toolStartTimes.get(callId);
		conv.toolStartTimes.delete(callId);
		const durationMs = startedAt ? Date.now() - startedAt : undefined;
		this.emit({
			type: "tool_status",
			toolCallId: callId,
			toolName: toolName ?? "tool",
			isError: isError === true,
			durationMs,
		});
	}

	snapshot() {
		const conv = this.activeConv;
		const messages = conv.messages;
		return {
			clientId: this.clientId,
			cwd: this.cwd,
			sessionId: conv.sessionId,
			sessionFile: undefined,
			conversationId: this.activeId,
			messages,
			streamingMessage: conv.streamingUiMessage(),
			isStreaming: conv.isStreaming,
			model: {
				id: conv.model,
				name: modelName(conv.model),
				provider: "deepseek",
				vision: false,
			},
			thinkingLevel: this.thinkingLevel,
			availableThinkingLevels: ["off"],
			queue: { steering: conv.queueSteering, followUp: conv.queueFollowUp },
			errorMessage: conv.errorMessage,
			tools: ["bash", "read", "write", "edit"],
			version: ++this.version,
			piConfigured: this.isConfigured(),
			stats: {
				totalMessages: messages.length,
				tokens: conv.tokens,
				cost: 0,
				contextUsage: { tokens: null, contextWindow: 0, percent: null },
			},
		};
	}

	/** DSH config readiness: DEEPSEEK_API_KEY resolvable (env or key file). */
	isConfigured() {
		const now = Date.now();
		if (now - this.configCheckCache.at < 2000) return this.configCheckCache.configured;
		let configured = false;
		try {
			const kf = JSON.parse(readFileSync(join(this.dataDir, "dsh-key.json"), "utf8"));
			configured = typeof kf.apiKey === "string" && kf.apiKey.length > 0;
		} catch {
			try {
				const auth = JSON.parse(
					readFileSync(join(process.env.HOME ?? "/root", ".pi", "agent", "auth.json"), "utf8"),
				);
				configured = typeof auth?.deepseek?.key === "string" && auth.deepseek.key.length > 0;
			} catch {
				configured = typeof process.env.DEEPSEEK_API_KEY === "string" &&
					process.env.DEEPSEEK_API_KEY.length > 0;
			}
		}
		this.configCheckCache = { at: now, configured };
		return configured;
	}

	// -- client message handlers ----------------------------------------------

	async prompt(text, attachments) {
		const conv = this.activeConv;
		if (!this.dshReady) {
			this.emit({ type: "notice", level: "warning", text: "DSH runtime 未就绪，无法发送消息。" });
			return;
		}
		conv.promptedSinceActive = true;
		const blocks = [{ type: "text", text }];
		// Attachments: workspace paths are referenced in text; raw image/file
		// data is currently appended as a path reference note.
		if (Array.isArray(attachments) && attachments.length > 0) {
			for (const a of attachments) {
				if (a.path) {
					blocks.push({
						type: "text",
						text: `\n[附件: ${a.path}]`,
					});
				} else if (a.name) {
					blocks.push({ type: "text", text: `\n[附件: ${a.name}]` });
				}
			}
		}
		try {
			conv.lastPromptMessageId = await this.runtime.prompt(conv.sessionId, blocks);
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: `发送失败：${err.message}` });
			// Runtime may have died — attempt one restart.
			if (err instanceof DshTransportError) {
				await this.initRuntime();
			}
		}
	}

	async abort() {
		// The DSH wire protocol has no prompt-cancel method yet.
		this.emit({
			type: "notice",
			level: "warning",
			text: "DSH runtime 暂不支持中断当前回合（协议无 cancel 方法）。",
		});
	}

	async newChat() {
		const conv = this.makeConversation(`web-${randomUUID()}`);
		conv.lastActiveAt = Date.now();
		this.emitConversations();
		this.flushSnapshot();
	}

	async editMessage(messageId, text) {
		const conv = this.activeConv;
		const idx = conv.messages.findIndex((m) => m.id === messageId);
		if (idx === -1 || conv.messages[idx].role !== "user") {
			this.emit({ type: "notice", level: "error", text: "找不到要编辑的消息" });
			return;
		}
		// DSH has no in-place session fork; the edit re-asks by starting a new
		// session that copies the prior user/assistant text, then the new prompt.
		const newConv = this.makeConversation(`web-${randomUUID()}`);
		for (const m of conv.messages.slice(0, idx + 1)) {
			newConv.messages.push(m);
			newConv.msgIndex.set(m.id, m);
		}
		const edited = { ...conv.messages[idx], content: [{ type: "text", text }] };
		newConv.messages[idx] = edited;
		newConv.msgIndex.set(edited.id, edited);
		newConv.title = conv.title;
		newConv.lastActiveAt = Date.now();
		this.emitConversations();
		this.flushSnapshot();
	}

	async cycleModel() {
		const i = DSH_MODELS.findIndex((m) => m.id === this.model);
		const next = DSH_MODELS[(i + 1) % DSH_MODELS.length];
		await this.setModel(next.id);
	}

	async setModel(modelId) {
		if (modelId === this.model) return;
		this.model = modelId;
		for (const conv of this.convs.values()) conv.model = modelId;
		// Restart the runtime so the new model applies to the next request.
		await this.initRuntime();
		this.emit({ type: "notice", level: "info", text: `模型已切换为 ${modelId}（下次请求生效）` });
		this.flushSnapshot();
	}

	cycleThinking() {
		this.setThinking(this.thinkingLevel === "off" ? "off" : "off");
	}

	setThinking(level) {
		if (level === "off") {
			this.thinkingLevel = "off";
		} else {
			this.emit({ type: "notice", level: "info", text: "DSH 推理级别由模型适配器控制，Web UI 暂只支持 off。" });
		}
		this.flushSnapshot();
	}

	async setCwd(path) {
		const wp = workspacePath(path.startsWith("/") ? path : this.cwd, path);
		const abs = wp ? wp.abs : resolve(path);
		try {
			if (!statSync(abs).isDirectory()) throw new Error("not a directory");
		} catch {
			this.emit({ type: "notice", level: "error", text: "无效的工作目录" });
			return;
		}
		if (resolve(abs) === resolve(this.cwd)) return;
		this.cwd = resolve(abs);
		this.stateStore.recordProject(this.cwd);
		this.sessionRoot = join(this.dataDir, "sessions", encodeURIComponent(this.cwd));
		// Rebuild runtime + conversation for the new workspace.
		await this.initRuntime();
		await this.resumeRecent();
		this.emitConversations();
		this.flushSnapshot();
		this.emit({ type: "notice", level: "info", text: `工作目录已切换：${this.cwd}` });
	}

	async listModels() {
		this.emit({
			type: "models",
			models: DSH_MODELS.map((m) => ({
				id: m.id,
				name: m.name,
				provider: m.provider,
				reasoning: false,
				vision: false,
			})),
		});
	}

	async refreshSessions() {
		const files = findSessionFiles(this.sessionRoot);
		const sessions = [];
		for (const file of files.slice(0, 100)) {
			try {
				const { header, events } = readSessionLog(file);
				sessions.push({
					path: file,
					name: header?.id,
					firstMessage: eventsTitle(events),
					messageCount: events.filter((e) =>
						e.type === "user/message" || e.type === "assistant/message" ||
						e.type === "tool/result").length,
					modified: statSync(file).mtimeMs,
					source: "web",
				});
			} catch {
				// skip unreadable
			}
		}
		this.emit({ type: "sessions", sessions });
	}

	async switchSession(path) {
		const conv = await this.openSessionFile(path, true);
		if (conv) {
			conv.lastActiveAt = Date.now();
			this.emitConversations();
			this.flushSnapshot();
		}
	}

	async switchConversation(id) {
		const conv = this.convs.get(id);
		if (!conv) return;
		this.activeId = id;
		conv.lastActiveAt = Date.now();
		this.flushSnapshot();
	}

	emitConversations() {
		const list = [];
		for (const conv of this.convs.values()) {
			if (conv.listed || (conv !== this.activeConv && conv.isStreaming)) {
				list.push({
					id: conv.id,
					title: conv.title,
					cwd: this.cwd,
					messageCount: conv.messages.length,
					isStreaming: conv.isStreaming,
				});
			}
		}
		this.emit({ type: "conversations", conversations: list, activeId: this.activeId });
	}

	async pushSlashCommands() {
		this.emit({
			type: "slash_commands",
			commands: [
				{ name: "new", description: "开始新对话", source: "builtin" },
				{ name: "resume", description: "恢复最近的会话", source: "builtin" },
				{ name: "clear", description: "清空当前会话上下文", source: "builtin" },
			],
		});
	}

	// -- projects / files -----------------------------------------------------

	async pushProjects() {
		const projects = this.stateStore.projects.map((p) => ({ ...p }));
		this.emit({ type: "projects", projects });
	}

	async listFiles(path) {
		const wp = workspacePath(this.cwd, path ?? "");
		if (!wp) {
			this.emit({ type: "notice", level: "error", text: "路径在工作区之外" });
			return;
		}
		const abs = wp.abs;
		// Protocol paths use forward slashes on every platform; the pi-web-ui
		// front-end compares m.path against its own '/' joined request path.
		const rel = wp.rel ? wp.rel.split(sep).join("/") : "";
		const { entries, truncated } = listDirSafe(abs, this.cwd);
		this.emit({
			type: "files",
			path: rel,
			// Parent of a top-level dir is the workspace root (""), not "." — the
			// front-end compares files.path against its request path exactly.
			parent: rel ? (dirname(rel) === "." ? "" : dirname(rel)) : null,
			entries,
			truncated,
		});
		this.watchDir(abs, rel);
	}

	async readFile(path) {
		const wp = workspacePath(this.cwd, path);
		if (!wp) {
			this.emit({ type: "notice", level: "error", text: "路径在工作区之外" });
			return;
		}
		const abs = wp.abs;
		let kind;
		try {
			const st = statSync(abs);
			if (!st.isFile()) throw new Error("not a file");
			kind = previewKind(basename(abs));
			if (kind === "none") {
				this.emit({ type: "notice", level: "warning", text: "该文件类型不支持预览" });
				return;
			}
			const size = st.size;
			let text = "";
			let truncated = false;
			let binary = false;
			if (kind === "text") {
				const buf = readFileSync(abs);
				if (buf.length > MAX_PREVIEW_BYTES) truncated = true;
				const slice = buf.subarray(0, MAX_PREVIEW_BYTES);
				if (slice.includes(0)) {
					binary = true;
					text = "";
				} else {
					text = slice.toString("utf8");
				}
			}
			const lines = text ? text.split("\n").length : 0;
			this.emit({
				type: "file_content",
				path: wp.rel.split(sep).join("/"),
				name: basename(abs),
				kind,
				text,
				content: text, // pi-web-ui protocol field (front-end reads t.content)
				truncated,
				binary,
				lines,
				size,
			});
		} catch {
			this.emit({ type: "notice", level: "error", text: "文件读取失败" });
		}
	}

	watchDir(abs, relPath) {
		if (this.watchPath === abs) return;
		this.unwatchDir();
		this.watchPath = abs;
		try {
			this.fsWatcher = watch(abs, { persistent: false }, () => {
				if (this.watchTimer) return;
				this.watchTimer = setTimeout(() => {
					this.watchTimer = null;
					if (!this.disposed) this.emit({ type: "file_changed", path: relPath });
				}, 300);
			});
		} catch {
			this.fsWatcher = null;
		}
	}

	unwatchDir() {
		if (this.fsWatcher) {
			try {
				this.fsWatcher.close();
			} catch {
				/* ignore */
			}
			this.fsWatcher = null;
		}
		this.watchPath = null;
	}

	async completePath(path) {
		const wp = workspacePath(this.cwd, path);
		if (!wp) {
			this.emit({ type: "path_completions", completions: [] });
			return;
		}
		const abs = wp.abs;
		const dir = existsSync(abs) && statSync(abs).isDirectory() ? abs : dirname(abs);
		const prefix = basename(abs);
		let entries = [];
		try {
			entries = readdirSync(dir, { withFileTypes: true })
				.filter((e) => e.name.startsWith(prefix))
				.map((e) => ({
					name: e.name,
					path: relative(this.cwd, join(dir, e.name)).split(sep).join("/"),
					type: e.isDirectory() ? "dir" : "file",
				}));
		} catch {
			entries = [];
		}
		this.emit({ type: "path_completions", completions: entries });
	}

	// -- commands file (.pi/commands.json) ------------------------------------

	async listCommands() {
		const { commands, path } = await loadCommands(this.cwd);
		this.emit({ type: "commands", commands, path });
	}

	async saveCommands(commands) {
		const { path } = await saveCommandsFile(this.cwd, commands);
		this.emit({ type: "commands", commands, path });
	}

	// -- DSH setup -------------------------------------------------------------

	async installPiAgent() {
		// DSH equivalent of pi-agent auto-install: verify the runtime binary.
		try {
			const { resolveRuntimeBin, resolveCordisConfig } = await import("./dsh-client.js");
			const bin = resolveRuntimeBin();
			const cfg = resolveCordisConfig(bin);
			this.emit({
				type: "install_result",
				ok: true,
				detail: `DSH runtime 就绪：${bin}\ncordis: ${cfg ?? "未找到（需 DSH_CORDIS_CONFIG）"}`,
			});
		} catch (err) {
			this.emit({ type: "install_result", ok: false, detail: err.message });
		}
	}

	async setProviderApiKey(provider, apiKey) {
		const keyFile = join(this.dataDir, "dsh-key.json");
		let existing = {};
		try {
			existing = JSON.parse(readFileSync(keyFile, "utf8"));
		} catch {
			existing = {};
		}
		existing.apiKey = apiKey;
		mkdirSync(this.dataDir, { recursive: true });
		writeFileSync(keyFile, JSON.stringify(existing, null, 2));
		await this.initRuntime();
		this.emit({ type: "notice", level: "info", text: "DEEPSEEK_API_KEY 已保存并应用到 runtime。" });
		this.flushSnapshot();
	}

	// -- dialogs / models-config are pi-specific: provide inert answers ---------

	async listModelsConfig() {
		this.emit({ type: "models_config", providers: [] });
	}

	async saveModelConfig(providerId, config) {
		this.emit({ type: "notice", level: "info", text: "DSH 使用内置 DeepSeek 适配器，无需自定义模型配置。" });
	}

	async deleteModelConfig(providerId) {
		/* no-op */
	}

	async listProviders() {
		this.emit({
			type: "providers_status",
			providers: [
				{
					id: "deepseek",
					name: "DeepSeek (DSH 内置适配器)",
					configured: this.isConfigured(),
					source: this.isConfigured() ? "stored/env" : undefined,
				},
			],
		});
	}

	async checkUpdate() {
		this.emit({
			type: "update_status",
			current: "0.1.0",
			latest: null,
			latestPublishedAt: null,
			upToDate: true,
			pendingRestart: false,
		});
	}

	async updateApp() {
		this.emit({ type: "update_result", ok: false, detail: "ds-web-ui 不支持应用内自更新。" });
	}

	resolveDialog(id, value) {
		/* pi-extension dialogs are not bridged in the DSH backend */
	}

	// -- disposal ---------------------------------------------------------------

	async dispose() {
		this.disposed = true;
		if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
		if (this.sessionsTimer) clearTimeout(this.sessionsTimer);
		this.unwatchDir();
		this.terminals.killAll();
		await this.disposeRuntime();
		this.sinks.clear();
	}
}

function modelName(id) {
	return DSH_MODELS.find((m) => m.id === id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// AgentService — manages one ClientSession per browser client
// ---------------------------------------------------------------------------

export class AgentService {
	constructor(cwd, stateFile) {
		this.cwd = cwd;
		this.stateStore = new ClientStateStore(stateFile);
		this.clients = new Map();
		this.pending = new Map(); // clientId -> {send, createPromise}
	}

	get(clientId) {
		return this.clients.get(clientId);
	}

	/** Attach a socket to a client session, creating the session on first attach. */
	async attach(clientId, send) {
		const existing = this.clients.get(clientId);
		if (existing) {
			existing.attachSink(send);
			return existing;
		}
		// Serialize concurrent hello processing for the same client.
		const prior = this.pending.get(clientId);
		if (prior) {
			const cs = await prior;
			cs.attachSink(send);
			return cs;
		}
		const promise = (async () => {
			const cs = await ClientSession.create(
				clientId,
				this.cwd,
				dirname(this.stateStore.file),
				this.stateStore,
				() => {
					/* per-client emit routed through sinks */
				},
			);
			this.clients.set(clientId, cs);
			this.pending.delete(clientId);
			return cs;
		})();
		this.pending.set(clientId, promise);
		const cs = await promise;
		cs.attachSink(send);
		return cs;
	}

	detach(clientId, send) {
		const cs = this.clients.get(clientId);
		if (cs) cs.detachSink(send);
	}

	async disposeAll() {
		for (const cs of this.clients.values()) {
			await cs.dispose();
		}
		this.clients.clear();
	}
}
