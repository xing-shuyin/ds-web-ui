import { useEffect, useState } from "react";
import { FiCpu, FiZap } from "react-icons/fi";
import type { ChatState } from "../use-chat";
import { Dropdown, DropdownItem } from "./Dropdown";
import { useT } from "../i18n";

/** Messages this component sends (a subset shared by TopBar and ChatInput). */
export type ModelThinkingMsg =
	| { type: "list_models" }
	| { type: "set_model"; modelId: string }
	| { type: "set_thinking"; level: string };

const THINKING_VALUES = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

interface Props {
	chat: ChatState;
	send: (msg: ModelThinkingMsg) => boolean;
	/** Opens the custom-model config modal (App-level state). */
	onManageModels: () => void;
	/** Compact triggers for narrow toolbars (mobile input row). */
	compact?: boolean;
}

/** Model picker + thinking-level picker. Rendered in the top bar on desktop
 * and in the input row on mobile — same dropdowns, different trigger styles. */
export function ModelThinking({ chat, send, onManageModels, compact = false }: Props) {
	const t = useT();
	const state = chat.state;
	const model = state?.model;
	// snapshot model.id is the bare id; list ids are "provider/id".
	const currentModelId = model ? `${model.provider}/${model.id}` : null;
	const [modelOpen, setModelOpen] = useState(false);
	const [thinkingOpen, setThinkingOpen] = useState(false);
	// Local loading flag for the model dropdown (list arrives via chat.models).
	const [modelsLoading, setModelsLoading] = useState(false);

	// Model-supported thinking levels (snapshot). The SDK clamps any request
	// outside this set — unsupported levels must be disabled, not silently
	// snapped (that's what made the level look "impossible to change").
	// Empty/absent → unknown, keep everything enabled.
	const supportedThinking =
		state?.availableThinkingLevels && state.availableThinkingLevels.length > 0
			? new Set(state.availableThinkingLevels)
			: null;
	const thinkingLevels: {
		value: string;
		label: string;
		supported: boolean;
	}[] = THINKING_VALUES.map((v) => ({
		value: v,
		label: t(`thinking.${v}`),
		supported: supportedThinking ? supportedThinking.has(v) : true,
	}));
	const thinkingLabel = (level: string): string =>
		thinkingLevels.find((l) => l.value === level)?.label ?? level;

	// Lazily fetch the model list when the dropdown opens for the first time.
	useEffect(() => {
		if (modelOpen && chat.models.length === 0 && !modelsLoading) {
			setModelsLoading(true);
			send({ type: "list_models" });
		}
	}, [modelOpen, chat.models.length, modelsLoading, send]);
	useEffect(() => {
		if (chat.models.length > 0) setModelsLoading(false);
	}, [chat.models.length]);

	return (
		<>
			<Dropdown
				trigger={
					<>
						<FiCpu />
						<span className="chip-model">
							{model ? model.name : t("selectModel")}
						</span>
						{!compact && model?.vision && (
							<span className="chip-vision" title={t("vision")}>
								🖼
							</span>
						)}
						{!compact && model && (
							<span className="chip-sub">{model.provider}</span>
						)}
					</>
				}
				open={modelOpen}
				onOpenChange={setModelOpen}
			>
				<div className="dd-header">{t("availableModels")}</div>
				{(modelsLoading || chat.modelsLoading) && (
					<div className="dd-loading">{t("loading")}</div>
				)}
				{chat.models.length === 0 &&
					!modelsLoading &&
					!chat.modelsLoading && (
						<div className="dd-loading">{t("noModels")}</div>
					)}
				{chat.models.map((m) => (
					<DropdownItem
						key={m.id}
						active={currentModelId === m.id}
						onClick={() => {
							if (currentModelId !== m.id) {
								send({ type: "set_model", modelId: m.id });
							}
							setModelOpen(false);
						}}
					>
						<span className="dd-model-cell">
							<span className="dd-model-name">{m.name}</span>
							<span className="dd-model-meta">
								<span className="dd-model-provider">{m.provider}</span>
								{(m.reasoning || m.vision) && (
									<span className="dd-model-badges">
										{m.reasoning && (
											<span className="dd-model-badge">{t("reasoning")}</span>
										)}
										{m.vision && (
											<span className="dd-model-badge">{t("vision")}</span>
										)}
									</span>
								)}
							</span>
						</span>
					</DropdownItem>
				))}
				<button
					type="button"
					className="dd-refresh"
					onClick={() => send({ type: "list_models" })}
				>
					{t("refreshModels")}
				</button>
				<button
					type="button"
					className="dd-refresh"
					onClick={() => {
						setModelOpen(false);
						onManageModels();
					}}
				>
					{t("manageModels")}
				</button>
			</Dropdown>

			<Dropdown
				trigger={
					<>
						<FiZap />
						<span className="chip-sub">
							{t("thinkingChip", {
								level: state ? thinkingLabel(state.thinkingLevel) : "—",
							})}
						</span>
					</>
				}
				open={thinkingOpen}
				onOpenChange={setThinkingOpen}
			>
				<div className="dd-header">{t("thinkingLevel")}</div>
				{thinkingLevels.map((l) => (
					<DropdownItem
						key={l.value}
						active={state?.thinkingLevel === l.value}
						disabled={!l.supported}
						title={l.supported ? undefined : t("thinkingUnsupported")}
						onClick={() => {
							if (state?.thinkingLevel !== l.value) {
								send({ type: "set_thinking", level: l.value });
							}
							setThinkingOpen(false);
						}}
					>
						{l.label}
					</DropdownItem>
				))}
			</Dropdown>
		</>
	);
}
