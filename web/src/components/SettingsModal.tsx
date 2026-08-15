/**
 * SettingsModal — ds-web-ui settings: the bundled plugin inventory with
 * enable/disable toggles, the configurable plugin cards (AgentLoop / Bash /
 * WebSearch), and the agent-preset roster (list / create-by-copy / edit /
 * delete / set default / use now), modeled on the official DSH web Settings.
 *
 * Wire protocol: `list_settings` loads the snapshot; mutations
 * (save_active_preset / set_preset / create_preset / update_preset /
 * delete_preset / set_default_preset / view_preset) push a fresh `settings`
 * (or `preset_view`) message back, which resets the local drafts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	FiChevronDown,
	FiCopy,
	FiEdit2,
	FiEye,
	FiSettings,
	FiTrash2,
	FiX,
} from "react-icons/fi";
import type {
	AgentPreset,
	AgentPresetConfig,
	ClientMessage,
	PluginInfo,
	SettingsSnapshot,
} from "../types";
import type { ChatState } from "../use-chat";
import { useT } from "../i18n";

interface SettingsModalProps {
	chat: ChatState;
	send: (msg: ClientMessage) => boolean;
	onClose: () => void;
}

type Tab = "plugins" | "presets";

/** String keys of the configurable plugin cards. */
type CardKey = "agentLoop" | "bash" | "webSearch";
const CARD_KEYS: CardKey[] = ["agentLoop", "bash", "webSearch"];

/** Map plugin id → display copy keys (inventory rows). */
function pluginCopy(id: string): { nameKey: string; descKey: string } {
	const k = id.replace(/-/g, "_");
	return { nameKey: `pluginName_${k}`, descKey: `pluginDesc_${k}` };
}

const PLUGIN_GROUPS: { key: PluginInfo["group"]; labelKey: string }[] = [
	{ key: "core", labelKey: "pluginGroupCore" },
	{ key: "shell", labelKey: "pluginGroupShell" },
	{ key: "files", labelKey: "pluginGroupFiles" },
	{ key: "web", labelKey: "pluginGroupWeb" },
	{ key: "code", labelKey: "pluginGroupCode" },
	{ key: "creator", labelKey: "pluginGroupCreator" },
];

/** Empty draft for one card (all fields as text). */
function emptyCardDraft(): Record<string, string> {
	return { maxParallelToolCalls: "", timeoutMs: "", maxOutputBytes: "", baseURL: "", maxUses: "", apiKey: "" };
}

/** Card field specs: which fields each card owns, and their kind. */
const CARD_FIELDS: Record<CardKey, { key: string; label: string; hint: string; numeric?: boolean; secret?: boolean }[]> = {
	agentLoop: [
		{
			key: "maxParallelToolCalls",
			label: "agentLoopMaxParallel",
			hint: "agentLoopMaxParallelHint",
			numeric: true,
		},
	],
	bash: [
		{ key: "timeoutMs", label: "bashTimeoutMs", hint: "bashTimeoutMsHint", numeric: true },
		{ key: "maxOutputBytes", label: "bashMaxOutputBytes", hint: "bashMaxOutputBytesHint", numeric: true },
	],
	webSearch: [
		{ key: "apiKey", label: "webSearchApiKey", hint: "webSearchApiKeyHint", secret: true },
		{ key: "baseURL", label: "webSearchBaseUrl", hint: "webSearchBaseUrlHint" },
		{ key: "maxUses", label: "webSearchMaxUses", hint: "webSearchMaxUsesHint", numeric: true },
	],
};

const CARD_TITLES: Record<CardKey, { title: string; desc: string }> = {
	agentLoop: { title: "agentLoopTitle", desc: "agentLoopDescription" },
	bash: { title: "bashTitle", desc: "bashDescription" },
	webSearch: { title: "webSearchTitle", desc: "webSearchDescription" },
};

