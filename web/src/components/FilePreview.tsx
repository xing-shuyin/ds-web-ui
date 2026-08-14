import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiLink, FiPlus, FiX } from "react-icons/fi";
import type { ClientMessage, FileContent } from "../types";
import { useT } from "../i18n";
import { getClientId } from "../use-chat";

/** Cap rendered lines so a pathological file can't freeze the modal. */
const MAX_PREVIEW_LINES = 5000;

export interface PreviewFile {
	path: string;
	name: string;
}

interface FilePreviewProps {
	file: PreviewFile;
	/** Latest file content from the server (path-matched inside the modal). */
	content: FileContent | null;
	send: (msg: ClientMessage) => boolean;
	/** Add the selected line range as a "lines" attachment to the chat input. */
	onAddLines: (path: string, name: string, start: number, end: number) => void;
	/** Attach the whole file (inline content / path reference) like the row buttons. */
	onAttach: (path: string, name: string, mode: "inline" | "reference") => void;
	onClose: () => void;
}

/** 1-based inclusive line range. */
interface Range {
	start: number;
	end: number;
}

export function FilePreview({
	file,
	content,
	send,
	onAddLines,
	onAttach,
	onClose,
}: FilePreviewProps) {
	const t = useT();
	const [loaded, setLoaded] = useState<FileContent | null>(null);
	const [loading, setLoading] = useState(false);
	const [sel, setSel] = useState<Range | null>(null);
	const [dragging, setDragging] = useState(false);
	const [added, setAdded] = useState(false);
	const anchorRef = useRef(0);
	const draggingRef = useRef(false);
	const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Request content on open / file change (mount included).
	useEffect(() => {
		setLoading(true);
		setLoaded(null);
		setSel(null);
		send({ type: "read_file", path: file.path });
	}, [file.path, send]);

	// Accept responses only for the file currently shown (stale responses for
	// previously previewed files are ignored).
	useEffect(() => {
		if (content && content.path === file.path) {
			setLoaded(content);
			setLoading(false);
		}
	}, [content, file.path]);

	// Escape closes; Ctrl/Cmd+A selects everything in the preview.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			const target = e.target as HTMLElement | null;
			const typing =
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable);
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) {
				e.preventDefault();
				selectAll();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onClose, loaded]);

	// End drag selection on mouseup anywhere.
	useEffect(() => {
		const up = () => {
			draggingRef.current = false;
			setDragging(false);
		};
		window.addEventListener("mouseup", up);
		return () => window.removeEventListener("mouseup", up);
	}, []);

	const lines = useMemo(() => {
		if (!loaded) return [];
		const parts = loaded.text.split("\n");
		// Trailing newline → empty phantom line; drop it so line numbers match
		// what the server counts.
		if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
		return parts.slice(0, MAX_PREVIEW_LINES);
	}, [loaded]);

	const lineCount = loaded?.lines ?? 0;
	const truncatedLines = lineCount > MAX_PREVIEW_LINES;

	const selectLine = (line: number, extend: boolean) => {
		if (extend) {
			const anchor = anchorRef.current > 0 ? anchorRef.current : line;
			setSel({
				start: Math.min(anchor, line),
				end: Math.max(anchor, line),
			});
		} else {
			anchorRef.current = line;
			setSel({ start: line, end: line });
		}
	};

	const selectAll = () => {
		if (lines.length === 0) return;
		anchorRef.current = 1;
		setSel({ start: 1, end: lines.length });
	};

	const addToChat = () => {
		if (!sel) return;
		onAddLines(file.path, file.name, sel.start, sel.end);
		setAdded(true);
		if (addedTimer.current) clearTimeout(addedTimer.current);
		addedTimer.current = setTimeout(() => setAdded(false), 1400);
	};

	const selCount = sel ? sel.end - sel.start + 1 : 0;
	const isBinary = loaded?.binary ?? false;
	const truncated = loaded?.truncated ?? false;
	// Preview category from the server ("text" while loading). Media kinds are
	// streamed over the /api/file HTTP endpoint; "none" is never previewable.
	const kind = loaded?.kind ?? "text";
	// /api/file resolves against the requesting client's workspace (the opened
	// project), not the server's startup cwd — pass clientId so they can differ.
	const mediaUrl = (p: string) =>
		`/api/file?clientId=${encodeURIComponent(getClientId())}&path=${encodeURIComponent(p)}`;

	return (
		<div
			className="fp-overlay"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="fp">
				<div className="fp-head">
					<span className="fp-name" title={file.path}>
						{file.name}
					</span>
					<span className="fp-path">{file.path}</span>
					<span className="fp-meta">
						{loaded &&
							kind === "text" &&
							!isBinary &&
							t("fileLines", { n: lineCount })}
						{loaded && ` · ${formatSize(loaded.size)}`}
					</span>
					<span className="fp-head-actions">
						{kind !== "video" && kind !== "none" && (
							<button
								type="button"
								className="fp-attach inline"
								data-tip={t("attachInlineTip")}
								onClick={() => onAttach(file.path, file.name, "inline")}
							>
								<FiPlus />
							</button>
						)}
						<button
							type="button"
							className="fp-attach ref"
							data-tip={t("referenceTip")}
							onClick={() => onAttach(file.path, file.name, "reference")}
						>
							<FiLink />
						</button>
						<button
							type="button"
							className="fp-close"
							title={t("close")}
							onClick={onClose}
						>
							<FiX />
						</button>
					</span>
				</div>

				{truncated && kind === "text" && !isBinary && (
					<div className="fp-notice">{t("previewTruncated")}</div>
				)}

				{loading && !loaded && <div className="fp-empty">{t("loading")}</div>}

				{!loading && kind === "none" && !isBinary && (
					<div className="fp-empty">{t("previewNotSupported")}</div>
				)}

				{!loading && kind === "image" && (
					<div className="fp-media-wrap">
						<img
							className="fp-media"
							src={mediaUrl(file.path)}
							alt={file.name}
						/>
					</div>
				)}

				{!loading && kind === "video" && (
					<div className="fp-media-wrap">
						<video
							className="fp-media"
							src={mediaUrl(file.path)}
							controls
							preload="metadata"
						/>
					</div>
				)}

				{!loading &&
					isBinary &&
					kind !== "image" &&
					kind !== "video" &&
					loaded && (
						<div className="fp-hex-wrap">
							<div className="fp-notice">
								{t("binaryFile")}
								{loaded.truncated && t("binaryHexTruncated")}
							</div>
							<pre className="fp-hex">{loaded.text}</pre>
						</div>
					)}

				{!loading &&
					kind === "text" &&
					!isBinary &&
					loaded &&
					lines.length === 0 && (
						<div className="fp-empty">{t("emptyFile")}</div>
					)}

				{!loading && kind === "text" && !isBinary && lines.length > 0 && (
					<div
						className={`fp-code ${dragging ? "dragging" : ""}`}
						onMouseDown={(e) => {
							// Block native text selection so click/drag maps to line ranges.
							if (e.button === 0) e.preventDefault();
						}}
					>
						{lines.map((text, i) => {
							const n = i + 1;
							const active = sel !== null && n >= sel.start && n <= sel.end;
							return (
								<div
									key={n}
									className={`fp-line ${active ? "sel" : ""}`}
									onMouseDown={(e) => {
										if (e.button !== 0) return;
										selectLine(n, e.shiftKey);
										draggingRef.current = true;
										setDragging(true);
									}}
									onMouseEnter={() => {
										if (draggingRef.current) selectLine(n, true);
									}}
								>
									<span className="fp-num">{n}</span>
									<span className="fp-code-text">{text}</span>
								</div>
							);
						})}
						{truncatedLines && (
							<div className="fp-lines-note">
								{t("previewLinesTruncated", { n: MAX_PREVIEW_LINES })}
							</div>
						)}
					</div>
				)}

				<div className="fp-foot">
					{kind === "text" && (
						<>
							<span className="fp-hint">
								{sel
									? t("selectedRange", {
											n: selCount,
											start: sel.start,
											end: sel.end,
										})
									: t("selectLinesHint")}
							</span>
							<div className="fp-actions">
								<button
									type="button"
									className="btn"
									disabled={lines.length === 0}
									onClick={selectAll}
								>
									{t("selectAll")}
								</button>
								<button
									type="button"
									className="btn"
									disabled={!sel}
									onClick={() => setSel(null)}
								>
									{t("clearSelection")}
								</button>
								<button
									type="button"
									className="btn primary"
									disabled={!sel || isBinary}
									onClick={addToChat}
								>
									{added ? <FiCheck /> : null}
									{added ? t("addedToChat") : t("addToChat")}
								</button>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}
