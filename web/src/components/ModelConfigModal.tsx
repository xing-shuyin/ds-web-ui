import { useEffect, useState } from "react";
import { FiEdit2, FiKey, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import type {
	ClientMessage,
	ProviderStatus,
	UiModelConfigEntry,
	UiProviderConfig,
} from "../types";
import { useT } from "../i18n";

interface ModelConfigModalProps {
	send: (msg: ClientMessage) => boolean;
	/** Custom providers from agentDir/models.json. */
	providers: UiProviderConfig[];
	/** Built-in providers with auth status (key-only config). */
	providerStatus: ProviderStatus[];
	onClose: () => void;
}

const API_TYPES = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
];

interface DraftModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: "text" | "text-image";
	contextWindow: string;
	maxTokens: string;
}

interface Draft {
	providerId: string;
	name: string;
	api: string;
	baseUrl: string;
	apiKey: string;
	authHeader: boolean;
	models: DraftModel[];
}

const emptyModel = (): DraftModel => ({
	id: "",
	name: "",
	reasoning: false,
	input: "text",
	contextWindow: "",
	maxTokens: "",
});

const emptyDraft = (): Draft => ({
	providerId: "",
	name: "",
	api: "openai-completions",
	baseUrl: "",
	apiKey: "",
	authHeader: true,
	models: [emptyModel()],
});

function toDraft(p: UiProviderConfig): Draft {
	return {
		providerId: p.providerId,
		name: p.name ?? "",
		api: p.api ?? "openai-completions",
		baseUrl: p.baseUrl ?? "",
		apiKey: p.apiKey ?? "",
		authHeader: p.authHeader ?? false,
		models: (p.models.length ? p.models : [emptyModel()]).map((m) => ({
			id: m.id,
			name: m.name ?? "",
			reasoning: m.reasoning ?? false,
			input: m.input?.includes("image") ? "text-image" : "text",
			contextWindow: m.contextWindow ? String(m.contextWindow) : "",
			maxTokens: m.maxTokens ? String(m.maxTokens) : "",
		})),
	};
}

