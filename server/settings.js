/**
 * settings.js — ds-web-ui settings domain: the bundled plugin catalog, the
 * agent-preset roster, and cordis.yml generation.
 *
 * Model:
 *   - A preset = { id, name, description, system, order, plugins, config }.
 *     `plugins` maps plugin id → enabled (user may enable/disable any
 *     non-core plugin per preset). `config` holds the AgentLoop / Bash /
 *     WebSearch form values (empty = inherit runtime default).
 *   - System presets (standard / minimal) are seeded from SYSTEM_PRESETS;
 *     their plugin state is editable, their metadata is fixed, and they can
 *     never be deleted. Custom presets are copies (official copy-dialog UX).
 *   - The active preset of a client session is what the runtime is spawned
 *     with; switching preset / toggling plugins / saving a config card
 *     regenerates <dataDir>/runtime/cordis-<clientId>.yml and restarts the
 *     DSH runtime (server/agent-service.js).
 *
 * cordis.yml generation: the template server/cordis.template.yml is a valid
 * cordis composition with {{MARKER}} slots (agent-loop config, shell
 * executor toggles, file-tool rows, web-search rows). Markers are substituted
 * here; the loader evaluates the `!!js` expressions at boot.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const templatePath = join(dirname(fileURLToPath(import.meta.url)), "cordis.template.yml");

/* ---------------------------------------------------------------------------
 * Plugin catalog — every plugin row the composition can carry.
 * `required` plugins are structural (the agent cannot boot without them);
 * their toggle is locked in the UI. `configurable` marks the plugins with
 * an editable settings card.
 * ------------------------------------------------------------------------- */

export const PLUGIN_CATALOG = [
	{ id: "sdk-jsonrpc-server", module: "@deepseek-ai/dsh-sdk-jsonrpc-server", required: true, group: "core" },
	{ id: "agent-core", module: "@deepseek-ai/dsh-agent-spine-demo", required: true, group: "core", configurable: "agentLoop" },
	{ id: "llm-deepseek", module: "@deepseek-ai/dsh-llm-deepseek", required: true, group: "core" },
	{ id: "sessions", module: "@deepseek-ai/dsh-session-persistence-jsonl", required: true, group: "core" },
	{ id: "session-checkpoints", module: "@deepseek-ai/dsh-session-checkpoint-policy", required: true, group: "core" },
	{ id: "subprocess", module: "@deepseek-ai/dsh-subprocess-local", required: true, group: "core" },
	{ id: "fs-local", module: "@deepseek-ai/dsh-fs-local", required: true, group: "core" },
	{ id: "bash", module: "@deepseek-ai/dsh-bash-local", group: "shell", configurable: "bash" },
	{ id: "pwsh", module: "@deepseek-ai/dsh-pwsh-local", group: "shell" },
	{ id: "tool-pwsh", module: "@deepseek-ai/dsh-tool-pwsh", group: "shell" },
	{ id: "tool-fs", module: "@deepseek-ai/dsh-tool-fs", group: "files" },
	{ id: "tool-fs-search", module: "@deepseek-ai/dsh-tool-fs-search", group: "files" },
	{ id: "tool-str-replace-editor", module: "@deepseek-ai/dsh-tool-str-replace-editor", group: "files" },
	{ id: "web-search", module: "@deepseek-ai/dsh-web-search-deepseek", group: "web", configurable: "webSearch" },
];

/** Runtime defaults the config cards inherit when a preset has no override. */
export const CONFIG_DEFAULTS = {
	agentLoop: { maxParallelToolCalls: 10 },
	bash: { timeoutMs: 120000, maxOutputBytes: 64000 },
	webSearch: { baseURL: "https://api.deepseek.com/anthropic/v1", maxUses: 5, apiKey: "" },
};

/** Shipped (system) presets — seeded on first run, re-merged on load. */
export const SYSTEM_PRESETS = [
	{
		id: "standard",
		name: "标准模式",
		description: "默认配置：Shell（PowerShell）+ 本地文件系统，无模型可直接调用的文件编辑工具。",
		system: true,
		order: 1,
		plugins: {
			bash: true, pwsh: true, "tool-pwsh": true,
			"tool-fs": false, "tool-fs-search": false, "tool-str-replace-editor": false,
			"web-search": false,
		},
		config: { agentLoop: {}, bash: {}, webSearch: {} },
	},
	{
		id: "minimal",
		name: "极简模式",
		description: "Shell（PowerShell）+ 文件读写 / 搜索 / 精确编辑工具，适合直接改文件的工作流。",
		system: true,
		order: 2,
		plugins: {
			bash: true, pwsh: true, "tool-pwsh": true,
			"tool-fs": true, "tool-fs-search": true, "tool-str-replace-editor": true,
			"web-search": false,
		},
		config: { agentLoop: {}, bash: {}, webSearch: {} },
	},
];

