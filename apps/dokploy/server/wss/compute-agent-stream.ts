import type http from "node:http";
import {
	findAgentRunById,
	findComputeSessionById,
	validateRequest,
} from "@dokploy/server";
import { WebSocket, WebSocketServer } from "ws";

// Live agent-output stream. The browser opens this with ?agentRunId=<dokploy id>; the
// server resolves the router run id + checks org ownership, then proxies to the
// compute-router's WS /agent-runs/:routerRunId/stream (which live-tails the background
// run — line-by-line for Modal, final chunk for Daytona/E2B).
export const setupComputeAgentStreamWebSocketServer = (
	server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
) => {
	const wss = new WebSocketServer({ noServer: true, path: "/compute-agent-stream" });

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = new URL(req.url || "", `http://${req.headers.host}`);
		if (pathname === "/_next/webpack-hmr") return;
		if (pathname === "/compute-agent-stream") {
			wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	wss.on("connection", async (ws, req) => {
		const url = new URL(req.url || "", `http://${req.headers.host}`);
		const agentRunId = url.searchParams.get("agentRunId");
		const { user, session } = await validateRequest(req);

		if (!agentRunId) return ws.close(4000, "agentRunId not provided");
		if (!user || !session) return ws.close();

		let run: Awaited<ReturnType<typeof findAgentRunById>>;
		try {
			run = await findAgentRunById(agentRunId);
		} catch {
			return ws.close(4004, "agent run not found");
		}
		if (!run.routerRunId) return ws.close(4009, "run not started on the router yet");

		const s = await findComputeSessionById(run.sessionId);
		if (s.environment?.project?.organizationId !== session.activeOrganizationId) {
			return ws.close(4003, "not your session");
		}

		const routerWs = (
			process.env.COMPUTE_ROUTER_URL ?? "http://compute-router:8000"
		).replace(/^http/, "ws");
		const key = process.env.COMPUTE_ROUTER_API_KEY ?? "dev-router-key";
		const upstream = new WebSocket(
			`${routerWs}/agent-runs/${run.routerRunId}/stream`,
			{ headers: { "x-api-key": key } },
		);

		upstream.on("message", (d) => ws.readyState === ws.OPEN && ws.send(d.toString()));
		upstream.on("close", () => ws.readyState === ws.OPEN && ws.close());
		upstream.on("error", (e) => {
			if (ws.readyState === ws.OPEN) ws.send(`[stream error] ${e.message}`);
		});
		ws.on("close", () => upstream.readyState === WebSocket.OPEN && upstream.close());
	});
};
