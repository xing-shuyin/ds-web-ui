import { useState } from "react";
import { FiTarget, FiX, FiChevronUp } from "react-icons/fi";
import type { ChatState } from "../use-chat";
import type { ClientMessage } from "../types";
import { useT } from "../i18n";

/**
 * DSH-native goal bar. Unlike pi-web-ui (where the SDK exposes goal control
 * messages), the DSH runtime has no goal method on the JSON-RPC wire: goals
 * are created/updated by the AGENT itself through its goal tools
 * (dsh-tool-goal: get_goal / create_goal / update_goal), driven by
 * dsh-goal + dsh-goal-round-driver. So this bar:
 *   - displays the current goal (objective / phase / rounds) from
 *     goal/change session events (snapshot.goal),
 *   - "set" / "end" send a plain prompt the agent resolves with its goal
 *     tools (the tool guidance says create_goal may infer goal intent from a
 *     direct human request).
 */
export function GoalBar({ chat, send }: { chat: ChatState; send: (msg: ClientMessage) => boolean }) {
	const t = useT();
	const goal = chat.state?.goal ?? null;
	const active = goal !== null;
	const [text, setText] = useState("");
	const [maxRounds, setMaxRounds] = useState(3);
	const [collapsed, setCollapsed] = useState(true);

	const phaseLabel = () => {
		switch (goal?.phase) {
			case "active":
				return t("goalBarPhaseActive");
			case "paused":
				return t("goalBarPhasePaused");
			case "blocked":
				return t("goalBarPhaseBlocked");
			case "complete":
				return t("goalBarPhaseComplete");
			default:
				return t("goalBarPhaseActive");
		}
	};

	const set = () => {
		const trimmed = text.trim();
		if (!trimmed) return;
		// The agent records the goal with its create_goal tool (round cap
		// included in the prompt; 0 = unlimited).
		const rounds =
			maxRounds > 0 ? t("goalBarSetRounds", { n: maxRounds }) : t("goalBarSetUnlimited");
		send({ type: "prompt", text: t("goalBarSetPrompt", { goal: trimmed, rounds }) });
		setText("");
		setCollapsed(false);
	};

	const end = () => {
		if (!goal) return;
		send({ type: "prompt", text: t("goalBarEndPrompt", { goal: goal.objective }) });
		setCollapsed(true);
	};

	if (active) {
		return (
			<div className={`goalbar goalbar-active ${goal.phase === "complete" ? "complete" : goal.phase === "blocked" ? "blocked" : ""}`}>
				<div className="goalbar-active-row">
					<span className="goalbar-icon">🎯</span>
					<span className="goalbar-text" title={goal.objective}>
						{goal.objective}
					</span>
					<span className={`goalbar-chip ${goal.phase}`}>{phaseLabel()}</span>
					<span className="goalbar-detail">
						{t("goalBarRound", { n: goal.roundsStarted + 1 })}{" "}
						{goal.maxGoalRounds > 0
							? `· ${t("goalBarOfRounds", { n: goal.maxGoalRounds })}`
							: `· ${t("goalBarUnlimited")}`}
					</span>
					<button
						type="button"
						className="goalbar-x"
						title={t("goalBarEnd")}
						onClick={end}
					>
						<FiX />
					</button>
				</div>
			</div>
		);
	}

	// Inactive, collapsed — a single compact pill aligned LEFT. 🎯 chip; click
	// to open the editor.
	if (collapsed) {
		return (
			<div className="goalbar goalbar-collapsed">
				<button
					type="button"
					className="goalbar-hint"
					title={t("goalBarPlaceholder")}
					onClick={() => setCollapsed(false)}
				>
					<FiTarget /> <span>{t("goalBarTitle")}</span>
				</button>
			</div>
		);
	}

	return (
		<div className="goalbar">
			<div className="goalbar-row">
				<span className="goalbar-icon"><FiTarget /></span>
				<input
					className="goalbar-input"
					value={text}
					placeholder={t("goalBarPlaceholder")}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") set();
					}}
				/>
				<button
					type="button"
					className="goalbar-btn"
					disabled={!text.trim()}
					onClick={set}
				>
					{t("goalBarSet")}
				</button>
				<label className="goalbar-round" title={t("goalBarMaxRoundsTip")}>
					<span>{t("goalBarMaxRounds")}</span>
					<input
						type="number"
						min={0}
						step={1}
						value={maxRounds}
						placeholder={t("goalBarUnlimited")}
						onChange={(e) => {
							const v = parseInt(e.target.value, 10);
							if (Number.isNaN(v) || v < 0) setMaxRounds(0);
							else setMaxRounds(v);
						}}
					/>
				</label>
				<button
					type="button"
					className="goalbar-icon-btn"
					title={t("goalBarCollapse")}
					onClick={() => setCollapsed(true)}
				>
					<FiChevronUp />
				</button>
			</div>
			<div className="goalbar-note">{t("goalBarNote")}</div>
		</div>
	);
}
