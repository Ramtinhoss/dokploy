import type http from "node:http";
import { findComputeSessionById, validateRequest } from "@dokploy/server";
import { WebSocket, WebSocketServer } from "ws";

// Terminal tab for a remote compute session. Same `ws` + `server.on("upgrade")` +
// `validateRequest` plumbing as docker-container-terminal.ts, but it PROXIES the browser
// websocket straight through to the compute-router's streaming terminal WS
// (`/sessions/:id/terminal`), which attaches to a persistent tmux session inside the
// session's sandbox — the SAME sandbox that hosts the server-mode Marimo kernel, so the
// terminal and notebook share one workspace filesystem. tmux keeps the shell alive across
// a dropped socket (laptop sleep); the router (not this proxy) speaks to the provider SDK.
export const setupComputeTerminalWebSocketServer = (
	server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
) => {
	const wss = new WebSocketServer({ noServer: true, path: "/compute-terminal" });

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = new URL(req.url || "", `http://${req.headers.host}`);
		if (pathname === "/_next/webpack-hmr") return;
		if (pathname === "/compute-terminal") {
			wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	wss.on("connection", async (ws, req) => {
		const url = new URL(req.url || "", `http://${req.headers.host}`);
		const sessionId = url.searchParams.get("sessionId");
		const { user, session } = await validateRequest(req);

		if (!sessionId) return ws.close(4000, "sessionId not provided");
		if (!user || !session) return ws.close();

		let s: Awaited<ReturnType<typeof findComputeSessionById>>;
		try {
			s = await findComputeSessionById(sessionId);
		} catch {
			return ws.close(4004, "session not found");
		}
		if (s.environment?.project?.organizationId !== session.activeOrganizationId) {
			return ws.close(4003, "not your session");
		}
		if (s.status !== "running") return ws.close(4009, "session not running");

		const routerHttp = process.env.COMPUTE_ROUTER_URL ?? "http://compute-router:8000";
		const routerWs = routerHttp.replace(/^http/, "ws");
		const key = process.env.COMPUTE_ROUTER_API_KEY ?? "dev-router-key";

		// bridge: browser <-> this proxy <-> router terminal WS (persistent tmux session)
		const upstream = new WebSocket(`${routerWs}/sessions/${sessionId}/terminal`, {
			headers: { "x-api-key": key },
		});

		upstream.on("open", () => ws.send("\r\nterminal connected\r\n"));
		upstream.on("message", (data) => {
			if (ws.readyState === ws.OPEN) ws.send(data.toString());
		});
		upstream.on("close", () => ws.readyState === ws.OPEN && ws.close());
		upstream.on("error", (err) => {
			if (ws.readyState === ws.OPEN) ws.send(`\r\n[router error] ${err.message}\r\n`);
		});

		ws.on("message", (message) => {
			const line = Buffer.isBuffer(message) ? message.toString("utf8") : String(message);
			if (upstream.readyState === WebSocket.OPEN) upstream.send(line);
		});
		ws.on("close", () => upstream.readyState === WebSocket.OPEN && upstream.close());
	});
};
