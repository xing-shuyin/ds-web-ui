/**
 * AgentPresetSeat — the per-conversation agent-preset picker chip (beside the
 * model picker). Mirrors the official DSH web "seat": the choice is made here
 * and applied to the current conversation by restarting the runtime with the
 * preset's composition (effective on the next request).
 */

import { useEffect, useState } from "react";
import { FiCpu } from "react-icons/fi";
import type { ClientMessage } from "../types";
import type { ChatState } from "../use-chat";
import { Dropdown, DropdownItem } from "./Dropdown";
import { useT } from "../i18n";

interface AgentPresetSeatProps {
	chat: ChatState;
	send: (
		msg: { type: "set_preset"; id: string } | { type: "list_settings" },
	) => boolean;
	/** Compact variant (mobile input row). */
	compact?: boolean;
}

export function AgentPresetSeat({ chat, send, compact = false }: AgentPresetSeatProps) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const settings = chat.settings;

	useEffect(() => {
		if (settings === null) send({ type: "list_settings" });
	}, [settings, send]);

	if (settings === null || settings.presets.length === 0) return null;

	const active = settings.presets.find((p) => p.isActive);
	if (!active) return null;

	return (
		<Dropdown
			trigger={
				<>
					<FiCpu />
					<span className={`chip-sub ${compact ? "compact" : ""}`}>
						{compact ? "" : `${t("presetSeatLabel")}: `}
						{active.name}
					</span>
				</>
			}
			open={open}
			onOpenChange={setOpen}
		>
			<div className="dd-header">{t("settingsPresetsTab")}</div>
			{settings.presets.map((p) => (
				<DropdownItem
					key={p.id}
					active={p.isActive}
					title={p.description || undefined}
					onClick={() => {
						setOpen(false);
						if (!p.isActive) send({ type: "set_preset", id: p.id });
					}}
				>
					<span className="dd-preset-item">
						<span className="dd-preset-name">{p.name}</span>
						{p.isActive && <span className="dd-preset-check">✓</span>}
					</span>
					<span className="dd-preset-desc">{p.description || p.id}</span>
				</DropdownItem>
			))}
		</Dropdown>
	);
}
