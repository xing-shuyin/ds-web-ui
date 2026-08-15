import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export type Locale = "zh" | "en";

const STORAGE_KEY = "ds-web-ui:lang";

/* ------------------------------------------------------------------ */
/* zh (default)                                                        */
/* ------------------------------------------------------------------ */

const zh = {
	/* common */
	cancel: "取消",
	ok: "确定",
	save: "保存",
	close: "关闭",
	loading: "加载中…",
	connected: "已连接",
	connecting: "连接中…",
	reconnecting: "重连中…",
	language: "语言",
	langZh: "中文",
	langEn: "English",
	githubRepo: "GitHub 仓库（xing-shuyin/ds-web-ui）",
	copy: "复制",

	/* topbar */
	viewSwitch: "视图切换",
	chat: "对话",
	terminal: "终端",
	selectModel: "选择模型",
	availableModels: "可用模型",
	noModels: "暂无可用模型（请先配置 API 密钥）",
	reasoning: "推理",
	vision: "识图",
	refreshModels: "刷新模型列表",
	manageModels: "⚙ 管理模型（新增 / 修改）",
	manageModelsTitle: "管理模型",
	thinkingLevel: "思考强度",
	thinking: "思考",
	thinkingChip: "思考：{level}",
	sound: "声音",
	newChat: "新对话",
	more: "更多",
	newChatTip: "新建对话（每个浏览器独立保存会话）",
	"thinking.off": "关闭",
	"thinking.minimal": "极简",
	"thinking.low": "低",
	"thinking.medium": "中",
	"thinking.high": "高",
	"thinking.xhigh": "极高",
	"thinking.max": "最大",
	thinkingUnsupported: "当前模型不支持该级别，已按模型能力就近生效",

	/* footerbar */
	context: "上下文",
	contextUsage: "上下文用量",
	cumulativeCost: "累计成本",
	sessionMessages: "会话消息数",
	messages: "消息",
	pluginStatus: "插件状态",
	working: "工作中",
	queued: "排队",
	enterPath: "输入路径，Enter 切换",
	cwdTip: "工作目录：{path}（点击切换）",

	/* chat input */
	folderRef: "文件夹引用：{path}",
	refOnly: "仅引用：{path}",
	attachContent: "附加内容：{path}",
	attachLines: "附加选中行：{path}（第 {start}-{end} 行）",
	attachImage: "图片：{name}",
	attachFile: "文件：{name}",
	removeAttachment: "移除附件",
	attachHint: "将随下一条消息发送",
	uploadFile: "添加文件（图片/文本/任意文件，也可直接拖入或粘贴截图）",
	dropHereToAttach: "松开以添加文件",
	imageNotSupported: "当前模型不支持识图，图片可能不会被模型看到",
	imageLoadFailed: "图片读取失败：{name}",
	fileLoadFailed: "文件读取失败：{name}",
	fileTooLarge: "文件过大已跳过（>{size}MB）：{name}",
	foldersNotSupported: "不支持直接拖入文件夹，请展开后选择文件",
	followUpQueued: "⏳ {n} 条跟进消息排队中",
	steeringQueued: "⏳ {n} 条转向消息排队中",
	placeholderStreaming: "智能体正在工作中…（消息可排队发送）",
	placeholderIdle: "给 pi 发送消息 — Enter 发送，Shift+Enter 换行",
	placeholderConnecting: "正在连接服务器…",
	stopAgent: "停止智能体",
	stop: "停止",
	supplement: "补充",
	supplementTip: "当前回复完成后立即发送",
	sendTip: "发送（Enter）",

	/* left panel */
	recentProjects: "最近项目",
	runningConversations: "运行的对话",
	historySessions: "历史对话",
	openHistory: "历史对话",
	openFiles: "文件列表",	streaming: "进行中…",
	noHistory: "还没有历史对话",
	current: "当前",
	messageCount: "{n} 条消息",
	tuiTip: "pi 终端（TUI）中的对话",
	emptyChat: "空对话",

	/* message edit */
	editReask: "编辑重问",
	editReaskTip:
		"修改此问题，并从这里重新提问（会新建一个分支对话，原对话保留）",
	reaskFromHere: "从此处重新提问",
	editPlaceholder: "修改问题内容…",
	editHint: "⌘/Ctrl+Enter 提交 · Esc 取消",

	/* collapsed old messages */
	expandMsg: "展开",
	collapseMsg: "收起",
	toolCalls: "工具调用",
	bashRuns: "终端运行",
	images: "图片",

	/* self-update */
	update: "更新",
	updateTip: "检查并更新 ds-web-ui",
	currentVersion: "当前版本",
	latestVersion: "最新版本",
	checkingUpdate: "检查中…",
	checkUpdate: "检查更新",
	upToDate: "已是最新版本",
	updateAvailable: "发现新版本 v{version}",
	updateJustPublished:
		"v{version} 刚刚发布，npm 缓存可能尚未同步——若未检测到新版本，请稍后重新检查",
	updateNow: "立即更新",
	confirmUpdate: "确认更新（覆盖全局安装）",
	updateSuccess: "✅ 已更新，正在重启…",
	updateFailed: "更新失败：{detail}",
	restartHint: "重启：ds-web-ui server restart",

	/* right panel */
	rootDir: "根目录",
	noFiles: "暂无文件",
	filesTruncated: "目录过大，列表已截断，仅显示前 2000 项",
	linkFolderTip: "链接文件夹路径到对话",
	attachInlineTip: "附加内容到对话",
	referenceTip: "仅引用路径（AI 按需读取）",
	previewFile: "预览",
	downloadFile: "下载文件",
	downloadFailed: "下载失败：{error}",

	/* file preview */
	selectLinesHint: "点击选择行；拖拽或 Shift+点击选择范围",
	selectedRange: "已选 {n} 行（第 {start}-{end} 行）",
	fileLines: "{n} 行",
	selectAll: "全选",
	clearSelection: "清除",
	addToChat: "添加到对话",
	addedToChat: "已添加",
	previewTruncated: "⚠ 文件过大，仅预览前 512KB",
	previewLinesTruncated: "… 文件行数过多，仅显示前 {n} 行",
	binaryFile: "🔣 二进制文件，已显示前 4KB 十六进制",
	binaryHexTruncated: "（文件更大，可下载完整文件）",
	previewNotSupported: "该类型文件不支持预览（仅图片 / 视频 / 文本）",
	emptyFile: "（空文件）",

	/* dialog */
	pluginRequest: "插件请求",
	noOptions: "（无选项）",
	inputPlaceholder: "输入内容",

	/* sound settings */
	soundHeader: "声音提示",
	enableSound: "启用声音",
	preview: "试听",
	volume: "音量",
	"sound.question": "问卷弹出",
	"sound.question.desc": "ask_user_question 出现时",
	"sound.done": "回复结束",
	"sound.done.desc": "智能体完成一轮回答时",
	"sound.start": "回复开始",
	"sound.start.desc": "智能体开始新一轮时",
	"sound.error": "出错",
	"sound.error.desc": "出现错误提示时",

	/* pi setup modal */
	setupTitle: "未检测到 pi agent 配置",
	setupDesc:
		"ds-web-ui 需要 pi 的配置目录（~/.pi/agent）和至少一个 API 密钥才能运行智能体。pi 内置了 openai、anthropic、deepseek 等服务商——选一个填密钥即可，全程无需打开终端。",
	installFailed: "✖ pi agent 安装失败：",
	retryInstall: "重试安装",
	skip: "跳过",
	installDone:
		"✅ pi agent CLI 已安装。选择服务商并填入 API 密钥即可开始对话：",
	provider: "服务商",
	configured: "已配置",
	providerKeyReady: "该服务商已配置密钥，可直接使用或更换新密钥。",
	apiKey: "API 密钥",
	saving: "保存中…",
	saveAndStart: "保存并开始使用",
	recheck: "重新检测",
	installing: "正在安装 pi agent CLI…",
	autoInstall: "自动安装 pi agent",

	/* messages */
	attachment: "附件",
	plugin: "插件",
	unknown: "未知",
	thinkingWait: "正在思考",
	exitCode: "退出码 {code}",
	cancelled: "已取消",
	truncated: "… 内容过长，当前视图已截断",
	outputTruncated: "… 输出过长，当前视图已截断",
	refOnlyShort: "仅引用",
	folderRefShort: "文件夹 · 仅引用",
	inlineLines: "内联 · {n} 行",
	inlineLinesRange: "行 {start}-{end}",
	image: "🖼 图片",
	folderNotExpanded: "文件夹，未展开内容 —— 智能体会按需浏览目录",
	fileNotExpanded: "文件较大（{size}），未展开内容 —— 智能体会按需读取",
	"role.user": "你",
	"role.assistant": "DSH",
	"role.tool": "工具",
	"role.bash": "终端",
	"role.branch": "分支摘要",
	"role.compaction": "上下文已压缩",

	/* welcome / message list */
	welcomeTitle: "DSH 编码智能体",
	welcomeSub: "检查、编辑、运行 —— 随时待命",
	directory: "目录",
	clickToFill: "点击填入输入框",
	waitingResponse: "正在等待模型响应…",
	backToBottom: "回到底部",
	questionNavTitle: "问题列表",
	questionNavTip: "本对话的全部问题，悬浮展开，点击跳转",
	"ex.understand": "了解这个项目",
	"ex.understand.prompt": "介绍一下这个项目：整体结构、主要模块和如何运行？",
	"ex.debug": "排查一个问题",
	"ex.debug.prompt": "帮我排查一个 bug，请先说明问题现象，我会补充细节。",
	"ex.test": "编写测试",
	"ex.test.prompt": "为项目的核心模块编写单元测试。",
	"ex.review": "代码审查",
	"ex.review.prompt": "审查最近改动的代码，指出潜在问题和改进建议。",

	/* tool call block */
	error: "出错",
	done: "完成",
	running: "执行中…",
	toolQueued: "排队中",
	copyArgs: "复制参数",
	errorOutput: "错误输出",
	output: "输出",
	waitingOutput: "等待输出…",
	toolDoneWaitingModel: "已结束 · 等模型",
	waitingModel: "等待模型响应…",

	/* thinking block */
	thinkingNow: "思考中",
	thinkingPreview: "思考：{preview}",

	/* terminal panel */
	commands: "命令",
	newCommand: "新建命令",
	newTerminal: "新建终端",
	name: "名称",
	command: "命令",
	cwdHint: "（${pwd} = 当前工作目录）",
	noCommands: "还没有命令，点 + 添加一个",
	clickToRun: "点击运行",
	edit: "编辑",
	delete: "删除",
	confirmQ: "确认?",
	builtinTerminal: "内置终端",
	termEmptySub: "点击左侧命令运行，或点右侧 + 新建终端",
	noTerminal: "暂无终端",
	exited: "（已退出{code}）",
	closeTerminal: "关闭终端",
	rerun: "重新读取 .pi/commands.json",
	terminalTitle: "终端 {n}",
	exampleName: "例如：启动开发服务器",
	exampleCommand: "例如：npm run dev",

	/* model config modal */
	editProvider: "编辑服务商",
	builtinProviders: "内置服务商",
	hintKeyOnly: "只需填入 API 密钥",
	configuredBadge: "✓ 已配置",
	keyReady: "密钥已就绪",
	pasteKey: "粘贴 API 密钥…",
	savingKey: "保存中",
	saveKey: "保存密钥",
	customProviders: "自定义服务商",
	customDesc:
		"用于 Ollama / vLLM / 兼容 OpenAI 的代理等，写入 pi 的 models.json，保存后热重载、立即生效。",
	noCustomProviders: "还没有自定义服务商",
	modelsCount: "{n} 个模型",
	addProvider: "新增服务商",
	providerId: "服务商 ID",
	providerIdHint: "（必填，如 ollama / my-proxy）",
	displayName: "显示名",
	displayNamePh: "我的代理",
	apiType: "API 类型",
	baseUrlHint: "（OpenAI 兼容端点）",
	apiKeyHint: "sk-…（可留空，用 auth.json 的密钥）",
	authHeader: "自动添加 Authorization 请求头",
	modelsTitle: "模型",
	modelIdReq: "模型 ID（必填）",
	text: "文本",
	textImage: "文本+图片",
	contextWindow: "上下文",
	maxOutput: "最大输出",
	removeModel: "移除模型",
	addModel: "添加模型",
	deleteProviderConfirm: "删除服务商 {id} 及其 {n} 个模型？",

	/* app */
	loadingSession: "正在加载会话…",
	connectingServer: "正在连接 ds-web-ui 服务器…",

	/* settings — entry + modal */
	settings: "设置",
	settingsTitle: "设置",
	settingsOpen: "打开设置（插件 / Agent 预设）",
	settingsPluginsTab: "插件",
	settingsPresetsTab: "Agent 预设",
	settingsLoading: "设置加载中…",
	settingsError: "设置加载失败",
	settingsRetry: "重试",
	settingsPluginsIntro:
		"启停已捆绑的 DSH 插件并调整可配置插件的参数。更改保存到当前预设，runtime 会重启使配置生效。",
	settingsPresetsIntro:
		"Agent 预设决定运行时加载的插件组合与配置。点卡片设为默认；「使用」立即应用到当前会话（重启 runtime，下次请求生效）。",
	editingPresetFor: "正在编辑预设：{name}",
	editingPresetHint: "插件开关与配置随预设一起保存；切换预设到「Agent 预设」标签。",
	saveAndRestart: "应用更改",
	savingAndRestarting: "应用并重启…",
	applyHint: "更改保存后 runtime 将重启，未发送的配置在下次请求生效。",
	unsavedChanges: "有未应用的更改",

	/* settings — plugin inventory */
	pluginCoreBadge: "核心",
	pluginGroupCore: "核心组件",
	pluginGroupShell: "Shell",
	pluginGroupFiles: "文件工具",
	pluginGroupWeb: "联网",
	pluginGroupCode: "PTC 模式",
	pluginGroupCreator: "创造模式",
	pluginEnabled: "已启用",
	pluginDisabled: "已停用",
	pluginRequiredHint: "核心插件不可停用（agent 无法启动）",
	pluginDisabledOnPlatform: "（当前平台自动禁用）",
	pluginOn: "开",
	pluginOff: "关",

	/* settings — plugin names & descriptions (inventory rows) */
	pluginName_sdk_jsonrpc_server: "JSON-RPC 服务端",
	pluginDesc_sdk_jsonrpc_server: "stdio JSON-RPC 服务入口（SDK 通信核心）",
	pluginName_agent_core: "Agent 核心（AgentLoop）",
	pluginDesc_agent_core: "Agent 主循环：会话编排、工具调度、系统提示与上下文注入",
	pluginName_llm_deepseek: "DeepSeek 模型适配器",
	pluginDesc_llm_deepseek: "DeepSeek 官方模型接入（deepseek-v4-flash / v4-pro）",
	pluginName_sessions: "会话持久化",
	pluginDesc_sessions: "会话 JSONL 持久化存储（<dataDir>/sessions）",
	pluginName_session_checkpoints: "会话检查点",
	pluginDesc_session_checkpoints: "请求 / 工具分发 / 完成步的持久化检查点策略",
	pluginName_subprocess: "子进程管理",
	pluginDesc_subprocess: "受管的子进程组（shell 执行器依赖）",
	pluginName_fs_local: "本地文件系统",
	pluginDesc_fs_local: "工作区文件系统提供者（工具层依赖）",
	pluginName_bash: "Bash 执行器",
	pluginDesc_bash: "POSIX shell 执行器（Windows 上自动禁用）",
	pluginName_pwsh: "PowerShell 执行器",
	pluginDesc_pwsh: "Windows PowerShell 执行器（非 Windows 自动禁用）",
	pluginName_tool_pwsh: "PowerShell 工具",
	pluginDesc_tool_pwsh: "模型可调用的 PowerShell 工具（Windows）",
	pluginName_tool_fs: "文件工具",
	pluginDesc_tool_fs: "模型可调用：读取 / 写入 / 列目录",
	pluginName_tool_fs_search: "文件搜索工具",
	pluginDesc_tool_fs_search: "模型可调用：文件名 / 内容搜索",
	pluginName_tool_str_replace_editor: "精确编辑工具",
	pluginDesc_tool_str_replace_editor: "str_replace 精确替换编辑（避免整文件重写）",
	pluginName_web_search: "联网搜索",
	pluginDesc_web_search: "Web 搜索 + 网页抓取（DeepSeek 搜索提供者）",
	pluginName_code_runtime: "Code 运行时",
	pluginDesc_code_runtime: "PTC 模式：host 平面 TypeScript 运行时（Code Mode SDK 执行引擎）",
	pluginName_tool_presentation: "工具呈现（Code Mode）",
	pluginDesc_tool_presentation: "PTC 模式：把工具呈现为 run_code + 生成 SDK，模型用 TS 程序组合多步操作（需同时启用 Code 运行时）",
	pluginName_tool_cordis: "Cordis 工具集",
	pluginDesc_tool_cordis: "创造模式：自省运行时、挂载/卸载模型编写的插件（信任边界）",
	pluginName_skill_filesystem: "Skills 文件系统",
	pluginDesc_skill_filesystem: "创造模式：从随包 skills 目录发现组合创作指导技能",
	pluginName_tool_skill: "Skills 工具",
	pluginDesc_tool_skill: "创造模式：技能目录与加载器（含随包 skills）",

	/* settings — plugin cards (AgentLoop / Bash / WebSearch) */
	agentLoopTitle: "AgentLoop（并行工具调用）",
	agentLoopDescription: "每个回合最多并行执行的工具调用数（写入 agent-core 配置）",
	agentLoopMaxParallel: "最大并行工具调用数",
	agentLoopMaxParallelHint: "同一回合并行执行的工具调用上限，正整数（默认 {n}）",
	bashTitle: "Bash（Shell 执行器）",
	bashDescription: "shell 命令的执行时限与输出上限（bash-local 配置，Windows 上为 PowerShell 接管）",
	bashTimeoutMs: "命令超时（毫秒）",
	bashTimeoutMsHint: "单条命令的最大执行时长（默认 {n}）",
	bashMaxOutputBytes: "最大输出字节数",
	bashMaxOutputBytesHint: "单条命令输出截断上限（默认 {n}）",
	webSearchTitle: "WebSearch（联网搜索）",
	webSearchDescription: "搜索端点、每轮搜索上限与密钥（web-search-deepseek 配置）",
	webSearchApiKey: "API Key",
	webSearchApiKeyHint: "留空使用 DEEPSEEK_API_KEY 环境变量",
	webSearchApiKeySet: "已配置",
	webSearchApiKeyUnset: "未配置（用环境变量）",
	webSearchBaseUrl: "搜索端点",
	webSearchBaseUrlHint: "DeepSeek Anthropic 兼容 API（默认 {n}）",
	webSearchMaxUses: "每轮搜索上限",
	webSearchMaxUsesHint: "一次会话轮内允许的搜索次数（默认 {n}）",
	cardExpand: "展开",
	cardCollapse: "收起",
	cardUnsaved: "有未保存修改",
	cardReadOnly: "当前预设不可写（内置预设仅可调整插件开关）",
	cardSave: "保存",
	cardSaving: "保存中…",
	cardDiscard: "放弃",
	cardSaveFailed: "保存失败，请重试",
	cardPluginOffHint: "该插件当前已停用——保存后需在插件列表开启才生效。",
	invalidNumber: "请输入正整数",

	/* settings — presets roster */
	builtInGroup: "内置预设",
	customGroup: "自定义预设",
	presetBuiltIn: "内置",
	presetCustom: "自定义",
	presetDefault: "默认",
	presetActive: "使用中",
	presetSetDefault: "设为默认",
	presetUse: "使用此预设",
	presetNoDescription: "（无描述）",
	presetView: "查看",
	presetEdit: "编辑",
	presetCopy: "复制",
	presetDelete: "删除",
	presetCopyTitle: "复制预设",
	presetCopyOf: "复制自",
	presetCopyIntro: "基于现有预设创建新的自定义预设，可随后在设置中调整。",
	presetId: "预设 ID",
	presetIdPlaceholder: "如 my-agent（字母、数字、-、_ 或 .）",
	presetDisplayName: "显示名称",
	presetDisplayNamePh: "预设的显示名称",
	presetCreate: "创建",
	presetCreating: "创建中…",
	presetEditTitle: "编辑预设",
	presetEditIntro: "修改显示名称与描述。插件的启停与配置请先「使用」该预设，再在「插件」标签调整。",
	presetExtraRows: "高级 · 额外组合行（cordis YAML）",
	presetExtraRowsHint: "追加到该预设生成的 cordis.yml 末尾的自定义插件行，如 persona / skills / 额外插件。仅对自定义预设生效，保存后重启 runtime。",
	presetDeleteTitle: "删除预设",
	presetDeleteDesc: "删除后无法恢复；正在使用该预设的对话不受影响。",
	presetDeleteConfirm: "删除",
	presetDeleting: "删除中…",
	presetViewTitle: "查看 · {name}",
	presetViewDesc: "该预设生成的运行时组合配置（cordis.yml），仅供阅读。",
	presetSeatHint: "为当前会话选择 Agent 预设（重启运行时，下次请求生效）",
	presetSeatLabel: "预设",
	presetSwitched: "已切换预设为「{name}」，runtime 已重启（下次请求生效）。",
	presetSaveApplied: "插件设置已保存，runtime 已重启（下次请求生效）。",
	presetCreateDone: "预设「{name}」已创建。",
} as const;

