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

/** `-i` makes bash interactive; cmd.exe / powershell.exe are interactive on their own. */
function bashArgs(shell) {
	return /[\\/]bash(\.exe)?$/i.test(shell) ? ["-i"] : [];
}

/**
 * Interactive shell for PTYs (ported from pi-web-ui terminals.ts resolveShell).
 * - Windows: prefer bash — the same shell language most users expect in a
 *   terminal, with a busybox-w32 fallback so a bare box still gets bash:
 *   1. DS_WEB_SHELL / PI_WEB_SHELL (explicit override)
 *   2. $SHELL when it exists on disk (user launched from a Git Bash session)
 *   3. Git Bash install paths (ProgramFiles / ProgramFiles(x86))
 *   4. busybox-w32 fallback in <home>/.ds-web/bin/bash.exe (ensure-bash.js
 *      downloads it automatically when 2–3 are absent)
 *   5. powershell.exe (matches the DSH agent's shell on Windows)
 *   6. $COMSPEC (cmd.exe — always set, last resort)
 * - POSIX: the user's login shell, falling back to bash.
 * Resolved per terminal spawn (not at module load) so a busybox download that
 * finishes after startup is picked up by the next terminal.
 */
function resolveShell() {
	if (isWindows) {
		const explicit =
			process.env.DS_WEB_SHELL ?? process.env.PI_WEB_SHELL;
		if (explicit) return { shell: explicit, args: bashArgs(explicit) };
		const she = process.env.SHELL;
		if (she && existsSync(she)) return { shell: she, args: bashArgs(she) };
		const pf = process.env.ProgramFiles;
		const pf86 = process.env["ProgramFiles(x86)"];
		for (const cand of [
			pf ? join(pf, "Git", "bin", "bash.exe") : "",
			pf86 ? join(pf86, "Git", "bin", "bash.exe") : "",
		]) {
			if (cand && existsSync(cand)) return { shell: cand, args: ["-i"] };
		}
		const busybox = join(homedir(), ".ds-web", "bin", "bash.exe");
		if (existsSync(busybox)) return { shell: busybox, args: ["-i"] };
		// PowerShell matches the DSH agent's shell tool (dsh-tool-pwsh) on
		// Windows; cmd.exe remains the last resort.
		return {
			shell: process.env.COMSPEC || "powershell.exe",
			args: [],
		};
	}
	return { shell: process.env.SHELL || "bash", args: ["-i"] };
}

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
		const { shell, args } = resolveShell();
		try {
			pty = spawn(shell, args, {
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
