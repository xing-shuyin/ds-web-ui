/**
 * TerminalManager — per-client PTY sessions (node-pty) bridged over the
 * WebSocket protocol, plus the user command list persisted in
 * `<workspaceRoot>/.pi/commands.json`. Ported verbatim from pi-web-ui.
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node-pty";

// ---------------------------------------------------------------------------
// .pi/commands.json
// ---------------------------------------------------------------------------

export function commandsFilePath(workspaceRoot) {
	return join(workspaceRoot, ".pi", "commands.json");
}

/** Expand ${pwd} (and ~) in a cwd/command string against the session's cwd. */
export function expandPwd(input, pwd) {
	let out = input.replace(/\$\{pwd\}/g, pwd);
	if (out === "~") return homedir();
	if (out.startsWith("~/")) out = join(homedir(), out.slice(2));
	return out;
}

export function resolveCommandCwd(cwd, pwd) {
	if (!cwd || cwd.trim() === "") return pwd;
	const expanded = expandPwd(cwd.trim(), pwd);
	return isAbsolute(expanded) ? expanded : resolve(pwd, expanded);
}

export async function loadCommands(workspaceRoot) {
	const path = commandsFilePath(workspaceRoot);
	const { commands, warning } = await readCommandsFile(path);
	return { commands, path, warning };
}

async function readCommandsFile(path) {
	if (!existsSync(path)) return { commands: [] };
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch (err) {
		return { commands: [], warning: `读取命令文件失败：${err.message}` };
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { commands: [], warning: `命令文件不是有效 JSON：${path}` };
	}
	const clean = (arr) =>
		arr
			.filter(
				(c) =>
					typeof c === "object" &&
					c !== null &&
					typeof c.name === "string" &&
					typeof c.command === "string",
			)
			.map((c) => ({ name: c.name, command: c.command, cwd: c.cwd }));
	if (Array.isArray(parsed)) return { commands: clean(parsed) };
	if (parsed && Array.isArray(parsed.commands)) {
		return { commands: clean(parsed.commands) };
	}
	return { commands: [], warning: `命令文件格式不正确：${path}` };
}

export async function saveCommandsFile(workspaceRoot, commands) {
	const path = commandsFilePath(workspaceRoot);
	try {
		await mkdir(join(workspaceRoot, ".pi"), { recursive: true });
		await writeFile(path, JSON.stringify({ commands }, null, 2) + "\n", "utf8");
		return { path };
	} catch (err) {
		return { path, error: `保存命令文件失败：${err.message}` };
	}
}

// ---------------------------------------------------------------------------
// TerminalManager
// ---------------------------------------------------------------------------

const isWindows = process.platform === "win32";
const SHELL = isWindows
	? process.env.SHELL || process.env.COMSPEC || "powershell.exe"
	: process.env.SHELL || "bash";
const SHELL_ARGS = isWindows ? [] : ["-i"];

function shellEnv() {
	const env = { ...process.env, TERM: "xterm-256color" };
	if (!env.LANG && !env.LC_ALL) env.LANG = "en_US.UTF-8";
	return env;
}

// node-pty spawn-helper permission repair (macOS prebuilds ship without +x).
const require = createRequire(import.meta.url);

function spawnHelperPaths() {
	try {
		const pkgDir = dirname(dirname(require.resolve("node-pty")));
		const out = [];
		const built = join(pkgDir, "build", "Release", "spawn-helper");
		if (existsSync(built)) out.push(built);
		const prebuildsDir = join(pkgDir, "prebuilds");
		if (existsSync(prebuildsDir)) {
			for (const entry of readdirSync(prebuildsDir)) {
				const p = join(prebuildsDir, entry, "spawn-helper");
				if (existsSync(p)) out.push(p);
			}
		}
		return out;
	} catch {
		return [];
	}
}

function repairSpawnHelperPermissions() {
	if (isWindows) return;
	for (const p of spawnHelperPaths()) {
		try {
			if ((statSync(p).mode & 0o111) === 0) chmodSync(p, 0o755);
		} catch {
			// best-effort
		}
	}
}
repairSpawnHelperPermissions();

function brokenSpawnHelper() {
	if (isWindows) return "";
	for (const p of spawnHelperPaths()) {
		try {
			if ((statSync(p).mode & 0o111) === 0) return p;
		} catch {
			// ignore
		}
	}
	return "";
}

export class TerminalManager {
	constructor(emit) {
		this.emit = emit;
		this.terms = new Map();
		this.seq = 0;
	}

