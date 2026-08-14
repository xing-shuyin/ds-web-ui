import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ClientMessage, CommandDef } from "../types";

/** Dark theme matching the app's palette. */
const TERM_THEME = {
	background: "#0b0d12",
	foreground: "#e6e8ef",
	cursor: "#8b5cf6",
	cursorAccent: "#0b0d12",
	selectionBackground: "rgba(139, 92, 246, 0.35)",
	black: "#1a1d26",
	red: "#f87171",
	green: "#34d399",
	yellow: "#fbbf24",
	blue: "#60a5fa",
	magenta: "#c084fc",
	cyan: "#22d3ee",
	white: "#e6e8ef",
	brightBlack: "#6b7284",
	brightRed: "#f87171",
	brightGreen: "#34d399",
	brightYellow: "#fbbf24",
	brightBlue: "#60a5fa",
	brightMagenta: "#c084fc",
	brightCyan: "#22d3ee",
	brightWhite: "#ffffff",
};

interface TermXtermProps {
	terminalId: string;
	/** When set, the server runs this command in a new shell instead of a bare shell. */
	command?: CommandDef;
	/** Directory for a bare shell (from the snapshot at tab creation). */
	cwd: string;
	/** Whether this terminal is the visible one. */
	active: boolean;
	send: (msg: ClientMessage) => boolean;
	register: (
		id: string,
		writer: { write(data: string): void; dispose(): void },
	) => () => void;
}

/**
 * One xterm instance per terminal tab. Owns the PTY lifecycle: creates it on
 * mount (bare shell or run_command), forwards input/resize, streams output via
 * the bridge, and kills the PTY on unmount. Kept mounted while hidden so
 * scrollback survives tab switches.
 */
export function TermXterm({
	terminalId,
	command,
	cwd,
	active,
	send,
	register,
}: TermXtermProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);

	// Mount/unmount: create the xterm, register with the output bridge, spawn
	// the server-side PTY, wire input + resize. Never re-runs on tab switches
	// (command identity is stable — the meta object is only ever spread).
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			theme: TERM_THEME,
			fontFamily:
				'"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
			fontSize: 13,
			cursorBlink: true,
			scrollback: 8000,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);
		termRef.current = { term, fit };
		if (active) term.focus();

		// xterm maps Ctrl+V to ^V (0x16, readline quoted-insert) and Ctrl+C to
		// ^C, preventDefault()ing both, so the browser's native copy/paste never
		// fires. Returning false skips xterm's key handling entirely:
		//   · Ctrl+V / Cmd+V → browser-native paste (event lands on xterm's
		//     helper textarea and is forwarded to the shell)
		//   · Ctrl+C with a selection → copy instead of ^C (text staged in the
		//     helper textarea, same trick as xterm's own right-click copy; no
		//     clipboard-API permission needed, works over plain http)
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;
			const key = event.key?.toLowerCase();
			if ((event.ctrlKey || event.metaKey) && key === "v") {
				return false;
			}
			if (event.ctrlKey && !event.shiftKey && !event.altKey && key === "c") {
				if (term.hasSelection()) {
					const ta = term.textarea;
					if (ta) {
						ta.value = term.getSelection();
						ta.select();
					}
					return false;
				}
			}
			return true;
		});

		const unregister = register(terminalId, {
			write: (data) => term.write(data),
			dispose: () => term.dispose(),
		});

		const sendDims = () => {
			try {
				fit.fit();
				send({
					type: "terminal_resize",
					terminalId,
					cols: term.cols,
					rows: term.rows,
				});
			} catch {
				// Container hidden — will re-fit when shown.
			}
		};

		// Spawn the PTY with the real fitted size (80x24 until layout settles).
		const raf = requestAnimationFrame(() => {
			try {
				fit.fit();
			} catch {
				// ignore
			}
			if (command) {
				send({
					type: "run_command",
					terminalId,
					command,
					cols: term.cols,
					rows: term.rows,
				});
			} else {
				send({
					type: "terminal_create",
					terminalId,
					cwd,
					cols: term.cols,
					rows: term.rows,
				});
			}
		});

		const onData = term.onData((data) => {
			send({ type: "terminal_input", terminalId, data });
		});

		let ro: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined") {
			ro = new ResizeObserver(() => {
				if (container.offsetWidth > 0 && container.offsetHeight > 0) {
					sendDims();
				}
			});
			ro.observe(container);
		}

		return () => {
			cancelAnimationFrame(raf);
			onData.dispose();
			ro?.disconnect();
			unregister();
			send({ type: "terminal_kill", terminalId });
			term.dispose();
			termRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terminalId, command, send, register]);

	// Becoming visible: re-fit (size may have changed while hidden) and focus.
	useEffect(() => {
		if (!active) return;
		const raf = requestAnimationFrame(() => {
			const inst = termRef.current;
			if (!inst) return;
			try {
				inst.fit.fit();
				send({
					type: "terminal_resize",
					terminalId,
					cols: inst.term.cols,
					rows: inst.term.rows,
				});
			} catch {
				// ignore
			}
			inst.term.focus();
		});
		return () => cancelAnimationFrame(raf);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active]);

	return (
		<div
			ref={containerRef}
			className={`term-xterm ${active ? "" : "hidden"}`}
		/>
	);
}
