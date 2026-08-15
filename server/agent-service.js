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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
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
import {
	CONFIG_DEFAULTS,
	PLUGIN_CATALOG,
	SettingsStore,
	generateCordis,
} from "./settings.js";

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

/** DeepSeek V4 context window (llm-deepseek DEFAULT_CONTEXT_WINDOW) and
 *  official per-1M-token pricing in USD (api-docs.deepseek.com/quick_start/pricing).
 *  V4-Flash rates; V4-Pro may differ — extend per model if needed. */
const DSH_CONTEXT_WINDOW = 1_000_000;
const DSH_PRICE_INPUT = 0.14; // per 1M, cache miss
const DSH_PRICE_CACHE_READ = 0.0028; // per 1M, cache hit
const DSH_PRICE_OUTPUT = 0.28; // per 1M

/** Entries hidden from path completion (from pi-web-ui). */
const IGNORED_ENTRIES = new Set([
	"node_modules",
	".git",
	".svn",
	".hg",
	"dist",
	".next",
	".nuxt",
	".cache",
	".venv",
	"venv",
	"__pycache__",
	"coverage",
	".pi-web",
	".DS_Store",
	"Thumbs.db",
]);
const IGNORED_ENTRIES_WIN = new Set([
	"node_modules",
	".git",
	".pi-web",
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",
]);
const ignoredEntries = () =>
	process.platform === "win32" ? IGNORED_ENTRIES_WIN : IGNORED_ENTRIES;

/** Installed package version from package.json (read once). */
const PKG_VERSION = (() => {
	try {
		return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
})();
const packageVersion = () => PKG_VERSION;

/** Simple numeric semver compare: is a >= b? (handles x.y.z, prerelease ignored) */
function isVersionAtLeast(a, b) {
	const pa = String(a).split("-")[0].split(".").map(Number);
	const pb = String(b).split("-")[0].split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	}
	return true;
}

/** Estimate cumulative USD cost from per-request token usage. */
function estimateCost(t) {
	if (!t || (t.total ?? 0) === 0) return 0;
	return (
		((t.input + (t.cacheWrite ?? 0)) * DSH_PRICE_INPUT +
			(t.cacheRead ?? 0) * DSH_PRICE_CACHE_READ +
			t.output * DSH_PRICE_OUTPUT) /
		1e6
	);
}

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

/** Decode bytes: strict UTF-8, falling back to GBK (Windows legacy Chinese
 *  files), then latin1 as a last resort. */
function decodeText(buf) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		try {
			return new TextDecoder("gbk").decode(buf);
		} catch {
			return buf.toString("latin1");
		}
	}
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

/** Decompress a possibly multi-frame zstd buffer. The runtime appends one
 *  frame per write batch; zstdDecompressSync only handles the first frame,
 *  which would silently drop every event after the session header. */
function zstdDecompressAll(buf) {
	const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
	const starts = [];
	for (let i = 0; i + 4 <= buf.length; i++) {
		if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) {
			starts.push(i);
		}
	}
	let out = "";
	for (let i = 0; i < starts.length; i++) {
		const from = starts[i];
		const to = i + 1 < starts.length ? starts[i + 1] : buf.length;
		try {
			out += zstdDecompressSync(buf.subarray(from, to)).toString("utf8");
		} catch {
			/* skip unreadable frame */
		}
	}
	return out || buf.toString("utf8");
}
/** Read a session JSONL file → { header, events } (events in log order). */
export function readSessionLog(file) {
	const raw = readFileSync(file);
	// The runtime appends one zstd frame per write batch — decompress them all.
	const text = file.endsWith(".jsonl.zstd")
		? zstdDecompressAll(raw)
		: raw.toString("utf8");
	const lines = text.split("\n").filter((l) => l.trim());
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
			else if (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zstd")) out.push(full);
		}
	};
	walk(root);
	return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** projectKey(cwd) — mirrors the DSH runtime's session directory naming so
 *  session listing is scoped to the current workspace. Separators become
 *  "-", unsafe chars become ~XXXX (uppercase hex), wrapped in --…--. */