/* ------------------------------------------------------------------ */
/* en                                                                  */
/* ------------------------------------------------------------------ */

const en: Record<keyof typeof zh, string> = {
	/* common */
	cancel: "Cancel",
	ok: "OK",
	save: "Save",
	close: "Close",
	loading: "Loading…",
	connected: "Connected",
	connecting: "Connecting…",
	reconnecting: "Reconnecting…",
	language: "Language",
	langZh: "中文",
	langEn: "English",
	githubRepo: "GitHub repository (xing-shuyin/ds-web-ui)",
	copy: "Copy",

	/* topbar */
	viewSwitch: "Switch view",
	chat: "Chat",
	terminal: "Terminal",
	selectModel: "Select model",
	availableModels: "Available models",
	noModels: "No models available (configure an API key first)",
	reasoning: "reasoning",
	vision: "vision",
	refreshModels: "Refresh model list",
	manageModels: "⚙ Manage models (add / edit)",
	manageModelsTitle: "Manage models",
	thinkingLevel: "Thinking level",
	thinking: "Thinking",
	thinkingChip: "Thinking: {level}",
	sound: "Sound",
	newChat: "New chat",
	more: "More",
	newChatTip: "New chat (sessions are saved per browser)",
	"thinking.off": "Off",
	"thinking.minimal": "Minimal",
	"thinking.low": "Low",
	"thinking.medium": "Medium",
	"thinking.high": "High",
	"thinking.xhigh": "Extra high",
	"thinking.max": "Max",
	thinkingUnsupported:
		"Not supported by this model — snapped to the nearest supported level",

	/* footerbar */
	context: "Context",
	contextUsage: "Context usage",
	cumulativeCost: "Cumulative cost",
	sessionMessages: "Session messages",
	messages: "messages",
	pluginStatus: "Plugin status",
	working: "Working",
	queued: "queued",
	enterPath: "Type a path, Enter to switch",
	cwdTip: "Working directory: {path} (click to switch)",

	/* chat input */
	folderRef: "Folder reference: {path}",
	refOnly: "Reference only: {path}",
	attachContent: "Attached content: {path}",
	attachLines: "Attached selected lines: {path} (lines {start}-{end})",
	attachImage: "Image: {name}",
	attachFile: "File: {name}",
	removeAttachment: "Remove attachment",
	attachHint: "Will be sent with the next message",
	uploadFile: "Add files (images / text / any file — or drag in / paste a screenshot)",
	dropHereToAttach: "Release to attach file",
	imageNotSupported: "The current model doesn't support vision — the image may be ignored",
	imageLoadFailed: "Couldn't read image: {name}",
	fileLoadFailed: "Couldn't read file: {name}",
	fileTooLarge: "File too large, skipped (> {size}MB): {name}",
	foldersNotSupported: "Folders can't be dropped directly — expand and pick files instead",
	followUpQueued: "⏳ {n} follow-up message(s) queued",
	steeringQueued: "⏳ {n} steering message(s) queued",
	placeholderStreaming: "The agent is working… (messages will queue)",
	placeholderIdle: "Message pi — Enter to send, Shift+Enter for newline",
	placeholderConnecting: "Connecting to server…",
	stopAgent: "Stop agent",
	stop: "Stop",
	supplement: "Follow-up",
	supplementTip: "Send immediately after the current reply finishes",
	sendTip: "Send (Enter)",

	/* left panel */
	recentProjects: "Recent projects",
	runningConversations: "Running chats",
	historySessions: "History",
	openHistory: "History",
	openFiles: "Files",	streaming: "Streaming…",
	noHistory: "No previous chats",
	current: "Current",
	messageCount: "{n} messages",
	tuiTip: "Chat in the pi terminal (TUI)",
	emptyChat: "Empty chat",

	/* message edit */
	editReask: "Edit & re-ask",
	editReaskTip:
		"Edit this question and re-ask from here (forks a new conversation; the original is kept)",
	reaskFromHere: "Re-ask from here",
	editPlaceholder: "Edit the question…",
	editHint: "⌘/Ctrl+Enter to submit · Esc to cancel",

	/* collapsed old messages */
	expandMsg: "Expand",
	collapseMsg: "Collapse",
	toolCalls: "tool calls",
	bashRuns: "bash runs",
	images: "images",

	/* self-update */
	update: "Update",
	updateTip: "Check & update ds-web-ui",
	currentVersion: "Current version",
	latestVersion: "Latest version",
	checkingUpdate: "Checking…",
	checkUpdate: "Check for updates",
	upToDate: "You're up to date",
	updateAvailable: "New version v{version} available",
	updateJustPublished:
		"v{version} was just published — npm cache may lag; if the new version isn't detected yet, re-check in a moment",
	updateNow: "Update now",
	confirmUpdate: "Confirm (replaces global install)",
	updateSuccess: "✅ Updated — restarting…",
	updateFailed: "Update failed: {detail}",
	restartHint: "Restart: ds-web-ui server restart",

	/* right panel */
	rootDir: "Root",
	noFiles: "No files",
	filesTruncated: "Directory too large — list truncated (first 2000 shown)",
	linkFolderTip: "Link folder path to chat",
	attachInlineTip: "Attach content to chat",
	referenceTip: "Reference path only (AI reads on demand)",
	previewFile: "Preview",
	downloadFile: "Download file",
	downloadFailed: "Download failed: {error}",

	/* file preview */
	selectLinesHint: "Click a line to select; drag or Shift+click for a range",
	selectedRange: "Selected {n} lines (lines {start}-{end})",
	fileLines: "{n} lines",
	selectAll: "Select all",
	clearSelection: "Clear",
	addToChat: "Add to chat",
	addedToChat: "Added",
	previewTruncated: "⚠ File too large — previewing the first 512KB",
	previewLinesTruncated: "… too many lines — showing the first {n}",
	binaryFile: "🔣 Binary file — first 4KB shown as hex",
	binaryHexTruncated: " (file larger — download for the full file)",
	previewNotSupported:
		"This file type can't be previewed (only images / videos / text)",
	emptyFile: "(empty file)",

	/* dialog */
	pluginRequest: "Plugin request",
	noOptions: "(no options)",
	inputPlaceholder: "Enter content",

	/* sound settings */
	soundHeader: "Sound notifications",
	enableSound: "Enable sound",
	preview: "Preview",
	volume: "Volume",
	"sound.question": "Question popup",
	"sound.question.desc": "When ask_user_question appears",
	"sound.done": "Reply finished",
	"sound.done.desc": "When the agent finishes a turn",
	"sound.start": "Reply started",
	"sound.start.desc": "When the agent starts a new turn",
	"sound.error": "Error",
	"sound.error.desc": "When an error notice appears",

	/* pi setup modal */
	setupTitle: "pi agent config not detected",
	setupDesc:
		"ds-web-ui needs pi's config directory (~/.pi/agent) and at least one API key to run the agent. pi has built-in providers such as openai, anthropic, and deepseek — just pick one and enter a key, no terminal needed.",
	installFailed: "✖ pi agent installation failed:",
	retryInstall: "Retry install",
	skip: "Skip",
	installDone:
		"✅ pi agent CLI installed. Pick a provider and enter an API key to start chatting:",
	provider: "Provider",
	configured: "configured",
	providerKeyReady: "This provider already has a key — use it or replace it.",
	apiKey: "API key",
	saving: "Saving…",
	saveAndStart: "Save and start using",
	recheck: "Recheck",
	installing: "Installing pi agent CLI…",
	autoInstall: "Auto-install pi agent",

	/* messages */
	attachment: "Attachment",
	plugin: "plugin",
	unknown: "unknown",
	thinkingWait: "Thinking",
	exitCode: "Exit code {code}",
	cancelled: "Cancelled",
	truncated: "… content too long, truncated in this view",
	outputTruncated: "… output too long, truncated in this view",
	refOnlyShort: "Reference only",
	folderRefShort: "Folder · reference only",
	inlineLines: "Inline · {n} lines",
	inlineLinesRange: "Lines {start}-{end}",
	image: "🖼 Image",
	folderNotExpanded:
		"Folder — content not expanded, the agent will browse it as needed",
	fileNotExpanded:
		"Large file ({size}) — content not expanded, the agent will read it as needed",
	"role.user": "You",
	"role.assistant": "DSH",
	"role.tool": "Tool",
	"role.bash": "Terminal",
	"role.branch": "Branch summary",
	"role.compaction": "Context compacted",

	/* welcome / message list */
	welcomeTitle: "DSH coding agent",
	welcomeSub: "Inspect, edit, run — always ready",
	directory: "Directory",
	clickToFill: "Click to fill input",
	waitingResponse: "Waiting for model response…",
	backToBottom: "Back to bottom",
	questionNavTitle: "Questions",
	questionNavTip: "All questions in this conversation — hover to expand, click to jump",
	"ex.understand": "Understand this project",
	"ex.understand.prompt":
		"Introduce this project: overall structure, main modules, and how to run it?",
	"ex.debug": "Debug an issue",
	"ex.debug.prompt":
		"Help me debug a bug — describe the symptom first, and I'll add details.",
	"ex.test": "Write tests",
	"ex.test.prompt": "Write unit tests for the core modules.",
	"ex.review": "Code review",
	"ex.review.prompt":
		"Review the recently changed code and point out potential issues and improvements.",

	/* tool call block */
	error: "Error",
	done: "Done",
	running: "Running…",
	toolQueued: "Queued",
	copyArgs: "Copy args",
	errorOutput: "Error output",
	output: "Output",
	waitingOutput: "Waiting for output…",
	toolDoneWaitingModel: "Done · waiting on model",
	waitingModel: "Waiting for model response…",

	/* thinking block */
	thinkingNow: "Thinking",
	thinkingPreview: "Thinking: {preview}",

	/* terminal panel */
	commands: "Commands",
	newCommand: "New command",
	newTerminal: "New terminal",
	name: "Name",
	command: "Command",
	cwdHint: "(${pwd} = current working directory)",
	noCommands: "No commands yet — click + to add one",
	clickToRun: "Click to run",
	edit: "Edit",
	delete: "Delete",
	confirmQ: "Confirm?",
	builtinTerminal: "Built-in terminal",
	termEmptySub:
		"Click a command on the left to run it, or + on the right for a new terminal",
	noTerminal: "No terminals",
	exited: "(exited{code})",
	closeTerminal: "Close terminal",
	rerun: "Reload .pi/commands.json",
	terminalTitle: "Terminal {n}",
	exampleName: "e.g. start dev server",
	exampleCommand: "e.g. npm run dev",

	/* model config modal */
	editProvider: "Edit provider",
	builtinProviders: "Built-in providers",
	hintKeyOnly: "Just enter an API key",
	configuredBadge: "✓ Configured",
	keyReady: "Key ready",
	pasteKey: "Paste API key…",
	savingKey: "Saving",
	saveKey: "Save key",
	customProviders: "Custom providers",
	customDesc:
		"For Ollama / vLLM / OpenAI-compatible proxies, etc. Written to pi's models.json — hot-reloaded immediately.",
	noCustomProviders: "No custom providers yet",
	modelsCount: "{n} models",
	addProvider: "Add provider",
	providerId: "Provider ID",
	providerIdHint: "(required, e.g. ollama / my-proxy)",
	displayName: "Display name",
	displayNamePh: "My proxy",
	apiType: "API type",
	baseUrlHint: "(OpenAI-compatible endpoint)",
	apiKeyHint: "sk-… (optional — uses the auth.json key)",
	authHeader: "Auto-add Authorization header",
	modelsTitle: "Models",
	modelIdReq: "Model ID (required)",
	text: "Text",
	textImage: "Text+image",
	contextWindow: "Context",
	maxOutput: "Max output",
	removeModel: "Remove model",
	addModel: "Add model",
	deleteProviderConfirm: "Delete provider {id} and its {n} models?",

	/* app */
	loadingSession: "Loading session…",
	connectingServer: "Connecting to ds-web-ui server…",

	/* settings — entry + modal */
	settings: "Settings",
	settingsTitle: "Settings",
	settingsOpen: "Open settings (plugins / agent presets)",
	settingsPluginsTab: "Plugins",
	settingsPresetsTab: "Agent presets",
	settingsLoading: "Loading settings…",
	settingsError: "Failed to load settings",
	settingsRetry: "Retry",
	settingsPluginsIntro:
		"Enable/disable the bundled DSH plugins and tune the configurable ones. Changes are saved into the active preset and the runtime restarts to apply them.",
	settingsPresetsIntro:
		"An agent preset decides which plugins and configs the runtime loads. Click a card to make it the default; “Use” applies it to the current conversation (restarts the runtime; effective on the next request).",
	editingPresetFor: "Editing preset: {name}",
	editingPresetHint: "Plugin toggles and configs are saved with the preset; switch presets on the “Agent presets” tab.",
	saveAndRestart: "Apply changes",
	savingAndRestarting: "Applying & restarting…",
	applyHint: "The runtime restarts after saving; the changes take effect on the next request.",
	unsavedChanges: "Unsaved changes",

	/* settings — plugin inventory */
	pluginCoreBadge: "CORE",
	pluginGroupCore: "Core",
	pluginGroupShell: "Shell",
	pluginGroupFiles: "File tools",
	pluginGroupWeb: "Web",
	pluginGroupCode: "PTC mode",
	pluginGroupCreator: "Creator mode",
	pluginEnabled: "Enabled",
	pluginDisabled: "Disabled",
	pluginRequiredHint: "Core plugins cannot be disabled (the agent would not boot)",
	pluginDisabledOnPlatform: "(auto-disabled on this platform)",
	pluginOn: "On",
	pluginOff: "Off",

	/* settings — plugin names & descriptions (inventory rows) */
	pluginName_sdk_jsonrpc_server: "JSON-RPC server",
	pluginDesc_sdk_jsonrpc_server: "Stdio JSON-RPC server entry (SDK communication core)",
	pluginName_agent_core: "Agent core (AgentLoop)",
	pluginDesc_agent_core: "Agent loop: session orchestration, tool dispatch, system prompt and context injection",
	pluginName_llm_deepseek: "DeepSeek model adapter",
	pluginDesc_llm_deepseek: "Official DeepSeek model access (deepseek-v4-flash / v4-pro)",
	pluginName_sessions: "Session persistence",
	pluginDesc_sessions: "JSONL session persistence (<dataDir>/sessions)",
	pluginName_session_checkpoints: "Session checkpoints",
	pluginDesc_session_checkpoints: "Durability checkpoints for request / tool dispatch / completed steps",
	pluginName_subprocess: "Subprocess manager",
	pluginDesc_subprocess: "Managed child-process groups (used by the shell executor)",
	pluginName_fs_local: "Local filesystem",
	pluginDesc_fs_local: "Workspace filesystem provider (tool-layer dependency)",
	pluginName_bash: "Bash executor",
	pluginDesc_bash: "POSIX shell executor (auto-disabled on Windows)",
	pluginName_pwsh: "PowerShell executor",
	pluginDesc_pwsh: "Windows PowerShell executor (auto-disabled elsewhere)",
	pluginName_tool_pwsh: "PowerShell tool",
	pluginDesc_tool_pwsh: "Model-facing PowerShell tool (Windows)",
	pluginName_tool_fs: "File tools",
	pluginDesc_tool_fs: "Model-facing: read / write / list directory",
	pluginName_tool_fs_search: "File search tool",
	pluginDesc_tool_fs_search: "Model-facing: filename / content search",
	pluginName_tool_str_replace_editor: "Precise edit tool",
	pluginDesc_tool_str_replace_editor: "str_replace exact-match editing (avoids full-file rewrites)",
	pluginName_web_search: "Web search",
	pluginDesc_web_search: "Web search + page fetch (DeepSeek search provider)",
	pluginName_code_runtime: "Code runtime",
	pluginDesc_code_runtime: "PTC mode: host-plane TypeScript runtime (Code Mode SDK execution engine)",
	pluginName_tool_presentation: "Tool presentation (Code Mode)",
	pluginDesc_tool_presentation: "PTC mode: presents tools as run_code + generated SDK so the model composes multi-step operations in one TS program (needs the Code runtime enabled)",
	pluginName_tool_cordis: "Cordis toolset",
	pluginDesc_tool_cordis: "Creator mode: inspect the live runtime, mount/dispose model-written plugins (trust boundary)",
	pluginName_skill_filesystem: "Skills filesystem",
	pluginDesc_skill_filesystem: "Creator mode: discovers the bundled composition-authoring skills from vendor/runtime/skills",
	pluginName_tool_skill: "Skills tool",
	pluginDesc_tool_skill: "Creator mode: skill catalog and loader (incl. bundled skills)",

	/* settings — plugin cards (AgentLoop / Bash / WebSearch) */
	agentLoopTitle: "AgentLoop (parallel tool calls)",
	agentLoopDescription: "Max tool calls executed in parallel per step (written into agent-core config)",
	agentLoopMaxParallel: "Max parallel tool calls",
	agentLoopMaxParallelHint: "Upper bound on in-flight tool calls per step, positive integer (default {n})",
	bashTitle: "Bash (shell executor)",
	bashDescription: "Shell command timeout and output cap (bash-local config; PowerShell takes over on Windows)",
	bashTimeoutMs: "Command timeout (ms)",
	bashTimeoutMsHint: "Max duration of one command (default {n})",
	bashMaxOutputBytes: "Max output bytes",
	bashMaxOutputBytesHint: "Output truncation cap for one command (default {n})",
	webSearchTitle: "WebSearch (web search)",
	webSearchDescription: "Search endpoint, per-round search cap and API key (web-search-deepseek config)",
	webSearchApiKey: "API key",
	webSearchApiKeyHint: "Leave empty to use the DEEPSEEK_API_KEY env var",
	webSearchApiKeySet: "Configured",
	webSearchApiKeyUnset: "Unset (env fallback)",
	webSearchBaseUrl: "Search endpoint",
	webSearchBaseUrlHint: "DeepSeek Anthropic-compatible API (default {n})",
	webSearchMaxUses: "Max searches per round",
	webSearchMaxUsesHint: "Allowed searches per conversation round (default {n})",
	cardExpand: "Expand",
	cardCollapse: "Collapse",
	cardUnsaved: "Unsaved edits",
	cardReadOnly: "This preset is read-only (built-in presets only allow plugin toggles)",
	cardSave: "Save",
	cardSaving: "Saving…",
	cardDiscard: "Discard",
	cardSaveFailed: "Save failed, please retry",
	cardPluginOffHint: "This plugin is currently disabled — enable it in the plugin list for the config to take effect.",
	invalidNumber: "Enter a positive integer",

	/* settings — presets roster */
	builtInGroup: "Built-in presets",
	customGroup: "Custom presets",
	presetBuiltIn: "BUILT-IN",
	presetCustom: "CUSTOM",
	presetDefault: "Default",
	presetActive: "In use",
	presetSetDefault: "Make default",
	presetUse: "Use this preset",
	presetNoDescription: "(no description)",
	presetView: "View",
	presetEdit: "Edit",
	presetCopy: "Duplicate",
	presetDelete: "Delete",
	presetCopyTitle: "Duplicate preset",
	presetCopyOf: "Copy of",
	presetCopyIntro: "Creates a new custom preset from an existing one; tune it afterwards in Settings.",
	presetId: "Preset ID",
	presetIdPlaceholder: "e.g. my-agent (letters, digits, -, _ or .)",
	presetDisplayName: "Display name",
	presetDisplayNamePh: "Display name of the preset",
	presetCreate: "Create",
	presetCreating: "Creating…",
	presetEditTitle: "Edit preset",
	presetEditIntro: "Change the display name and description. To tune plugins/configs, “Use” the preset first, then adjust it on the Plugins tab.",
	presetExtraRows: "Advanced · extra composition rows (cordis YAML)",
	presetExtraRowsHint: "Custom plugin rows appended to this preset's generated cordis.yml (persona / skills / extra plugins). Custom presets only; the runtime restarts after saving.",
	presetDeleteTitle: "Delete preset",
	presetDeleteDesc: "This cannot be undone; conversations using the preset are unaffected.",
	presetDeleteConfirm: "Delete",
	presetDeleting: "Deleting…",
	presetViewTitle: "View · {name}",
	presetViewDesc: "The runtime composition (cordis.yml) this preset generates, read-only.",
	presetSeatHint: "Choose the agent preset for the current conversation (restarts the runtime; effective on the next request)",
	presetSeatLabel: "Preset",
	presetSwitched: "Switched preset to “{name}”; runtime restarted (effective on the next request).",
	presetSaveApplied: "Plugin settings saved; runtime restarted (effective on the next request).",
	presetCreateDone: "Preset “{name}” created.",
};

/* ------------------------------------------------------------------ */
/* context + hook                                                      */
/* ------------------------------------------------------------------ */

export type Translate = (
	key: keyof typeof zh,
	vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function loadLocale(): Locale {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === "zh" || saved === "en") return saved;
	} catch {
		// localStorage unavailable — fall through to the default.
	}
	return "zh"; // default: Chinese
}

export function LanguageProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(loadLocale);

	const setLocale = useCallback((l: Locale) => {
		setLocaleState(l);
		try {
			localStorage.setItem(STORAGE_KEY, l);
		} catch {
			// ignore storage errors
		}
	}, []);

	const t = useCallback<Translate>(
		(key, vars) => {
			let str: string = en[key];
			if (locale === "zh") str = zh[key];
			if (vars) {
				for (const [k, v] of Object.entries(vars)) {
					str = str.replaceAll(`{${k}}`, String(v));
				}
			}
			return str;
		},
		[locale],
	);

	useEffect(() => {
		document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
	}, [locale]);

	const value = useMemo(
		() => ({ locale, setLocale, t }),
		[locale, setLocale, t],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
	return ctx;
}

/** Convenience: translation function only. */
export function useT(): Translate {
	return useI18n().t;
}