export function ModelConfigModal({
	send,
	providers,
	providerStatus,
	onClose,
}: ModelConfigModalProps) {
	const t = useT();
	const [editing, setEditing] = useState<Draft | null>(null);
	/** Built-in provider rows: providerId → inline key being typed. */
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [savingKey, setSavingKey] = useState<string | null>(null);

	// Fresh config when the modal opens.
	useEffect(() => {
		send({ type: "list_models_config" });
		send({ type: "list_providers" });
	}, [send]);

	const saveBuiltinKey = (p: ProviderStatus) => {
		const key = (keys[p.id] ?? "").trim();
		if (!key || savingKey) return;
		setSavingKey(p.id);
		send({ type: "set_provider_api_key", provider: p.id, apiKey: key });
		// Server refreshes + emits providers_status; clear the input on success.
		setTimeout(() => {
			setSavingKey(null);
			setKeys((k) => ({ ...k, [p.id]: "" }));
			send({ type: "list_providers" });
		}, 1500);
	};

	const save = () => {
		if (!editing) return;
		const providerId = editing.providerId.trim();
		const models: UiModelConfigEntry[] = editing.models
			.filter((m) => m.id.trim())
			.map((m) => ({
				id: m.id.trim(),
				name: m.name.trim() || undefined,
				reasoning: m.reasoning || undefined,
				input: m.input === "text-image" ? ["text", "image"] : undefined,
				contextWindow: m.contextWindow ? Number(m.contextWindow) : undefined,
				maxTokens: m.maxTokens ? Number(m.maxTokens) : undefined,
			}));
		const config: UiProviderConfig = {
			providerId,
			name: editing.name.trim() || undefined,
			api: editing.api.trim() || undefined,
			baseUrl: editing.baseUrl.trim() || undefined,
			apiKey: editing.apiKey.trim() || undefined,
			authHeader: editing.authHeader || undefined,
			models,
		};
		send({ type: "save_model_config", providerId, config });
		onClose();
	};

	const removeProvider = (p: UiProviderConfig) => {
		if (
			window.confirm(
				t("deleteProviderConfirm", {
					id: p.providerId,
					n: p.models.length,
				}),
			)
		) {
			send({ type: "delete_model_config", providerId: p.providerId });
		}
	};

	const setModel = (i: number, patch: Partial<DraftModel>) => {
		if (!editing) return;
		setEditing({
			...editing,
			models: editing.models.map((m, j) => (j === i ? { ...m, ...patch } : m)),
		});
	};

	return (
		<div className="modal-backdrop">
			<div className="modal model-modal">
				<button
					type="button"
					className="modal-close"
					aria-label={t("close")}
					onClick={onClose}
				>
					<FiX />
				</button>
				<div className="modal-head">
					<h2>{editing ? t("editProvider") : t("manageModelsTitle")}</h2>
				</div>

				{!editing ? (
					<>
						<div className="form-section-title">
							{t("builtinProviders")}{" "}
							<em className="section-hint">{t("hintKeyOnly")}</em>
						</div>
						<div className="provider-list">
							{providerStatus.length === 0 && (
								<div className="dd-loading">{t("loading")}</div>
							)}
							{providerStatus.map((p) => (
								<div className="provider-row" key={p.id}>
									<div className="provider-info">
										<span className="provider-name">{p.name}</span>
										<span className="provider-sub">
											{p.id}
											{p.configured && (
												<span className="auth-badge">
													{t("configuredBadge")}
												</span>
											)}
											{p.source && !p.configured && (
												<span className="auth-badge dim">{p.source}</span>
											)}
										</span>
									</div>
									<div className="provider-actions">
										{p.configured ? (
											<span className="auth-badge">{t("keyReady")}</span>
										) : (
											<>
												<input
													type="password"
													className="key-input"
													placeholder={t("pasteKey")}
													value={keys[p.id] ?? ""}
													onChange={(e) =>
														setKeys((k) => ({ ...k, [p.id]: e.target.value }))
													}
												/>
												<button
													type="button"
													className="btn primary sm"
													disabled={
														!(keys[p.id] ?? "").trim() || savingKey === p.id
													}
													onClick={() => saveBuiltinKey(p)}
												>
													<FiKey />{" "}
													{savingKey === p.id ? t("savingKey") : t("saveKey")}
												</button>
											</>
										)}
									</div>
								</div>
							))}
						</div>

						<div className="form-section-title">{t("customProviders")}</div>
						<p className="modal-desc">{t("customDesc")}</p>
						{providers.length === 0 && (
							<div className="dd-loading">{t("noCustomProviders")}</div>
						)}
						<div className="provider-list">
							{providers.map((p) => (
								<div className="provider-row" key={p.providerId}>
									<div className="provider-info">
										<span className="provider-name">{p.providerId}</span>
										<span className="provider-sub">
											{p.api ?? "—"}
											{p.baseUrl ? ` · ${p.baseUrl}` : ""}
											{p.models.length > 0 &&
												` · ${t("modelsCount", { n: p.models.length })}`}
										</span>
									</div>
									<div className="provider-actions">
										<button
											type="button"
											className="iconbtn"
											title={t("edit")}
											onClick={() => setEditing(toDraft(p))}
										>
											<FiEdit2 />
										</button>
										<button
											type="button"
											className="iconbtn danger"
											title={t("delete")}
											onClick={() => removeProvider(p)}
										>
											<FiTrash2 />
										</button>
									</div>
								</div>
							))}
						</div>
						<div className="modal-actions">
							<button
								type="button"
								className="btn primary"
								onClick={() => setEditing(emptyDraft())}
							>
								<FiPlus /> {t("addProvider")}
							</button>
						</div>
					</>
				) : (
					<div className="provider-form">
						<div className="form-grid">
							<label className="field">
								<span className="field-label">
									{t("providerId")} <em>{t("providerIdHint")}</em>
								</span>
								<input
									type="text"
									value={editing.providerId}
									disabled={providers.some(
										(p) => p.providerId === editing.providerId,
									)}
									onChange={(e) =>
										setEditing({ ...editing, providerId: e.target.value })
									}
									placeholder="my-proxy"
								/>
							</label>
							<label className="field">
								<span className="field-label">{t("displayName")}</span>
								<input
									type="text"
									value={editing.name}
									onChange={(e) =>
										setEditing({ ...editing, name: e.target.value })
									}
									placeholder={t("displayNamePh")}
								/>
							</label>
							<label className="field">
								<span className="field-label">{t("apiType")}</span>
								<select
									value={editing.api}
									onChange={(e) =>
										setEditing({ ...editing, api: e.target.value })
									}
								>
									{API_TYPES.map((a) => (
										<option key={a} value={a}>
											{a}
										</option>
									))}
								</select>
							</label>
							<label className="field">
								<span className="field-label">
									baseUrl <em>{t("baseUrlHint")}</em>
								</span>
								<input
									type="text"
									value={editing.baseUrl}
									onChange={(e) =>
										setEditing({ ...editing, baseUrl: e.target.value })
									}
									placeholder="http://localhost:11434/v1"
								/>
							</label>
							<label className="field">
								<span className="field-label">{t("apiKey")}</span>
								<input
									type="password"
									value={editing.apiKey}
									onChange={(e) =>
										setEditing({ ...editing, apiKey: e.target.value })
									}
									placeholder={t("apiKeyHint")}
								/>
							</label>
							<label className="field check">
								<input
									type="checkbox"
									checked={editing.authHeader}
									onChange={(e) =>
										setEditing({ ...editing, authHeader: e.target.checked })
									}
								/>
								<span>{t("authHeader")}</span>
							</label>
						</div>

						<div className="form-section-title">{t("modelsTitle")}</div>
						{editing.models.map((m, i) => (
							<div className="model-row" key={i}>
								<input
									type="text"
									value={m.id}
									onChange={(e) => setModel(i, { id: e.target.value })}
									placeholder={t("modelIdReq")}
								/>
								<input
									type="text"
									value={m.name}
									onChange={(e) => setModel(i, { name: e.target.value })}
									placeholder={t("displayName")}
								/>
								<select
									value={m.input}
									onChange={(e) =>
										setModel(i, {
											input: e.target.value as DraftModel["input"],
										})
									}
								>
									<option value="text">{t("text")}</option>
									<option value="text-image">{t("textImage")}</option>
								</select>
								<label className="check">
									<input
										type="checkbox"
										checked={m.reasoning}
										onChange={(e) =>
											setModel(i, { reasoning: e.target.checked })
										}
									/>
									<span>{t("reasoning")}</span>
								</label>
								<input
									type="number"
									value={m.contextWindow}
									onChange={(e) =>
										setModel(i, { contextWindow: e.target.value })
									}
									placeholder={t("contextWindow")}
									title="contextWindow"
								/>
								<input
									type="number"
									value={m.maxTokens}
									onChange={(e) => setModel(i, { maxTokens: e.target.value })}
									placeholder={t("maxOutput")}
									title="maxTokens"
								/>
								<button
									type="button"
									className="iconbtn danger"
									title={t("removeModel")}
									onClick={() =>
										setEditing({
											...editing,
											models: editing.models.filter((_, j) => j !== i),
										})
									}
								>
									<FiTrash2 />
								</button>
							</div>
						))}
						<button
							type="button"
							className="btn"
							onClick={() =>
								setEditing({
									...editing,
									models: [...editing.models, emptyModel()],
								})
							}
						>
							<FiPlus /> {t("addModel")}
						</button>

						<div className="modal-actions">
							<button
								type="button"
								className="btn"
								onClick={() => setEditing(null)}
							>
								{t("cancel")}
							</button>
							<button
								type="button"
								className="btn primary"
								disabled={
									!editing.providerId.trim() ||
									!editing.models.some((m) => m.id.trim())
								}
								onClick={save}
							>
								{t("save")}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