const PLUGIN_IDS = PLUGIN_CATALOG.map((p) => p.id);

/** Fill missing plugin keys with `true` so every preset has a full map. */
function normalizePlugins(plugins) {
	const out = {};
	for (const id of PLUGIN_IDS) {
		const req = PLUGIN_CATALOG.find((p) => p.id === id);
		out[id] = req?.required ? true : plugins?.[id] !== false;
	}
	return out;
}

/** Keep only known config sections/keys; drop unknown garbage. */
function normalizeConfig(config) {
	const src = config ?? {};
	const num = (v) => (Number.isInteger(v) && v > 0 ? v : undefined);
	return {
		agentLoop: { maxParallelToolCalls: num(src.agentLoop?.maxParallelToolCalls) },
		bash: {
			timeoutMs: num(src.bash?.timeoutMs),
			maxOutputBytes: num(src.bash?.maxOutputBytes),
		},
		webSearch: {
			baseURL: typeof src.webSearch?.baseURL === "string" && src.webSearch.baseURL.trim() ? src.webSearch.baseURL.trim() : undefined,
			maxUses: num(src.webSearch?.maxUses),
			apiKey: typeof src.webSearch?.apiKey === "string" ? src.webSearch.apiKey : undefined,
		},
	};
}

function clonePreset(p) {
	return {
		id: p.id,
		name: p.name,
		description: p.description ?? "",
		system: p.system === true,
		order: p.order ?? 0,
		plugins: normalizePlugins(p.plugins),
		config: normalizeConfig(p.config),
	};
}

const PRESET_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Validate a new preset id (used by create). Throws with a user-facing message. */
export function validatePresetId(id, existingIds) {
	if (typeof id !== "string" || !PRESET_ID_RE.test(id)) {
		throw new Error("预设 ID 只能包含字母、数字、-、_ 或 .，且不能以符号开头。");
	}
	if (existingIds.has(id)) {
		throw new Error(`预设 ID「${id}」已存在。`);
	}
}

/* ---------------------------------------------------------------------------
 * SettingsStore — persistence of <dataDir>/settings.json
 * ------------------------------------------------------------------------- */

export class SettingsStore {
	constructor(dataDir) {
		this.dataDir = dataDir;
		this.file = join(dataDir, "settings.json");
		this.data = this._load();
	}

	_load() {
		const seed = () => ({
			defaultPresetId: SYSTEM_PRESETS[0].id,
			presets: SYSTEM_PRESETS.map(clonePreset),
		});
		let raw;
		try {
			raw = JSON.parse(readFileSync(this.file, "utf8"));
		} catch {
			return seed();
		}
		if (!raw || !Array.isArray(raw.presets) || raw.presets.length === 0) return seed();
		// Re-merge system presets so upgrades keep them; keep stored copies'
		// plugin state (users may have edited them), re-assert fixed metadata.
		const storedById = new Map(raw.presets.map((p) => [p.id, p]));
		const merged = SYSTEM_PRESETS.map((sys) =>
			clonePreset(storedById.get(sys.id) ? { ...sys, ...storedById.get(sys.id), system: true } : sys),
		);
		const systemIds = new Set(SYSTEM_PRESETS.map((s) => s.id));
		for (const p of raw.presets) {
			if (!systemIds.has(p.id)) merged.push(clonePreset({ ...p, system: false }));
		}
		const defaultId = systemIds.has(raw.defaultPresetId) || merged.some((p) => p.id === raw.defaultPresetId)
			? raw.defaultPresetId
			: SYSTEM_PRESETS[0].id;
		return { defaultPresetId: defaultId, presets: merged };
	}

	_save() {
		writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
	}

	/** Absolute path of the settings file (for debugging / docs). */
	get filePath() {
		return this.file;
	}

	getDefaultPresetId() {
		return this.data.defaultPresetId;
	}

	listPresets() {
		return this.data.presets.map(clonePreset);
	}

