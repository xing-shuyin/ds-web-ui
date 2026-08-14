/**
 * serialize.js — converts DeepSeek Harness session events / messages into the
 * browser-friendly UiMessage[] shape defined by the pi-web-ui protocol
 * (mirrored in protocol docs). Keeps payloads bounded with truncation markers
 * so snapshots stay cheap to stream.
 *
 * DSH message vocabulary (dsh-llm):
 *   content blocks: text | reasoning | image | tool-call | tool-result
 *   roles:          system | user | assistant  (toolResult is role "user" with
 *                  a single tool-result block)
 */

const TEXT_CAP = 200_000;
const TOOL_OUTPUT_CAP = 100_000;
const ARGS_CAP = 20_000;

function truncate(s, cap) {
	if (typeof s !== "string") s = String(s ?? "");
	if (s.length <= cap) return { text: s, truncated: false };
	return { text: `${s.slice(0, cap)}\n\n… [truncated]`, truncated: true };
}

/** DSH content blocks (user-role) → UiContentBlock[] */
export function serializeUserContent(blocks) {
	if (!Array.isArray(blocks)) return [{ type: "text", text: String(blocks ?? "") }];
	return blocks.map((b) => {
		switch (b?.type) {
			case "image":
				return { type: "image", dataUrl: b.attachment?.url };
			case "text":
			default:
				return { type: "text", text: String(b.text ?? "") };
		}
	});
}

/** DSH content blocks (assistant-role) → UiContentBlock[] */
export function serializeAssistantContent(blocks) {
	if (!Array.isArray(blocks)) return [];
	return blocks.map((b) => {
		switch (b?.type) {
			case "text": {
				const { text, truncated } = truncate(b.text, TEXT_CAP);
				return { type: "text", text, truncated };
			}
			case "reasoning": {
				return { type: "thinking", thinking: b.text ?? "" };
			}
			case "tool-call": {
				const { text, truncated } = truncate(b.arguments, ARGS_CAP);
				return {
					type: "toolCall",
					id: b.id,
					name: b.name,
					argumentsText: text,
					argumentsTruncated: truncated,
				};
			}
			default:
				return { type: "unknown", ...b };
		}
	});
}

/**
 * Convert one DSH message into a UiMessage.
 * @param {object} msg DSH Message { id, role, content, source }
 * @returns {object|null} UiMessage
 */
export function dshMessageToUiMessage(msg) {
	if (!msg || typeof msg !== "object" || !msg.id) return null;
	switch (msg.role) {
		case "user": {
			// A tool-result message is a user-role message with one tool-result
			// block — surface it as role "toolResult" like the pi SDK does.
			const blocks = Array.isArray(msg.content) ? msg.content : [];
			const tr = blocks.find((b) => b?.type === "tool-result");
			if (tr) {
				const raw = (Array.isArray(tr.content) ? tr.content : [])
					.map((c) => (c?.type === "text" ? c.text : "[image result]"))
					.filter((t) => t !== undefined && t !== null)
					.join("\n");
				const { text, truncated } = truncate(raw, TOOL_OUTPUT_CAP);
				return {
					id: `t-${tr.toolCallId}`,
					role: "toolResult",
					content: [{ type: "text", text, truncated }],
					toolCallId: tr.toolCallId,
					toolName: msg.toolName,
					isError: tr.isError === true,
					timestamp: msg.time,
				};
			}
			return {
				id: `u-${msg.id}`,
				role: "user",
				content: serializeUserContent(blocks),
				timestamp: msg.time,
			};
		}
		case "assistant": {
			return {
				id: `a-${msg.id}`,
				role: "assistant",
				content: serializeAssistantContent(msg.content),
				timestamp: msg.time,
				model: msg.model,
				provider: msg.provider,
				stopReason: msg.finishReason,
				errorMessage: msg.errorMessage,
			};
		}
		default:
			return null;
	}
}

/**
 * Build the streaming (in-progress) assistant UiMessage from accumulated
 * chunk deltas. The id must be STABLE across snapshots so the React component
 * doesn't remount every 60ms — we use a fixed "stream" id.
 */
export function buildStreamingUiMessage(stream) {
	const content = [];
	if (stream.text) content.push({ type: "text", text: stream.text });
	if (stream.thinking) content.push({ type: "thinking", thinking: stream.thinking });
	for (const tc of stream.toolCalls) {
		const { text, truncated } = truncate(tc.arguments, ARGS_CAP);
		content.push({
			type: "toolCall",
			id: tc.id,
			name: tc.name ?? "tool",
			argumentsText: text,
			argumentsTruncated: truncated,
		});
	}
	return {
		id: "stream",
		role: "assistant",
		content,
		timestamp: stream.timestamp ?? Date.now(),
		model: stream.model,
		provider: stream.provider,
	};
}
