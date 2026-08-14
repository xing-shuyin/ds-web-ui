import { useState } from "react";
import { FiChevronDown, FiChevronRight, FiCpu } from "react-icons/fi";
import { useT } from "../i18n";

interface ThinkingBlockProps {
	thinking: string;
	/** True while the assistant is still streaming this thinking block. */
	streaming?: boolean;
}

export function ThinkingBlock({ thinking, streaming }: ThinkingBlockProps) {
	const t = useT();
	// While streaming, start expanded so the reasoning is visible as it arrives;
	// finished messages default to collapsed (tidy summary header).
	const [open, setOpen] = useState(streaming);
	const preview = thinking.split("\n")[0].slice(0, 80);

	return (
		<div
			className={`thinking ${open ? "open" : ""} ${streaming ? "live" : ""}`}
		>
			<button
				type="button"
				className="thinking-toggle"
				onClick={() => setOpen((v) => !v)}
			>
				{open ? <FiChevronDown /> : <FiChevronRight />}
				<FiCpu className="thinking-icon" />
				<span className="thinking-label">
					{streaming ? (
						<span className="thinking-live-label">
							{t("thinkingNow")}
							<span className="dots" />
						</span>
					) : open ? (
						t("thinking")
					) : (
						t("thinkingPreview", { preview })
					)}
				</span>
			</button>
			{open && <div className="thinking-body">{thinking}</div>}
		</div>
	);
}