	create(id, cwd, cols, rows, fallbackCwd) {
		if (this.terms.has(id)) return;
		this.spawnShell(id, cwd || fallbackCwd, cols, rows, `终端 ${++this.seq}`);
	}

	runCommand(id, def, cols, rows, pwd) {
		const dir = resolveCommandCwd(def.cwd, pwd);
		const command = expandPwd(def.command.trim(), pwd);
		const title = def.name || command || `终端 ${++this.seq}`;

		const existing = this.terms.get(id);
		if (existing) {
			if (!existing.exited) {
				existing.exited = true;
				try {
					existing.pty.kill();
				} catch {
					// already dead
				}
			}
			cols = existing.cols || cols;
			rows = existing.rows || rows;
			this.terms.delete(id);
		}

		const ok = this.spawnShell(id, dir, cols, rows, title);
		if (!ok) return;
		this.writeOut(id, "\x1b[2J\x1b[3J\x1b[H");
		this.writeOut(id, `\x1b[90m> ${command}\x1b[0m  \x1b[90m(${dir})\x1b[0m\r\n`);
		if (command) this.input(id, command + "\r");
	}

	spawnShell(id, cwd, cols, rows, title) {
		let abs = cwd;
		if (!abs) abs = homedir();
		else if (!isAbsolute(abs)) abs = resolve(abs);
		if (!existsSync(abs)) {
			this.fail(id, `目录不存在：${abs}`);
			return false;
		}
		repairSpawnHelperPermissions();
		let pty;
		try {
			pty = spawn(SHELL, SHELL_ARGS, {
				name: "xterm-256color",
				cols: Math.max(2, Math.floor(cols) || 80),
				rows: Math.max(2, Math.floor(rows) || 24),
				cwd: abs,
				env: shellEnv(),
			});
		} catch (err) {
			const helper = brokenSpawnHelper();
			this.fail(
				id,
				helper
					? `启动终端失败：${err.message}（node-pty 的 spawn-helper 缺少执行权限，请运行：chmod +x "${helper}"）`
					: `启动终端失败：${err.message}`,
			);
			return false;
		}
		const entry = {
			id,
			pty,
			title,
			cwd: abs,
			cols: Math.max(2, Math.floor(cols) || 80),
			rows: Math.max(2, Math.floor(rows) || 24),
			exited: false,
		};
		this.terms.set(id, entry);
		pty.onData((data) => {
			if (this.terms.get(id) !== entry) return;
			this.writeOut(id, data);
		});
		pty.onExit(({ exitCode }) => {
			if (this.terms.get(id) !== entry) return;
			this.exit(id, exitCode);
		});
		return true;
	}

	writeOut(id, data) {
		const entry = this.terms.get(id);
		if (!entry || entry.exited) return;
		this.emit({ type: "terminal_output", terminalId: id, data });
	}

	fail(id, text) {
		this.emit({ type: "notice", level: "error", text });
		this.emit({ type: "terminal_output", terminalId: id, data: `\x1b[91m${text}\x1b[0m\r\n` });
		this.emit({ type: "terminal_exit", terminalId: id, exitCode: null });
	}

	exit(id, exitCode) {
		const entry = this.terms.get(id);
		if (!entry || entry.exited) return;
		entry.exited = true;
		this.writeOut(id, `\r\n\x1b[90m[进程已退出，退出码 ${exitCode}]\x1b[0m\r\n`);
		this.emit({ type: "terminal_exit", terminalId: id, exitCode });
	}

	input(id, data) {
		const entry = this.terms.get(id);
		if (entry && !entry.exited) entry.pty.write(data);
	}

	resize(id, cols, rows) {
		const entry = this.terms.get(id);
		if (!entry || entry.exited) return;
		try {
			entry.pty.resize(
				Math.max(2, Math.floor(cols) || 80),
				Math.max(2, Math.floor(rows) || 24),
			);
			entry.cols = Math.max(2, Math.floor(cols) || 80);
			entry.rows = Math.max(2, Math.floor(rows) || 24);
		} catch {
			// PTY already gone
		}
	}

	kill(id) {
		const entry = this.terms.get(id);
		if (!entry || entry.exited) return;
		entry.exited = true;
		try {
			entry.pty.kill();
		} catch {
			// already dead
		}
		this.terms.delete(id);
		this.emit({ type: "terminal_exit", terminalId: id, exitCode: null });
	}

	killAll() {
		for (const entry of this.terms.values()) {
			if (entry.exited) continue;
			entry.exited = true;
			try {
				entry.pty.kill();
			} catch {
				// already dead
			}
		}
		this.terms.clear();
	}
}
