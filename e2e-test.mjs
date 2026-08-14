/**
 * End-to-end smoke test: connect, hello, prompt a real model call,
 * watch the event stream until the run goes idle, print the messages.
 * Usage: node e2e-test.mjs [text]
 */
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8790/ws");
const promptText = process.argv[2] ?? "用一句话介绍你自己";
let state = null;
let sent = false;
const t0 = Date.now();

const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", clientId: "e2e-client" }));
});

ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  switch (m.type) {
    case "ready":
      log("ready");
      break;
    case "snapshot": {
      state = m.state;
      if (!sent && state.piConfigured) {
        log("configured=true, sending prompt:", promptText);
        ws.send(JSON.stringify({ type: "prompt", text: promptText }));
        sent = true;
      }
      break;
    }
    case "tool_status":
      log("tool_status:", m.toolName, m.isError ? "ERROR" : "ok", m.durationMs ? `${m.durationMs}ms` : "");
      break;
    case "notice":
      log("notice:", m.level, m.text);
      break;
    case "sessions":
      log("sessions:", m.sessions.length, m.sessions[0]?.firstMessage ?? "");
      break;
    default:
      break;
  }
  if (state && state.isStreaming === false && sent && state.messages.length > 0) {
    const last = state.messages[state.messages.length - 1];
    if (last.role === "assistant") {
      log("=== DONE ===");
      for (const msg of state.messages) {
        const text = msg.content.map((c) => c.type === "text" ? c.text : `[${c.type}]`).join(" ");
        log(`- [${msg.role}]`, text.slice(0, 200));
      }
      ws.close();
      process.exit(0);
    }
  }
});

setTimeout(() => {
  log("TIMEOUT — final state:",
    state ? `msgs=${state.messages.length} streaming=${state.isStreaming} err=${state.errorMessage ?? "-"}` : "no state");
  if (state?.errorMessage) log("error:", state.errorMessage);
  process.exit(1);
}, 90_000);