	getPreset(id) {
		const p = this.data.presets.find((x) => x.id === id);
		return p ? clonePreset(p) : undefined;
	}

	setDefaultPreset(id) {
		if (!this.data.presets.some((p) => p.id === id)) throw new Error("预设不存在。");
		this.data.defaultPresetId = id;
		this._save();
	}

	createPreset({ fromId, id, name }) {
		validatePresetId(id, new Set(this.data.presets.map((p) => p.id)));
		const source = this.getPreset(fromId);
		if (!source) throw new Error(`来源预设「${fromId}」不存在。`);
		const displayName = typeof name === "string" && name.trim() ? name.trim() : id;
		const maxOrder = Math.max(0, ...this.data.presets.map((p) => p.order ?? 0));
		this.data.presets.push({
			id,
			name: displayName,
			description: "",
			system: false,
			order: maxOrder + 1,
			plugins: source.plugins,
			config: source.config,
		});
		this._save();
		return this.getPreset(id);
	}

	updatePreset(id, patch) {
		const p = this.data.presets.find((x) => x.id === id);
		if (!p) throw new Error("预设不存在。");
		if (p.system) throw new Error("内置预设不可重命名或改描述。");
		if (typeof patch.name === "string" && patch.name.trim()) p.name = patch.name.trim();
		if (typeof patch.description === "string") p.description = patch.description.trim();
		this._save();
		return this.getPreset(id);
	}

	deletePreset(id) {
		const p = this.data.presets.find((x) => x.id === id);
		if (!p) return false;
		if (p.system) throw new Error("内置预设不可删除。");
		this.data.presets = this.data.presets.filter((x) => x.id !== id);
		if (this.data.defaultPresetId === id) {
			this.data.defaultPresetId = SYSTEM_PRESETS[0].id;
		}
		this._save();
		return true;
	}

	/** Merge plugin toggles into a preset (works for system presets too). */
	saveActivePresetPlugins(id, plugins) {
		const p = this.data.presets.find((x) => x.id === id);
		if (!p) throw new Error("预设不存在。");
		const next = {};
		for (const key of Object.keys(plugins)) {
			if (!PLUGIN_IDS.includes(key)) continue;
			const req = PLUGIN_CATALOG.find((x) => x.id === key);
			if (req?.required) continue; // core plugins are always on
			next[key] = plugins[key] === true;
		}
		p.plugins = { ...normalizePlugins(p.plugins), ...next };
		this._save();
	}

	/** Merge config-form values into a preset. */
	saveActivePresetConfig(id, config) {
		const p = this.data.presets.find((x) => x.id === id);
		if (!p) throw new Error("预设不存在。");
		const merged = normalizeConfig(p.config);
		const patch = config ?? {};
		if (patch.agentLoop && patch.agentLoop.maxParallelToolCalls !== undefined) {
			merged.agentLoop.maxParallelToolCalls = patch.agentLoop.maxParallelToolCalls;
		}
		if (patch.bash) {
			if (patch.bash.timeoutMs !== undefined) merged.bash.timeoutMs = patch.bash.timeoutMs;
			if (patch.bash.maxOutputBytes !== undefined) merged.bash.maxOutputBytes = patch.bash.maxOutputBytes;
		}
		if (patch.webSearch) {
			if (patch.webSearch.baseURL !== undefined) merged.webSearch.baseURL = patch.webSearch.baseURL;
			if (patch.webSearch.maxUses !== undefined) merged.webSearch.maxUses = patch.webSearch.maxUses;
			if (patch.webSearch.apiKey !== undefined) merged.webSearch.apiKey = patch.webSearch.apiKey;
		}
		p.config = merged;
		this._save();
	}

	/**
	 * Generate the effective cordis.yml for a preset and write it under
	 * <dataDir>/runtime/cordis-<clientId>.yml. Returns the absolute path for
	 * DSH_CORDIS_CONFIG / argv.
	 */
	writeEffectiveCordis(clientId, presetId) {
		const preset = this.getPreset(presetId) ?? this.getPreset(this.data.defaultPresetId);
		if (!preset) throw new Error("没有可用的预设。");
		const text = generateCordis(preset);
		const dir = join(this.dataDir, "runtime");
		mkdirSync(dir, { recursive: true });
		const safe = String(clientId ?? "client").replace(/[^a-zA-Z0-9._-]/g, "_");
		const file = join(dir, `cordis-${safe}.yml`);
		writeFileSync(file, text, "utf8");
		return file;
	}
}

