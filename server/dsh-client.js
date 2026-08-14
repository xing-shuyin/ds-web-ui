/**
 * dsh-client.js — minimal stdio JSON-RPC 2.0 client for the DeepSeek Harness
 * SDK runtime (dsh-jsonrpc-agent). All JavaScript: we spawn the single-file
 * runtime executable directly and speak the newline-delimited JSON-RPC 2.0
 * protocol documented in packages/sdk/protocol of deepseek-ai/deepseek-harness.
 *
 * Wire protocol (one compact JSON frame per \n line):
 *   client→server  initialize        -> InitializeResult
 *   client→server  session/prompt    -> { messageId }  (durable enqueue receipt)
 *   client→server  shutdown          -> {}
 *   server→client  session.event     (every session, unfiltered)
 *   server→client  session.status    (whole-agent running/idle transition)
 *   server→client  subagent.started / subagent.finished
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export class DshRpcError extends Error {
	constructor(message, code, data) {
		super(message);
		this.name = "DshRpcError";
		this.code = code;
		this.data = data;
	}
}

export class DshTransportError extends Error {
	constructor(message) {
		super(message);
		this.name = "DshTransportError";
	}
}

/**
 * Locate the dsh-jsonrpc-agent runtime binary.
 * Resolution order:
 *   1. $DSH_RUNTIME_BIN
 *   2. common pip site-packages locations (deepseek_harness_runtime/runtime/)
 *   3. <repo>/vendor/runtime/
 * Returns the absolute path, or throws when nothing is found.
 */
export function resolveRuntimeBin() {
	if (process.env.DSH_RUNTIME_BIN && existsSync(process.env.DSH_RUNTIME_BIN)) {
		return resolve(process.env.DSH_RUNTIME_BIN);
	}
	const candidates = [];
	// pip site-packages: probe the most common roots.
	for (const root of [
		"/usr/local/lib/python3.11/dist-packages",
		"/usr/local/lib/python3.10/dist-packages",
		"/usr/lib/python3/dist-packages",
		"/usr/lib/python3.11/dist-packages",
		"/usr/lib/python3.10/dist-packages",
	]) {
		const dir = join(root, "deepseek_harness_runtime", "runtime");
		if (existsSync(dir)) {
			for (const entry of readdirSync(dir)) {
				if (entry.startsWith("dsh-jsonrpc-agent-")) {
					candidates.push(join(dir, entry));
				}
			}
		}
	}
	// venv-style installations under $HOME.
	const homeRoot = join(
		process.env.HOME ?? "/root",
		".local",
		"lib",
		"python3.10",
		"site-packages",
		"deepseek_harness_runtime",
		"runtime",
	);
	if (existsSync(homeRoot)) {
		for (const entry of readdirSync(homeRoot)) {
			if (entry.startsWith("dsh-jsonrpc-agent-")) {
				candidates.push(join(homeRoot, entry));
			}
		}
	}
	// Local vendor fallback.
	const local = resolve("vendor/runtime");
	if (existsSync(local)) {
		for (const entry of readdirSync(local)) {
			if (entry.startsWith("dsh-jsonrpc-agent-")) {
				candidates.push(join(local, entry));
			}
		}
	}
	if (candidates.length === 0) {
		throw new DshTransportError(
			"找不到 dsh-jsonrpc-agent runtime。请设置 DSH_RUNTIME_BIN 环境变量，" +
				"或安装 deepseek-harness-sdk (pip install deepseek-harness-sdk==0.1.0rc6 -i https://pypi.org/simple/) 以获取自带 runtime。",
		);
	}
	return candidates[0];
}

/** Resolve the bundled cordis.yml next to the runtime binary. */
export function resolveCordisConfig(binPath) {
	for (const dir of [resolve(binPath, ".."), resolve(binPath, "..", "..")]) {
		const cfg = join(dir, "cordis.yml");
		if (existsSync(cfg)) return cfg;
	}
	return null;
}

export class DshRuntime {
	/**
	 * @param {object} opts
	 * @param {string} opts.cwd          workspace the agent operates in
	 * @param {string} opts.provider     provider route (deepseek-official)
	 * @param {string} opts.model        model id (deepseek-v4-flash)
	 * @param {number} [opts.maxTokens]  per-request output cap
	 * @param {string} [opts.sessionRoot] DSH_SESSION_ROOT for JSONL persistence
	 * @param {string} [opts.runtimeBin] explicit runtime binary
	 * @param {string} [opts.cordis]     explicit cordis.yml
	 * @param {object} [opts.env]        extra env (DEEPSEEK_API_KEY …)
	 */
	constructor(opts) {
		this.opts = opts;
		this.cwd = resolve(opts.cwd ?? process.cwd());
		this.provider = opts.provider ?? "deepseek-official";
		this.model = opts.model ?? "deepseek-v4-flash";
		this.maxTokens = opts.maxTokens;
		this.sessionRoot = opts.sessionRoot;
		this.env = opts.env ?? {};

		this.proc = null;
		this.buffer = "";
		this.nextId = 1;
		this.pending = new Map(); // id -> {resolve, reject}
		this.notificationHandler = null;
		this.stderrTail = "";
		this.closed = false;
		this.initialized = false;
	}

