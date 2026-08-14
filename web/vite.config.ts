import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dev: Vite serves the web UI on :5173 and proxies the WebSocket + any API
// traffic to the backend server (which runs separately via `npm run dev:server`).
export default defineConfig({
	root: __dirname,
	plugins: [react()],
	build: {
		outDir: join(__dirname, "dist"),
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:8787",
			"/ws": {
				target: "ws://localhost:8787",
				ws: true,
				// Don't leak sockets when the backend is down/restarting (avoids
				// ERR_INSUFFICIENT_RESOURCES from accumulated dead proxy sockets).
				configure(proxy) {
					proxy.on("error", (_err, _req, socket) => {
						(socket as { destroy?: () => void } | undefined)?.destroy?.();
					});
					proxy.on("proxyReqWs", (_proxyReq, _req, socket) => {
						socket.on("error", () => {});
					});
				},
			},
		},
	},
});