export function SettingsModal({ chat, send, onClose }: SettingsModalProps) {
	const t = useT();
	const settings = chat.settings;
	const [tab, setTab] = useState<Tab>("plugins");
	const [request, setRequest] = useState(0);
	const [loading, setLoading] = useState(settings === null);
	const [error, setError] = useState(false);

	// Reload on first open; server pushes `settings` on every mutation.
	useEffect(() => {
		setLoading(true);
		send({ type: "list_settings" });
		const timer = setTimeout(() => setLoading(false), 1500);
		return () => clearTimeout(timer);
	}, [request, send]);

	useEffect(() => {
		if (settings !== null) {
			setLoading(false);
			setError(false);
		}
	}, [settings]);

	const activePreset = useMemo(
		() => settings?.presets.find((p) => p.isActive) ?? null,
		[settings],
	);
	const activeSig = useMemo(
		() =>
			settings && activePreset
				? `${settings.activePresetId}|${JSON.stringify(activePreset.plugins)}|${JSON.stringify(activePreset.config)}`
				: "",
		[settings, activePreset],
	);

	// -- plugin inventory draft ---------------------------------------------
	const [draftPlugins, setDraftPlugins] = useState<Record<string, boolean>>({});
	const [cardsOpen, setCardsOpen] = useState<Record<CardKey, boolean>>({
		agentLoop: false,
		bash: false,
		webSearch: false,
	});
	const [cardDrafts, setCardDrafts] = useState<Record<CardKey, Record<string, string>>>({
		agentLoop: emptyCardDraft(),
		bash: emptyCardDraft(),
		webSearch: emptyCardDraft(),
	});
	const [savingPlugins, setSavingPlugins] = useState(false);
	const [savingCard, setSavingCard] = useState<CardKey | null>(null);
	const [cardInvalid, setCardInvalid] = useState<Record<CardKey, Record<string, boolean>>>({
		agentLoop: {},
		bash: {},
		webSearch: {},
	});

	// Reset drafts whenever the underlying active preset changes (initial
	// load, save round-trip, preset switch, external change).
	useEffect(() => {
		if (!activePreset) return;
		setDraftPlugins({ ...activePreset.plugins });
		const drafts: Record<CardKey, Record<string, string>> = {
			agentLoop: emptyCardDraft(),
			bash: emptyCardDraft(),
			webSearch: emptyCardDraft(),
		};
		const cfg = activePreset.config;
		if (cfg.agentLoop?.maxParallelToolCalls) drafts.agentLoop.maxParallelToolCalls = String(cfg.agentLoop.maxParallelToolCalls);
		if (cfg.bash?.timeoutMs) drafts.bash.timeoutMs = String(cfg.bash.timeoutMs);
		if (cfg.bash?.maxOutputBytes) drafts.bash.maxOutputBytes = String(cfg.bash.maxOutputBytes);
		if (cfg.webSearch?.baseURL) drafts.webSearch.baseURL = cfg.webSearch.baseURL;
		if (cfg.webSearch?.maxUses) drafts.webSearch.maxUses = String(cfg.webSearch.maxUses);
		// apiKey is write-only: always starts blank, badge reports configured.
		setCardDrafts(drafts);
		setCardInvalid({ agentLoop: {}, bash: {}, webSearch: {} });
		setSavingPlugins(false);
		setSavingCard(null);
	}, [activeSig, activePreset]);

	const pluginsDirty = useMemo(() => {
		if (!activePreset) return false;
		return Object.keys(activePreset.plugins).some(
			(k) => (activePreset.plugins[k] ?? false) !== (draftPlugins[k] ?? false),
		);
	}, [activePreset, draftPlugins]);

	const applyPlugins = () => {
		setSavingPlugins(true);
		send({ type: "save_active_preset", plugins: { ...draftPlugins } });
	};

	// -- config card drafts ---------------------------------------------------
	const cardField = (card: CardKey, field: string): string => cardDrafts[card][field] ?? "";
	const setCardField = (card: CardKey, field: string, value: string) => {
		setCardDrafts((prev) => ({ ...prev, [card]: { ...prev[card], [field]: value } }));
		setCardInvalid((prev) => ({ ...prev, [card]: { ...prev[card], [field]: false } }));
	};

	/** Validate one card's draft; returns the config payload or null (invalid). */
	const cardPayload = (card: CardKey): Partial<AgentPresetConfig> | null => {
		const d = cardDrafts[card];
		const invalid: Record<string, boolean> = {};
		const num = (v: string) => {
			if (v.trim() === "") return undefined;
			const n = Number(v);
			if (!Number.isInteger(n) || n < 1) {
				return { bad: true as const };
			}
			return { bad: false as const, value: n };
		};
		const out: Partial<AgentPresetConfig> = {};
		if (card === "agentLoop") {
			const v = num(d.maxParallelToolCalls);
			if (v && v.bad) invalid.maxParallelToolCalls = true;
			else out.agentLoop = { maxParallelToolCalls: v ? v.value : undefined };
		} else if (card === "bash") {
			const to = num(d.timeoutMs);
			const mo = num(d.maxOutputBytes);
			if (to && to.bad) invalid.timeoutMs = true;
			if (mo && mo.bad) invalid.maxOutputBytes = true;
			out.bash = {
				timeoutMs: to && !to.bad ? to.value : undefined,
				maxOutputBytes: mo && !mo.bad ? mo.value : undefined,
			};
		} else {
			const mu = num(d.maxUses);
			if (mu && mu.bad) invalid.maxUses = true;
			if (d.baseURL.trim() !== "" && !/^https?:\/\//i.test(d.baseURL.trim())) {
				invalid.baseURL = true;
			}
			out.webSearch = {
				baseURL: d.baseURL.trim() === "" ? undefined : d.baseURL.trim(),
				maxUses: mu && !mu.bad ? mu.value : undefined,
				apiKey: d.apiKey, // empty string clears the stored key
			};
		}
		const hasInvalid = Object.values(invalid).some(Boolean);
		if (hasInvalid) {
			setCardInvalid((prev) => ({ ...prev, [card]: invalid }));
			return null;
		}
		return out;
	};

	const saveCard = (card: CardKey) => {
		const payload = cardPayload(card);
		if (!payload) return;
		setSavingCard(card);
		send({ type: "save_active_preset", config: payload });
	};

	// -- roster dialogs ------------------------------------------------------
	const [copy, setCopy] = useState<{ fromId: string; fromName: string; id: string; name: string; saving: boolean } | null>(null);
	const [edit, setEdit] = useState<
		{ id: string; name: string; description: string; extraRows: string; saving: boolean } | null
	>(null);
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [viewId, setViewId] = useState<string | null>(null);

	const openCopy = (from: AgentPreset) =>
		setCopy({ fromId: from.id, fromName: from.name, id: "", name: "", saving: false });
	const submitCopy = () => {
		if (!copy || copy.saving) return;
		if (!copy.id.trim()) return;
		setCopy({ ...copy, saving: true });
		send({ type: "create_preset", fromId: copy.fromId, id: copy.id.trim(), name: copy.name.trim() });
		// Recovery: if no settings push arrives (server rejected the id), let the
		// user correct the draft instead of staying stuck on “创建中…”.
		window.setTimeout(() => {
			setCopy((c) => (c && c.saving ? { ...c, saving: false } : c));
		}, 4000);
	};
	// Success = the created preset shows up in a fresh settings push.
	useEffect(() => {
		if (copy?.saving && settings && settings.presets.some((p) => p.id === copy.id)) {
			setCopy(null);
		}
	}, [settings, copy]);
	const openEdit = (p: AgentPreset) =>
		setEdit({ id: p.id, name: p.name, description: p.description, extraRows: p.extraRows ?? "", saving: false });
	const submitEdit = () => {
		if (!edit || edit.saving) return;
		setEdit({ ...edit, saving: true });
		send({
			type: "update_preset",
			id: edit.id,
			name: edit.name,
			description: edit.description,
			extraRows: edit.extraRows,
		});
		window.setTimeout(() => {
			setEdit((e) => (e && e.saving ? { ...e, saving: false } : e));
		}, 4000);
	};
	// Success = a fresh settings push arrives while saving (update_preset emits one).
	useEffect(() => {
		if (edit?.saving && settings) setEdit(null);
	}, [settings, edit]);
	const submitDelete = () => {
		if (!deleteId) return;
		send({ type: "delete_preset", id: deleteId });
		setDeleteId(null);
	};
	const openView = (id: string) => {
		setViewId(id);
		send({ type: "view_preset", id });
	};

	const usePreset = (id: string) => send({ type: "set_preset", id });

	const defaults = settings?.configDefaults;

	// ---------------------------------------------------------------- render

	if (error) {
		return (
			<div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
				<div className="modal settings-modal">
					<button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}>
						<FiX />
					</button>
					<div className="modal-head">
						<FiSettings className="modal-head-icon" />
						<h2>{t("settingsTitle")}</h2>
					</div>
					<p className="modal-desc" role="alert">
						{t("settingsError")}
					</p>
					<div className="modal-actions">
						<button type="button" className="btn" onClick={() => setRequest((r) => r + 1)}>
							{t("settingsRetry")}
						</button>
						<button type="button" className="btn primary" onClick={onClose}>
							{t("close")}
						</button>
					</div>
				</div>
			</div>
		);
	}

	const shownPreset = settings?.presets.find((p) => p.id === viewId) ?? null;
	const viewContent = chat.presetView?.id === viewId ? chat.presetView.content : null;

	return (
		<div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="modal settings-modal">
				<button type="button" className="modal-close" onClick={onClose} aria-label={t("close")}>
					<FiX />
				</button>
				<div className="modal-head">
					<FiSettings className="modal-head-icon" />
					<h2>{t("settingsTitle")}</h2>
				</div>

				<div className="settings-tabs" role="tablist" aria-label={t("settingsTitle")}>
					<button
						type="button"
						role="tab"
						aria-selected={tab === "plugins"}
						className={tab === "plugins" ? "active" : ""}
						onClick={() => setTab("plugins")}
					>
						{t("settingsPluginsTab")}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === "presets"}
						className={tab === "presets" ? "active" : ""}
						onClick={() => setTab("presets")}
					>
						{t("settingsPresetsTab")}
					</button>
				</div>

				{loading && !settings ? (
					<p className="settings-status">{t("settingsLoading")}</p>
				) : tab === "plugins" ? (
					<PluginsTab
						settings={settings}
						activePreset={activePreset}
						t={t as never}
						draftPlugins={draftPlugins}
						onToggle={(id, value) =>
							setDraftPlugins((prev) => ({ ...prev, [id]: value }))
						}
						pluginsDirty={pluginsDirty}
						applying={savingPlugins}
						onApply={applyPlugins}
						cardsOpen={cardsOpen}
						onToggleCard={(k) =>
							setCardsOpen((prev) => ({ ...prev, [k]: !prev[k] }))
						}
						cardDrafts={cardDrafts}
						cardInvalid={cardInvalid}
						cardField={cardField}
						setCardField={setCardField}
						savingCard={savingCard}
						onSaveCard={saveCard}
						onDiscardCard={(k) =>
							setCardDrafts((prev) => ({ ...prev, [k]: emptyCardDraft() }))
						}
					/>
				) : (
					<PresetsTab
						settings={settings}
						t={t as never}
						onMakeDefault={(id) => send({ type: "set_default_preset", id })}
						onUse={usePreset}
						onCopy={openCopy}
						onEdit={openEdit}
						onDelete={(id) => setDeleteId(id)}
						onView={openView}
					/>
				)}
			</div>

			{/* copy dialog */}
			{copy && (
				<div className="modal-backdrop settings-sub">
					<div className="modal settings-sub-modal">
						<div className="modal-head">
							<FiCopy className="modal-head-icon" />
							<h2>
								{t("presetCopyTitle")} · {t("presetCopyOf")} {copy.fromName}
							</h2>
						</div>
						<p className="modal-desc">{t("presetCopyIntro")}</p>
						<label className="settings-field">
							<span>{t("presetId")}</span>
							<input
								value={copy.id}
								autoFocus
								spellCheck={false}
								placeholder={t("presetIdPlaceholder")}
								onChange={(e) => setCopy({ ...copy, id: e.target.value })}
							/>
						</label>
						<label className="settings-field">
							<span>{t("presetDisplayName")}</span>
							<input
								value={copy.name}
								spellCheck={false}
								placeholder={t("presetDisplayNamePh")}
								onChange={(e) => setCopy({ ...copy, name: e.target.value })}
							/>
						</label>
						<div className="modal-actions">
							<button type="button" className="btn" onClick={() => setCopy(null)}>
								{t("cancel")}
							</button>
							<button
								type="button"
								className="btn primary"
								disabled={!copy.id.trim() || copy.saving}
								onClick={submitCopy}
							>
								{copy.saving ? t("presetCreating") : t("presetCreate")}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* edit dialog */}
			{edit && (
				<div className="modal-backdrop settings-sub">
					<div className="modal settings-sub-modal">
						<div className="modal-head">
							<FiEdit2 className="modal-head-icon" />
							<h2>{t("presetEditTitle")}</h2>
						</div>
						<p className="modal-desc">{t("presetEditIntro")}</p>
						<label className="settings-field">
							<span>{t("presetDisplayName")}</span>
							<input
								value={edit.name}
								autoFocus
								spellCheck={false}
								onChange={(e) => setEdit({ ...edit, name: e.target.value })}
							/>
						</label>
						<label className="settings-field">
							<span>{t("presetDisplayName")} · description</span>
							<textarea
								rows={3}
								value={edit.description}
								spellCheck={false}
								onChange={(e) => setEdit({ ...edit, description: e.target.value })}
							/>
						</label>
						<details className="settings-field settings-extra-rows">
							<summary>{t("presetExtraRows")}</summary>
							<p className="settings-field-hint">{t("presetExtraRowsHint")}</p>
							<textarea
								rows={8}
								value={edit.extraRows}
								spellCheck={false}
								placeholder="- id: my-tool\n  name: '@scope/my-plugin'"
								onChange={(e) => setEdit({ ...edit, extraRows: e.target.value })}
							/>
						</details>
						<div className="modal-actions">
							<button type="button" className="btn" onClick={() => setEdit(null)}>
								{t("cancel")}
							</button>
							<button
								type="button"
								className="btn primary"
								disabled={!edit.name.trim() || edit.saving}
								onClick={submitEdit}
							>
								{t("save")}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* delete confirm */}
			{deleteId && (
				<div className="modal-backdrop settings-sub">
					<div className="modal settings-sub-modal">
						<div className="modal-head">
							<FiTrash2 className="modal-head-icon danger" />
							<h2>{t("presetDeleteTitle")}</h2>
						</div>
						<p className="modal-desc">{t("presetDeleteDesc")}</p>
						<div className="modal-actions">
							<button type="button" className="btn" onClick={() => setDeleteId(null)}>
								{t("cancel")}
							</button>
							<button type="button" className="btn danger" onClick={submitDelete}>
								{t("presetDeleteConfirm")}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* composition viewer */}
			{viewId && shownPreset && (
				<div className="modal-backdrop settings-sub">
					<div className="modal settings-sub-modal settings-viewer">
						<div className="modal-head">
							<FiEye className="modal-head-icon" />
							<h2>{t("presetViewTitle", { name: shownPreset.name })}</h2>
						</div>
						<p className="modal-desc">{t("presetViewDesc")}</p>
						<pre className="settings-viewer-code">
							{viewContent ?? t("settingsLoading")}
						</pre>
						<div className="modal-actions">
							<button type="button" className="btn primary" onClick={() => setViewId(null)}>
								{t("close")}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------------ */
/* Plugins tab                                                               */
/* ------------------------------------------------------------------------ */

function PluginsTab(props: {
	settings: SettingsSnapshot | null;
	activePreset: AgentPreset | null;
	t: (k: string, vars?: Record<string, string | number>) => string;
	draftPlugins: Record<string, boolean>;
	onToggle: (id: string, value: boolean) => void;
	pluginsDirty: boolean;
	applying: boolean;
	onApply: () => void;
	cardsOpen: Record<CardKey, boolean>;
	onToggleCard: (k: CardKey) => void;
	cardDrafts: Record<CardKey, Record<string, string>>;
	cardInvalid: Record<CardKey, Record<string, boolean>>;
	cardField: (card: CardKey, field: string) => string;
	setCardField: (card: CardKey, field: string, value: string) => void;
	savingCard: CardKey | null;
	onSaveCard: (k: CardKey) => void;
	onDiscardCard: (k: CardKey) => void;
}) {
	const { t } = props;
	const settings = props.settings;
	if (!settings || !props.activePreset) {
		return <p className="settings-status">{t("settingsLoading")}</p>;
	}
	const platform = settings.platform;
	const configurableCards = CARD_KEYS.filter(
		(k) => settings.plugins.some((p) => p.configurable === k),
	);

	return (
		<div className="settings-plugins">
			<p className="settings-intro">{t("settingsPluginsIntro")}</p>
			<div className="settings-preset-banner">
				<span className="settings-preset-banner-name">{t("editingPresetFor", { name: props.activePreset.name })}</span>
				<span className="settings-preset-banner-hint">{t("editingPresetHint")}</span>
			</div>

			{PLUGIN_GROUPS.map((group) => {
				const rows = settings.plugins.filter((p) => p.group === group.key);
				if (rows.length === 0) return null;
				return (
					<section key={group.key} className="settings-group">
						<h3>{t(group.labelKey)}</h3>
						<ul className="settings-plugin-list">
							{rows.map((p) => {
								const copy = pluginCopy(p.id);
								const enabled = props.draftPlugins[p.id] ?? p.enabled;
								const platformAuto =
									!p.required &&
									((p.id === "bash" && platform === "win32") ||
										(p.id === "pwsh" && platform !== "win32") ||
										(p.id === "tool-pwsh" && platform !== "win32"));
								return (
									<li key={p.id} className={enabled ? "on" : "off"}>
										<div className="settings-plugin-text">
											<span className="settings-plugin-name">
												{t(copy.nameKey)}
												{p.required && (
													<span className="settings-badge core">{t("pluginCoreBadge")}</span>
												)}
											</span>
											<span className="settings-plugin-module">{p.module}</span>
											<span className="settings-plugin-desc">{t(copy.descKey)}</span>
										</div>
										<button
											type="button"
											className={`settings-switch ${enabled ? "on" : ""}`}
											role="switch"
											aria-checked={enabled}
											disabled={p.required}
											title={p.required ? t("pluginRequiredHint") : enabled ? t("pluginEnabled") : t("pluginDisabled")}
											onClick={() => props.onToggle(p.id, !enabled)}
										>
											<span className="settings-switch-thumb" />
											<span className="settings-switch-label">
												{enabled ? t("pluginOn") : t("pluginOff")}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}

			{props.pluginsDirty && (
				<div className="settings-applybar">
					<span>{t("unsavedChanges")} · {t("applyHint")}</span>
					<button
						type="button"
						className="btn primary"
						disabled={props.applying}
						onClick={props.onApply}
					>
						{props.applying ? t("savingAndRestarting") : t("saveAndRestart")}
					</button>
				</div>
			)}

			{/* configurable plugin cards */}
			<section className="settings-group">
				<h3>{t("settingsPluginsTab")} · 配置</h3>
				<ul className="settings-card-list">
					{configurableCards.map((k) => {
						const copy = CARD_TITLES[k];
						const open = props.cardsOpen[k];
						const pluginRow = settings.plugins.find((p) => p.configurable === k);
						const pluginEnabled = props.draftPlugins[pluginRow?.id ?? ""] ?? pluginRow?.enabled ?? true;
						return (
							<li key={k} className={`settings-card ${open ? "open" : ""}`}>
								<button
									type="button"
									className="settings-card-head"
									aria-expanded={open}
									onClick={() => props.onToggleCard(k)}
								>
									<span className="settings-card-text">
										<span className="settings-card-title">{t(copy.title)}</span>
										<span className="settings-card-desc">{t(copy.desc)}</span>
									</span>
									{!pluginEnabled && (
										<span className="settings-badge off">{t("pluginDisabled")}</span>
									)}
									<FiChevronDown className={`settings-card-chevron ${open ? "up" : ""}`} />
								</button>
								{open && (
									<div className="settings-card-body">
										{!pluginEnabled && (
											<p className="settings-card-hint">{t("cardPluginOffHint")}</p>
										)}
										{CARD_FIELDS[k].map((f) => {
											const raw = props.cardField(k, f.key);
											const invalid = props.cardInvalid[k][f.key] ?? false;
											const def = defaultForField(k, f.key, settings);
											if (f.secret) {
												const configured = Boolean(
													props.activePreset?.config.webSearch?.apiKey,
												);
												return (
													<label key={f.key} className="settings-field">
														<span className="settings-field-head">
															{t(f.label)}
															<span className={`settings-badge ${configured ? "" : "muted"}`}>
																{configured ? t("webSearchApiKeySet") : t("webSearchApiKeyUnset")}
															</span>
														</span>
														<input
															type="password"
															autoComplete="off"
															value={raw}
															placeholder={t("webSearchApiKeyHint")}
															onChange={(e) => props.setCardField(k, f.key, e.target.value)}
														/>
													</label>
												);
											}
											return (
												<label key={f.key} className="settings-field">
													<span>{t(f.label)}</span>
													<input
														type="text"
														inputMode={f.numeric ? "numeric" : undefined}
														className={invalid ? "invalid" : ""}
														value={raw}
														placeholder={String(def ?? "")}
														onChange={(e) => props.setCardField(k, f.key, e.target.value)}
													/>
													<span className={`settings-field-hint ${invalid ? "invalid" : ""}`}>
														{invalid ? t("invalidNumber") : t(f.hint, { n: def ?? "" })}
													</span>
												</label>
											);
										})}
										<div className="settings-card-actions">
											<button
												type="button"
												className="btn"
												disabled={props.savingCard === k}
												onClick={() => props.onDiscardCard(k)}
											>
												{t("cardDiscard")}
											</button>
											<button
												type="button"
												className="btn primary"
												disabled={props.savingCard === k}
												onClick={() => props.onSaveCard(k)}
											>
												{props.savingCard === k ? t("cardSaving") : t("cardSave")}
											</button>
										</div>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			</section>
		</div>
	);
}

function defaultForField(card: CardKey, field: string, settings: SettingsSnapshot): string | number | undefined {
	const d = settings.configDefaults;
	switch (card) {
		case "agentLoop":
			return d.agentLoop.maxParallelToolCalls;
		case "bash":
			return field === "timeoutMs" ? d.bash.timeoutMs : d.bash.maxOutputBytes;
		case "webSearch":
			return field === "baseURL" ? d.webSearch.baseURL : field === "maxUses" ? d.webSearch.maxUses : undefined;
		default:
			return undefined;
	}
}

/* ------------------------------------------------------------------------ */
/* Presets tab (roster)                                                      */
/* ------------------------------------------------------------------------ */

function PresetsTab(props: {
	settings: SettingsSnapshot | null;
	t: (k: string, vars?: Record<string, string | number>) => string;
	onMakeDefault: (id: string) => void;
	onUse: (id: string) => void;
	onCopy: (p: AgentPreset) => void;
	onEdit: (p: AgentPreset) => void;
	onDelete: (id: string) => void;
	onView: (id: string) => void;
}) {
	const { t } = props;
	const settings = props.settings;
	if (!settings) {
		return <p className="settings-status">{t("settingsLoading")}</p>;
	}
	const system = settings.presets.filter((p) => p.system);
	const custom = settings.presets.filter((p) => !p.system);
	const renderGroup = (heading: string, rows: AgentPreset[], builtin: boolean) => {
		if (rows.length === 0 && !builtin) return null;
		return (
			<section key={heading} className="settings-group">
				<h3>{heading}</h3>
				<ul className="settings-preset-cards">
					{rows.map((p) => (
						<li key={p.id} className={`settings-preset-card ${p.isActive ? "active" : ""}`}>
							<button
								type="button"
								className="settings-preset-main"
								disabled={p.isDefault}
								title={p.isDefault ? t("presetDefault") : t("presetSetDefault")}
								onClick={() => props.onMakeDefault(p.id)}
							>
								<span className="settings-preset-head">
									<span className="settings-preset-name">{p.name}</span>
									<span className={`settings-badge ${builtin ? "" : "custom"}`}>
										{builtin ? t("presetBuiltIn") : t("presetCustom")}
									</span>
									{p.isDefault && (
										<span className="settings-badge default">{t("presetDefault")}</span>
									)}
									{p.isActive && (
										<span className="settings-badge active">{t("presetActive")}</span>
									)}
								</span>
								<span className="settings-preset-desc">
									{p.description || t("presetNoDescription")}
								</span>
								<code className="settings-preset-id">{p.id}</code>
							</button>
							<div className="settings-preset-actions">
								{builtin ? (
									<button
										type="button"
										className="btn ghost"
										title={t("presetView")}
										onClick={() => props.onView(p.id)}
									>
										<FiEye /> {t("presetView")}
									</button>
								) : (
									<button
										type="button"
										className="btn ghost"
										title={t("presetEdit")}
										onClick={() => props.onEdit(p)}
									>
										<FiEdit2 /> {t("presetEdit")}
									</button>
								)}
								<button
									type="button"
									className="btn ghost"
									title={t("presetCopy")}
									onClick={() => props.onCopy(p)}
								>
									<FiCopy /> {t("presetCopy")}
								</button>
								{!p.isActive && (
									<button
										type="button"
										className="btn ghost use"
										title={t("presetUse")}
										onClick={() => props.onUse(p.id)}
									>
										{t("presetUse")}
									</button>
								)}
								{!builtin && (
									<button
										type="button"
										className="btn ghost danger"
										title={t("presetDelete")}
										onClick={() => props.onDelete(p.id)}
									>
										<FiTrash2 /> {t("presetDelete")}
									</button>
								)}
							</div>
						</li>
					))}
				</ul>
			</section>
		);
	};
	return (
		<div className="settings-presets">
			<p className="settings-intro">{t("settingsPresetsIntro")}</p>
			{renderGroup(t("builtInGroup"), system, true)}
			{renderGroup(t("customGroup"), custom, false)}
		</div>
	);
}
