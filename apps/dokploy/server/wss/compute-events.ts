import type http from "node:http";
import { findComputeSessionById, validateRequest } from "@dokploy/server";
import { WebSocketServer } from "ws";

// Live cost/status push for the session card — replaces client-side tRPC polling. On
// connect (?sessionId=) it pushes a snapshot every 2s; the card interpolates cost per
// second between snapshots for a smooth ticker. The heartbeat updates costConsumedUsd on
// the row, so these pushes reflect real accrual, not just client-side extrapolation.
export const setupComputeEventsWebSocketServer = (
	server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>,
) => {
	const wss = new WebSocketServer({ noServer: true, path: "/compute-events" });

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = new URL(req.url || "", `http://${req.headers.host}`);
		if (pathname === "/_next/webpack-hmr") return;
		if (pathname === "/compute-events") {
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

		const push = async () => {
			try {
				const s = await findComputeSessionById(sessionId);
				if (s.environment?.project?.organizationId !== session.activeOrganizationId) {
					return ws.close(4003, "not your session");
				}
				if (ws.readyState === ws.OPEN) {
					ws.send(
						JSON.stringify({
							status: s.status,
							costEstimatePerHour: s.costEstimatePerHour,
							costConsumedUsd: s.costConsumedUsd,
							maxBudgetUsd: s.maxBudgetUsd,
						}),
					);
				}
			} catch {
				ws.close(4004, "session not found");
			}
		};

		await push();
		const timer = setInterval(push, 2000);
		ws.on("close", () => clearInterval(timer));
	});
};
