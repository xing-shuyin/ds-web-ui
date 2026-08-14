import { useEffect, useState } from "react";
import type { ClientMessage } from "../types";
import { useT } from "../i18n";

interface DialogProps {
	dialog: {
		id: number;
		kind: "select" | "confirm" | "input";
		title: string;
		args: unknown[];
	};
	send: (msg: ClientMessage) => boolean;
}

/**
 * Bridges extension `ui.select/confirm/input` calls to a browser modal.
 * Resolves via dialog_response; cancel/Esc resolves with null.
 */
export function Dialog({ dialog, send }: DialogProps) {
	const t = useT();
	const [inputValue, setInputValue] = useState("");
	const [sel, setSel] = useState(0);

	const respond = (value: string | boolean | null) => {
		send({ type: "dialog_response", id: dialog.id, value });
	};

	useEffect(() => {
		setInputValue("");
		setSel(0);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") respond(null);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dialog.id]);

	const options = Array.isArray(dialog.args[0])
		? (dialog.args[0] as string[])
		: [];
	const message =
		typeof dialog.args[0] === "string" ? (dialog.args[0] as string) : "";

	return (
		<div
			className="dialog-overlay"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) respond(null);
			}}
		>
			<div className="dialog">
				<div className="dialog-title">{dialog.title || t("pluginRequest")}</div>

				{dialog.kind === "select" && (
					<div className="dialog-options">
						{options.map((opt, i) => (
							<button
								type="button"
								key={i}
								className={`dialog-option ${i === sel ? "sel" : ""}`}
								onMouseEnter={() => setSel(i)}
								onClick={() => respond(opt)}
							>
								{opt}
							</button>
						))}
						{options.length === 0 && (
							<div className="dialog-hint">{t("noOptions")}</div>
						)}
					</div>
				)}

				{dialog.kind === "confirm" && (
					<div className="dialog-body">
						<p>{message}</p>
						<div className="dialog-actions">
							<button
								type="button"
								className="btn"
								onClick={() => respond(false)}
							>
								{t("cancel")}
							</button>
							<button
								type="button"
								className="btn primary"
								onClick={() => respond(true)}
							>
								{t("ok")}
							</button>
						</div>
					</div>
				)}

				{dialog.kind === "input" && (
					<div className="dialog-body">
						<input
							className="dialog-input"
							value={inputValue}
							placeholder={message || t("inputPlaceholder")}
							autoFocus
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.nativeEvent.isComposing) {
									respond(inputValue);
								}
							}}
						/>
						<div className="dialog-actions">
							<button
								type="button"
								className="btn"
								onClick={() => respond(null)}
							>
								{t("cancel")}
							</button>
							<button
								type="button"
								className="btn primary"
								onClick={() => respond(inputValue)}
							>
								{t("ok")}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
