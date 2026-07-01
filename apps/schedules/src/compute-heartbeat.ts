import { Queue, Worker } from "bullmq";
import { logger } from "./logger.js";

// The 60s budget/TTL reaper — a BullMQ repeatable job (Dokploy has NO Inngest; this is
// the same apps/schedules surface that already runs backups). GPU sessions also get a
// tighter loop because H100 burn outpaces a 60s tick (hardening finding #2).
const connection = { url: process.env.REDIS_URL! };
export const computeQueue = new Queue("computeQueue", {
	connection,
	defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
});

const ROUTER = process.env.COMPUTE_ROUTER_URL ?? "http://compute-router:8000";
const KEY = process.env.COMPUTE_ROUTER_API_KEY ?? "dev-router-key";

export async function registerComputeHeartbeat() {
	await computeQueue.add("heartbeat", { scope: "all" }, {
		repeat: { pattern: "*/1 * * * *" }, // every minute
	});
	await computeQueue.add("heartbeat-gpu", { scope: "gpu" }, {
		repeat: { every: 20_000 }, // 20s for gpu-batch — the trimmer for fast GPU burn
	});
	logger.info("compute heartbeat repeatables registered");
}

export function startComputeHeartbeatWorker() {
	return new Worker(
		"computeQueue",
		async (job) => {
			const scope = job.data?.scope ?? "all";
			// Cheap list-by-tag (Modal tags / Daytona labels / E2B metadata) via the
			// router; kill any session whose accrued cost >= its maxBudgetUsd or whose
			// TTL passed. The router does the provider calls; we drive the schedule.
			const res = await fetch(`${ROUTER}/sessions/reap?scope=${scope}`, {
				method: "POST",
				headers: { "x-api-key": KEY },
			});
			if (!res.ok) {
				logger.error(`compute reap ${scope} failed: ${res.status}`);
				return;
			}
			const { killed } = (await res.json()) as { killed: string[] };
			if (killed?.length) logger.info(`budget/TTL killed: ${killed.join(", ")}`);
		},
		{ connection, concurrency: 10 },
	);
}