function projectKey(cwd) {
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** Session files for one workspace: official runtime layout (root/--<cwd>--)
 *  plus the legacy per-cwd layout (root/<encoded-cwd>/--<cwd>--). */
export function findSessionFilesForCwd(sessionRoot, cwd) {
	const dirs = [
		join(sessionRoot, projectKey(cwd)),
		join(sessionRoot, encodeURIComponent(cwd), projectKey(cwd)),
	];
	const out = [];
	for (const d of dirs) out.push(...findSessionFiles(d));
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
				const msg = reason.error?.message ?? "回合失败（provider 错误）";
				this.errorMessage = msg;
				// Resuming a persisted session is impossible over the DSH SDK
				// wire (jsonrpc-server always creates; a disk log is an id
				// collision). Ask the client to continue in a fresh session.
				if (/persisted log/i.test(msg)) this.client.handlePersistedCollision?.();
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
		// A settings change that was deferred because this turn was running now
		// gets applied: the run is over, so restarting can no longer kill it.
		if (!this.isStreaming && this.client.pendingRuntimeRestart) {
			void this.client.flushPendingRuntimeRestart();
		}
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
	constructor(clientId, cwd, dataDir, stateStore, emit, settingsStore) {
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

		// Agent presets: the active preset drives the generated cordis.yml the
		// runtime is spawned with (see initRuntime). One runtime per client, so
		// a preset switch restarts it and takes effect on the next request.
		this.settingsStore = settingsStore;
		this.activePresetId = settingsStore.getDefaultPresetId();
		this.pendingRuntimeRestart = false;
		this.pendingRestartNotice = undefined;

		// DSH runtime expects the session ROOT here; it appends its own
		// projectKey(cwd) directory (--<cwd>--). Root doubles as the
		// findSessionFiles base so both layouts are discoverable.
		this.sessionRoot = join(this.dataDir, "sessions");
	}

	static async create(clientId, cwd, dataDir, stateStore, emit, settingsStore) {
		const cs = new ClientSession(clientId, cwd, dataDir, stateStore, emit, settingsStore);
		cs.stateStore.recordProject(cwd);
		await cs.initRuntime();
		await cs.resumeRecent();
		return cs;
	}

	// -- runtime lifecycle --------------------------------------------------

	async initRuntime() {
		await this.disposeRuntime();
		let cordisPath;
		try {
			cordisPath = this.settingsStore.writeEffectiveCordis(this.clientId, this.activePresetId);
		} catch (err) {
			console.error("[dsh] cordis generation failed:", err);
			this.emit({ type: "notice", level: "error", text: `设置应用失败：${err.message}` });
			return;
		}
		this.runtime = new DshRuntime({
			cwd: this.cwd,
			provider: this.provider,
			model: this.model,
			sessionRoot: this.sessionRoot,
			cordis: cordisPath,
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
			join(homedir(), ".pi", "agent", "auth.json"),
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
		const files = findSessionFilesForCwd(this.sessionRoot, this.cwd);
		// Resume the newest session that actually has messages. Broken/empty
		// logs (e.g. legacy zstd files with only a header) would make the DSH
		// runtime reject the live session with an id collision.
		for (const file of files.slice(0, 10)) {
			const conv = await this.openSessionFile(file, true);
			if (conv && conv.messages.length > 0) return;
		}
		this.makeConversation(`web-${randomUUID()}`);
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
		// Empty logs (e.g. legacy zstd files holding only a header) cannot be
		// resumed — the DSH runtime rejects the id as a disk/live mismatch.
		if (log.events.length === 0) {
			this.emit({ type: "notice", level: "warning", text: "该会话没有可恢复的内容（日志为空）。" });
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
			agentPreset: (() => {
				const p = this.settingsStore.getPreset(this.activePresetId);
				return { id: this.activePresetId, name: p?.name ?? this.activePresetId };
			})(),
			version: ++this.version,
			piConfigured: this.isConfigured(),
			stats: {
				totalMessages: messages.length,
				tokens: conv.tokens,
				cost: estimateCost(conv.tokens),
				contextUsage: {
					tokens: conv.tokens.total,
					contextWindow: DSH_CONTEXT_WINDOW,
					percent: Math.min(100, Math.round((conv.tokens.total / DSH_CONTEXT_WINDOW) * 100)),
				},
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
					readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"),
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
			// Resuming a persisted session is not supported by the DSH SDK wire
			// protocol (jsonrpc-server always creates; disk log → id collision).
			// Continue in a brand-new session instead of failing.
			if (err instanceof DshRpcError && /persisted log/i.test(err.message)) {
				const fresh = this.makeConversation(`web-${randomUUID()}`);
				this.emit({
					type: "notice",
					level: "info",
					text: "历史会话无法直接续聊（DSH SDK 协议限制），已自动新建会话继续。",
				});
				this.flushSnapshot();
				try {
					fresh.lastPromptMessageId = await this.runtime.prompt(fresh.sessionId, blocks);
				} catch (err2) {
					this.emit({ type: "notice", level: "error", text: `发送失败：${err2.message}` });
					if (err2 instanceof DshTransportError) await this.initRuntime();
				}
				return;
			}
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
		conv.presetId = this.activePresetId;
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
		// Rebuild runtime + conversation for the new workspace.
		await this.initRuntime();
		await this.resumeRecent();
		this.emitConversations();
		this.flushSnapshot();
		// Push the new workspace's session list so the sidebar updates without
		// a manual page refresh.
		await this.refreshSessions();
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
		const files = findSessionFilesForCwd(this.sessionRoot, this.cwd);
		const sessions = [];
		for (const file of files.slice(0, 100)) {
			try {
				const { header, events } = readSessionLog(file);
				sessions.push({
					path: file,
					// Session title = first user message (front-end prefers `name`).
					name: eventsTitle(events),
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
	/** Continue a conversation whose persisted session id collides on the DSH
	 *  runtime: re-send the last user message in a brand-new session. */
	async handlePersistedCollision() {
		const conv = this.activeConv;
		const lastUser = [...conv.messages].reverse().find((m) => m.role === "user");
		const text = lastUser
			? (lastUser.content || [])
					.map((b) => (b.type === "text" ? b.text : ""))
					.join("")
					.trim()
			: "";
		if (!text) return;
		const fresh = this.makeConversation(`web-${randomUUID()}`);
		this.emit({
			type: "notice",
			level: "info",
			text: "历史会话无法直接续聊（DSH 协议限制），已自动新建会话继续。",
		});
		try {
			await this.runtime.prompt(fresh.sessionId, [{ type: "text", text }]);
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: `发送失败：${err.message}` });
			if (err instanceof DshTransportError) await this.initRuntime();
		}
		this.flushSnapshot();
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
				} else {
					// UTF-8 first; fall back to GBK (Windows legacy Chinese files)
					// when strict UTF-8 decoding fails.
					text = decodeText(slice);
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

	async completePath(input) {
		const empty = () =>
			this.emit({ type: "path_completions", completions: [] });
		try {
			const home = homedir();
			// Expand ~ and relative inputs to an absolute path. Windows users type
			// backslashes (P:\agent) and ~\ — handle both separator styles.
			let expanded = input.trim();
			if (expanded === "") {
				empty();
				return;
			}
			// Bare drive letter ("E:") lists that drive's root — handle BEFORE
			// resolve, which would treat "E:" as drive-relative (cwd) instead.
			if (/^[a-zA-Z]:$/.test(expanded)) {
				expanded += sep;
			} else if (expanded === "~" || expanded === "~\\") {
				expanded = home;
			} else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
				expanded = home + sep + expanded.slice(2);
			} else if (!isAbsolute(expanded)) {
				expanded = resolve(this.cwd, expanded);
			}
			// Bare drive letter ("E:") lists that drive's root — handled BEFORE
			// resolve, which would treat "E:" as drive-relative (cwd) instead.
			// Split into parent dir + prefix on the LAST separator of either style.
			const lastSlash = Math.max(
				expanded.lastIndexOf("/"),
				expanded.lastIndexOf("\\"),
			);
			const dirPart = lastSlash >= 0 ? expanded.slice(0, lastSlash + 1) : "";
			const prefix = lastSlash >= 0 ? expanded.slice(lastSlash + 1) : expanded;
			let dirents = null;
			try {
				dirents = readdirSync(dirPart, { withFileTypes: true });
			} catch {
				dirents = null;
			}
			if (!dirents) {
				empty();
				return;
			}
			const ignored = ignoredEntries();
			const completions = dirents
				.filter((d) => d.name.startsWith(prefix) && !ignored.has(d.name))
				.map((d) => ({
					name: d.name,
					path: join(dirPart, d.name).split(sep).join("/"),
					type: d.isDirectory() ? "dir" : "file",
				}))
				.sort((a, b) => {
					const aHidden = a.name.startsWith(".");
					const bHidden = b.name.startsWith(".");
					if (aHidden !== bHidden) return aHidden ? 1 : -1;
					if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
					return a.name.localeCompare(b.name);
				})
				.slice(0, 30);
			this.emit({ type: "path_completions", completions });
		} catch {
			empty();
		}
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

	// -- agent presets & plugins (settings) -----------------------------------

	/** Full settings snapshot for the frontend (plugins tab + presets roster). */
	async listSettings() {
		this.emit(this.settingsSnapshot());
	}

	settingsSnapshot() {
		const defaultId = this.settingsStore.getDefaultPresetId();
		const presets = this.settingsStore.listPresets();
		const active = this.settingsStore.getPreset(this.activePresetId);
		const activePlugins = active?.plugins ?? {};
		return {
			type: "settings",
			platform: process.platform,
			activePresetId: this.activePresetId,
			defaultPresetId: defaultId,
			presets: presets.map((p) => ({
				id: p.id,
				name: p.name,
				description: p.description ?? "",
				system: p.system === true,
				order: p.order ?? 0,
				isDefault: p.id === defaultId,
				isActive: p.id === this.activePresetId,
				plugins: p.plugins ?? {},
				config: p.config ?? {},
				extraRows: p.extraRows ?? "",
			})),
			plugins: PLUGIN_CATALOG.map((p) => ({
				id: p.id,
				module: p.module,
				required: p.required === true,
				group: p.group ?? "core",
				configurable: p.configurable,
				enabled: p.required === true ? true : activePlugins[p.id] !== false,
			})),
			configDefaults: CONFIG_DEFAULTS,
		};
	}

	/** True while any conversation is mid-run — settings that restart the
	 *  runtime must not kill a live turn silently. */
	isStreamingAny() {
		for (const conv of this.convs.values()) {
			if (conv.isStreaming) return true;
		}
		return false;
	}

	/** Restart the runtime unless a conversation is streaming. Returns true when applied. */
	async applyRuntimeChange(noticeText) {
		if (this.isStreamingAny()) {
			// Defer: the current turn finishes first, then the runtime restarts
			// with the new composition (flushPendingRuntimeRestart, fired from
			// Conversation.onStatus once the session turns idle).
			this.pendingRuntimeRestart = true;
			this.pendingRestartNotice = noticeText;
			this.emit({
				type: "notice",
				level: "info",
				text: "更改已保存，runtime 将在当前回合结束后自动重启生效。",
			});
			this.emitSettings();
			return false;
		}
		await this.initRuntime();
		if (noticeText) {
			this.emit({ type: "notice", level: "info", text: noticeText });
		}
		this.emitSettings();
		this.flushSnapshot();
		return true;
	}

	/** Apply a deferred runtime restart now that no conversation is running. */
	async flushPendingRuntimeRestart() {
		if (this.disposed || !this.pendingRuntimeRestart) return;
		this.pendingRuntimeRestart = false;
		const notice = this.pendingRestartNotice ?? "设置已生效（runtime 已重启）。";
		this.pendingRestartNotice = undefined;
		await this.initRuntime();
		this.emit({ type: "notice", level: "info", text: notice });
		this.emitSettings();
		this.flushSnapshot();
	}

	emitSettings() {
		this.emit(this.settingsSnapshot());
	}

	/** Switch the ACTIVE preset (per conversation — restarts the runtime). */
	async setPreset(id) {
		const preset = this.settingsStore.getPreset(id);
		if (!preset) {
			this.emit({ type: "notice", level: "error", text: "预设不存在。" });
			return;
		}
		if (id === this.activePresetId) {
			this.emitSettings();
			return;
		}
		this.activePresetId = id;
		const applied = await this.applyRuntimeChange(
			`已切换预设为「${preset.name}」，runtime 已重启（下次请求生效）。`,
		);
		if (!applied) {
			// The choice is recorded; applyRuntimeChange armed a deferred restart
			// that fires once the running turn ends (flushPendingRuntimeRestart).
			this.emitSettings();
			this.flushSnapshot();
		}
	}

	async setDefaultPreset(id) {
		try {
			this.settingsStore.setDefaultPreset(id);
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: err.message });
			return;
		}
		this.emitSettings();
	}

	async createPreset({ fromId, id, name }) {
		try {
			this.settingsStore.createPreset({ fromId, id, name });
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: err.message });
			return;
		}
		this.emit({ type: "notice", level: "info", text: `预设「${name || id}」已创建。` });
		this.emitSettings();
	}

	async updatePreset({ id, name, description, extraRows }) {
		try {
			this.settingsStore.updatePreset(id, { name, description, extraRows });
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: err.message });
			return;
		}
		this.emit({ type: "notice", level: "info", text: "预设已更新。" });
		this.emitSettings();
	}

	async deletePreset(id) {
		try {
			const removed = this.settingsStore.deletePreset(id);
			if (!removed) {
				this.emit({ type: "notice", level: "error", text: "预设不存在。" });
				return;
			}
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: err.message });
			return;
		}
		this.emit({ type: "notice", level: "info", text: "预设已删除。" });
		if (this.activePresetId === id) {
			this.activePresetId = this.settingsStore.getDefaultPresetId();
			await this.initRuntime();
			this.flushSnapshot();
		}
		this.emitSettings();
	}

	/** Save plugin toggles / config cards into the ACTIVE preset + restart. */
	async saveActivePreset({ plugins, config }) {
		try {
			if (plugins && typeof plugins === "object") {
				this.settingsStore.saveActivePresetPlugins(this.activePresetId, plugins);
			}
			if (config && typeof config === "object") {
				this.settingsStore.saveActivePresetConfig(this.activePresetId, config);
			}
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: err.message });
			return;
		}
		await this.applyRuntimeChange("插件设置已保存，runtime 已重启（下次请求生效）。");
	}

	/** Read-only composition view for one preset (system presets viewer). */
	async viewPreset(id) {
		try {
			const preset = this.settingsStore.getPreset(id);
			if (!preset) throw new Error("预设不存在。");
			this.emit({ type: "preset_view", id, content: generateCordis(preset) });
		} catch (err) {
			this.emit({ type: "notice", level: "error", text: err.message });
		}
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
		// Report the installed version and whether a newer one exists on npm —
		// no in-app update (pi-web-ui feature we don't ship).
		const current = packageVersion();
		let latest = null;
		let upToDate = true;
		try {
			const res = await fetch("https://registry.npmjs.org/ds-web-ui/latest", {
				signal: AbortSignal.timeout(10_000),
			});
			if (res.ok) {
				const body = await res.json();
				latest = body.version ?? null;
				if (latest && latest !== current) {
					upToDate = isVersionAtLeast(current, latest);
				}
			}
		} catch {
			// registry unreachable — report what we know
		}
		this.emit({
			type: "update_status",
			current,
			latest,
			latestPublishedAt: null,
			upToDate,
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
		this.pendingRuntimeRestart = false;
		this.pendingRestartNotice = undefined;
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
	constructor(cwd, stateFile, settingsStore) {
		this.cwd = cwd;
		this.stateStore = new ClientStateStore(stateFile);
		this.settingsStore = settingsStore ?? new SettingsStore(dirname(stateFile));
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
				this.settingsStore,
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