	/** Start the subprocess (lazy) and perform the initialize handshake. */
	async start() {
		if (this.proc && this.proc.exitCode === null) return;
		const bin = resolveRuntimeBin();
		const cordis =
			this.opts.cordis ?? process.env.DSH_CORDIS_CONFIG ?? resolveCordisConfig(bin);
		if (!cordis) {
			throw new DshTransportError(
				`找不到 cordis.yml（runtime: ${bin}）。请设置 DSH_CORDIS_CONFIG。`,
			);
		}
		const env = {
			...process.env,
			DSH_CWD: this.cwd,
			DSH_CORDIS_CONFIG: cordis,
			...this.env,
		};
		if (this.sessionRoot) env.DSH_SESSION_ROOT = this.sessionRoot;
		this.proc = spawn(bin, [cordis], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.closed = false;
		this.buffer = "";
		this.pending.clear();
		this.stderrTail = "";

		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk) => this._onData(chunk));
		this.proc.stderr.setEncoding("utf8");
		this.proc.stderr.on("data", (chunk) => {
			this.stderrTail = (this.stderrTail + chunk).slice(-4000);
		});
		this.proc.on("error", (err) => {
			for (const p of this.pending.values()) {
				p.reject(new DshTransportError(`runtime 启动失败: ${err.message}`));
			}
			this.pending.clear();
		});
		this.proc.on("exit", (code, signal) => {
			const err = new DshTransportError(
				`DSH runtime 已退出 (code=${code} signal=${signal}) stderr: ${this.stderrTail.slice(-400)}`,
			);
			for (const p of this.pending.values()) p.reject(err);
			this.pending.clear();
			this.initialized = false;
			if (this.onExit) this.onExit(code, signal);
		});

		await this._request("initialize", {
			cwd: this.cwd,
			provider: this.provider,
			model: this.model,
			...(this.maxTokens ? { maxTokens: this.maxTokens } : {}),
		});
		this.initialized = true;
	}

	_onData(chunk) {
		this.buffer += chunk;
		let idx;
		while ((idx = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) continue;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				continue; // malformed frames are ignored per protocol
			}
			this._dispatch(msg);
		}
	}

	_dispatch(msg) {
		if (msg.id !== undefined && msg.id !== null) {
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) {
				p.reject(new DshRpcError(msg.error.message, msg.error.code, msg.error.data));
			} else {
				p.resolve(msg.result ?? {});
			}
			return;
		}
		if (msg.method && this.notificationHandler) {
			this.notificationHandler(msg.method, msg.params ?? {});
		}
	}

	_request(method, params, timeoutMs = 120_000) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new DshTransportError(`请求 ${method} 超时`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this._write({ jsonrpc: "2.0", id, method, params });
		});
	}

	_write(msg) {
		if (!this.proc || this.proc.stdin.destroyed) {
			throw new DshTransportError("runtime 未启动");
		}
		this.proc.stdin.write(JSON.stringify(msg) + "\n");
	}

	/**
	 * Queue a prompt for a session. Resolves with the durable inbox receipt
	 * message id as soon as the runtime accepts it.
	 * @returns {Promise<string>} messageId
	 */
	async prompt(sessionId, contentBlocks) {
		await this.start();
		const res = await this._request("session/prompt", {
			sessionId,
			contentBlocks,
		});
		if (typeof res.messageId !== "string") {
			throw new DshTransportError("session/prompt 未返回 messageId");
		}
		return res.messageId;
	}

	/** Attach the notification handler for the life of the process. */
	onNotification(handler) {
		this.notificationHandler = handler;
	}

	/** Shutdown handshake then kill ladder (EOF → SIGTERM → SIGKILL). */
	async close() {
		if (this.closed) return;
		this.closed = true;
		if (!this.proc || this.proc.exitCode !== null) {
			this.proc = null;
			return;
		}
		try {
			await this._request("shutdown", {}, 2000);
		} catch {
			// fall through to kill ladder
		}
		try {
			this.proc.stdin.end();
		} catch {
			/* ignore */
		}
		const proc = this.proc;
		await Promise.race([
			new Promise((r) => proc.once("exit", r)),
			new Promise((r) => setTimeout(r, 1500)),
		]);
		if (proc.exitCode === null) {
			try {
				proc.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			await Promise.race([
				new Promise((r) => proc.once("exit", r)),
				new Promise((r) => setTimeout(r, 1500)),
			]);
		}
		if (proc.exitCode === null) {
			try {
				proc.kill("SIGKILL");
			} catch {
				/* ignore */
			}
		}
		this.proc = null;
	}
}