/* ---------------------------------------------------------------------------
 * cordis.yml generation
 * ------------------------------------------------------------------------- */

/** Disabled expression for the platform-conditional shell rows. */
function shellDisabledExpr(id, enabled) {
	if (enabled === false) return "true";
	switch (id) {
		case "bash":
			return "!!js process.platform === 'win32'";
		case "pwsh":
			return "!!js process.platform !== 'win32'";
		case "tool-pwsh":
			return "!!js process.platform !== 'win32'";
		default:
			return "false";
	}
}

/**
 * Build the effective runtime composition for a preset as YAML text.
 * @param {object} preset — a preset object (see SettingsStore).
 * @returns {string} the cordis.yml text with every marker substituted.
 */
export function generateCordis(preset) {
	const tpl = existsSync(templatePath)
		? readFileSync(templatePath, "utf8")
		: readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cordis.template.yml"), "utf8");
	const plugins = normalizePlugins(preset.plugins);
	const config = normalizeConfig(preset.config);

	// AgentLoop: agent-core config gains maxParallelToolCalls.
	const agentLoop = config.agentLoop.maxParallelToolCalls
		? `    maxParallelToolCalls: ${config.agentLoop.maxParallelToolCalls}\n`
		: "";

	// Bash: bash-local config keys (inert on Windows where bash is disabled).
	const bashKeys = [];
	if (config.bash.timeoutMs) bashKeys.push(`    timeoutMs: ${config.bash.timeoutMs}`);
	if (config.bash.maxOutputBytes) bashKeys.push(`    maxOutputBytes: ${config.bash.maxOutputBytes}`);
	const bashConfig = bashKeys.length > 0 ? bashKeys.join("\n") + "\n" : "";

	// File tools (minimal preset family).
	const fileRows = [];
	if (plugins["tool-fs"]) {
		fileRows.push(`- id: tool-fs\n  name: '@deepseek-ai/dsh-tool-fs'`);
	}
	if (plugins["tool-fs-search"]) {
		fileRows.push(`- id: tool-fs-search\n  name: '@deepseek-ai/dsh-tool-fs-search'\n  config:\n    sampleOverCapGlobResults: false`);
	}
	if (plugins["tool-str-replace-editor"]) {
		fileRows.push(`- id: tool-str-replace-editor\n  name: '@deepseek-ai/dsh-tool-str-replace-editor'\n  config:\n    maxOutputChars: 16000`);
	}

	// Web search: web seam + DeepSeek provider + model-facing tools.
	const webRows = [];
	if (plugins["web-search"]) {
		const wsConfig = [
			`    baseURL: ${config.webSearch.baseURL || CONFIG_DEFAULTS.webSearch.baseURL}`,
			`    maxUses: ${config.webSearch.maxUses || CONFIG_DEFAULTS.webSearch.maxUses}`,
		];
		if (config.webSearch.apiKey) {
			// JSON.stringify keeps quotes/escapes correct inside the YAML scalar.
			wsConfig.push(`    apiKey: ${JSON.stringify(config.webSearch.apiKey)}`);
		}
		webRows.push(
			`# Web access seam + DeepSeek search provider + model-facing tools.`,
			`- id: web\n  name: '@deepseek-ai/dsh-web'`,
			`- id: web-search-deepseek\n  name: '@deepseek-ai/dsh-web-search-deepseek'\n  config:\n${wsConfig.join("\n")}`,
			`- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: false\n    searchTimeoutMs: 60000`,
		);
	}

	const out = tpl
		.replace("{{AGENT_LOOP_CONFIG}}", agentLoop)
		.replace("{{BASH_DISABLED}}", shellDisabledExpr("bash", plugins.bash))
		.replace("{{PWSH_DISABLED}}", shellDisabledExpr("pwsh", plugins.pwsh))
		.replace("{{TOOL_PWSH_DISABLED}}", shellDisabledExpr("tool-pwsh", plugins["tool-pwsh"]))
		.replace("{{BASH_CONFIG}}", bashConfig)
		.replace("{{FILE_TOOL_ROWS}}", fileRows.length > 0 ? fileRows.join("\n\n") : "")
		.replace("{{WEB_SEARCH_ROWS}}", webRows.length > 0 ? webRows.join("\n\n") : "");

	if (out.includes("{{")) {
		throw new Error("cordis 生成失败：模板占位符未全部替换。");
	}
	return out;
}
