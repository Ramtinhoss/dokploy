import { createHmac } from "node:crypto";
import { db } from "@dokploy/server/db";
import {
	agentRuns,
	type apiCreateComputeSession,
	computeSessions,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";

export type ComputeSession = typeof computeSessions.$inferSelect;

const ROUTER_URL = process.env.COMPUTE_ROUTER_URL ?? "http://compute-router:8000";
const ROUTER_API_KEY = process.env.COMPUTE_ROUTER_API_KEY ?? "dev-router-key";
const VOUCHER_SECRET = process.env.VOUCHER_SECRET ?? "dev-secret";

// --- voucher signing ------------------------------------------------------------
// MUST byte-match the Python verifier (compute_router.voucher): canonical JSON with
// recursively-sorted keys + compact separators, base64url(no padding) body, HMAC-SHA256
// over the ASCII body string. Claim values are ASCII (ids), so ensure_ascii parity holds.
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const keys = Object.keys(value as Record<string, unknown>).sort();
	const body = keys
		.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`)
		.join(",");
	return `{${body}}`;
}

function b64url(buf: Buffer): string {
	return buf.toString("base64url");
}

export interface VoucherClaims {
	voucher_id: string;
	sub: string;
	org_id: string;
	workload_type: string;
	backend: string | null;
	scope: {
		max_budget_usd: number;
		timeout_seconds: number;
		resources: { cpu: number; memory_gb: number; gpu: string | null };
	};
	approval_required: boolean;
	iat: number;
	redeem_ttl_seconds: number;
	nonce: string;
}

export function signVoucher(claims: VoucherClaims): string {
	const body = b64url(Buffer.from(canonicalJson(claims), "utf8"));
	const mac = createHmac("sha256", VOUCHER_SECRET).update(body, "ascii").digest();
	return `${body}.${b64url(mac)}`;
}

// --- router HTTP client ---------------------------------------------------------
async function callRouter(method: string, path: string, body?: unknown) {
	const res = await fetch(`${ROUTER_URL}${path}`, {
		method,
		headers: { "content-type": "application/json", "x-api-key": ROUTER_API_KEY },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `compute-router ${method} ${path} -> ${res.status}: ${await res.text()}`,
		});
	}
	return res.json();
}

// --- CRUD + provisioning --------------------------------------------------------
export const createComputeSession = async (
	input: z.infer<typeof apiCreateComputeSession> & {
		researcherId: string;
		orgId: string;
	},
) => {
	// Idempotency: a duplicate requestId returns the existing row, never a 2nd sandbox
	// (finding #1). Prod migration adds a UNIQUE index; this is the app-level guard.
	const existing = await db.query.computeSessions.findFirst({
		where: eq(computeSessions.requestId, input.requestId),
	});
	if (existing) return existing;

	// image is infra config, not a user choice: default to the CUDA base for gpu-batch,
	// the CPU base otherwise. The form can still override it.
	const imageRef =
		input.backendImageRef ??
		(input.workloadType === "gpu-batch"
			? (process.env.RESEARCH_BASE_IMAGE_CUDA ?? "reg/base:cuda-v1")
			: (process.env.RESEARCH_BASE_IMAGE_CPU ?? "reg/base:cpu-v1"));

	const nonce = nanoidNonce();
	const now = Math.floor(Date.now() / 1000);
	const voucher = signVoucher({
		voucher_id: nonce,
		sub: input.researcherId,
		org_id: input.orgId,
		workload_type: input.workloadType,
		backend: input.backend ?? null,
		scope: {
			max_budget_usd: input.maxBudgetUsd,
			timeout_seconds: input.timeoutSeconds,
			resources: { cpu: input.cpu, memory_gb: input.memoryGb, gpu: input.gpu ?? null },
		},
		approval_required: false,
		iat: now,
		redeem_ttl_seconds: 60,
		nonce,
	});

	// Write the authoritative row FIRST (status creating), then call the router.
	const row = await db
		.insert(computeSessions)
		.values({
			requestId: input.requestId,
			backend: input.backend ?? "daytona",
			workloadType: input.workloadType,
			backendImageRef: imageRef,
			maxBudgetUsd: input.maxBudgetUsd,
			voucherId: nonce,
			gpu: input.gpu ?? null,
			environmentId: input.environmentId,
			researcherId: input.researcherId,
			status: "creating",
		})
		.returning()
		.then((r) => r[0]);
	if (!row) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "insert compute session failed" });
	}

	const result = (await callRouter("POST", "/sessions", {
		voucher,
		request: {
			request_id: input.requestId,
			project_id: "",
			researcher_id: input.researcherId,
			workload_type: input.workloadType,
			image_base: imageRef,
			timeout_seconds: input.timeoutSeconds,
			backend: input.backend ?? null,
			cpu: input.cpu,
			memory_gb: input.memoryGb,
			disk_gb: input.diskGb,
			gpu: input.gpu ?? null,
		},
	})) as any;

	return updateComputeSession(row.sessionId, {
		backend: result.backend,
		backendNativeId: result.backend_native_id,
		status: "running",
		costEstimatePerHour: result.cost_estimate_per_hour,
	});
};

export const findComputeSessionById = async (sessionId: string) => {
	const s = await db.query.computeSessions.findFirst({
		where: eq(computeSessions.sessionId, sessionId),
		with: { environment: { with: { project: true } }, researcher: true },
	});
	if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Compute session not found" });
	return s;
};

export const findComputeSessionsByEnvironmentId = async (environmentId: string) =>
	db.query.computeSessions.findMany({
		where: eq(computeSessions.environmentId, environmentId),
	});

export const updateComputeSession = async (
	sessionId: string,
	data: Partial<ComputeSession>,
) => {
	const s = await db
		.update(computeSessions)
		.set(data)
		.where(eq(computeSessions.sessionId, sessionId))
		.returning()
		.then((r) => r[0]);
	if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Compute session not found" });
	return s;
};

export const teardownComputeSession = async (sessionId: string, reason = "explicit") => {
	const s = await findComputeSessionById(sessionId);
	if (s.backendNativeId) {
		await callRouter("DELETE", `/sessions/${sessionId}?reason=${reason}`);
	}
	return updateComputeSession(sessionId, { status: "stopped" });
};

export const execInComputeSession = async (
	sessionId: string,
	command: string[],
	session?: string,
) => callRouter("POST", `/sessions/${sessionId}/exec`, { command, session });

// --- monitoring + agent runs ----------------------------------------------------

// Per-backend metrics, normalized to a common shape by the router (E2B has real stats;
// Daytona/Modal return status + a note). Feeds the Monitoring tab.
export const getComputeSessionMetrics = async (sessionId: string) =>
	callRouter("GET", `/sessions/${sessionId}/metrics`);

export const findAgentRunById = async (agentRunId: string) => {
	const r = await db.query.agentRuns.findFirst({
		where: eq(agentRuns.agentRunId, agentRunId),
	});
	if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found" });
	return r;
};

// Finalize a still-running row from the router (best-effort). The router runs the agent
// async and streams; this pulls the current state and, once finished, records the final
// status/output/exit/artifacts. Returns the (possibly updated) row.
export const reconcileAgentRun = async (agentRunId: string) => {
	const row = await findAgentRunById(agentRunId);
	if (row.status !== "running" || !row.routerRunId) return row;
	try {
		const r = (await callRouter("GET", `/agent-runs/${row.routerRunId}`)) as any;
		const set =
			r.finished_at == null
				? { output: r.output ?? row.output } // still running -> refresh live output
				: {
						status: r.status,
						exitCode: r.exit_code ?? null,
						output: r.output ?? null,
						command: r.command ?? null,
						artifacts: r.artifacts ?? null,
						finishedAt: new Date().toISOString(),
					};
		return db
			.update(agentRuns)
			.set(set)
			.where(eq(agentRuns.agentRunId, agentRunId))
			.returning()
			.then((x) => x[0]);
	} catch {
		return row; // router unreachable -> leave as-is
	}
};

export const findAgentRunsBySessionId = async (sessionId: string) => {
	const rows = await db.query.agentRuns.findMany({
		where: eq(agentRuns.sessionId, sessionId),
	});
	return Promise.all(
		rows.map((r) =>
			r.status === "running" && r.routerRunId ? reconcileAgentRun(r.agentRunId) : r,
		),
	);
};

// Persist the run row (running), start it on the router with stream:true (async), and
// store the router's run id so the Agent runs tab can tail it live over a websocket and
// reconcileAgentRun can finalize it. The router builds the argv with the dangerous-flags
// guard, so bypass flags can never reach a non-sandbox backend.
export const launchComputeAgent = async (input: {
	sessionId: string;
	agentType: "claude" | "codex";
	task: string;
}) => {
	const row = await db
		.insert(agentRuns)
		.values({
			sessionId: input.sessionId,
			agentType: input.agentType,
			status: "running",
		})
		.returning()
		.then((r) => r[0]);
	if (!row) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "insert agent run failed" });
	}

	const result = (await callRouter("POST", `/sessions/${input.sessionId}/agent`, {
		agentType: input.agentType,
		task: input.task,
		stream: true,
	})) as any;

	return db
		.update(agentRuns)
		.set({
			routerRunId: result.run_id ?? null,
			status: result.status ?? "running",
			command: result.command ?? null,
		})
		.where(eq(agentRuns.agentRunId, row.agentRunId))
		.returning()
		.then((r) => r[0]);
};

// Start server-mode Marimo (a real Python kernel) inside the session's sandbox — the
// router refuses non-persistent backends and never serves a WASM export. Returns the
// notebook URL the Notebook tab iframes (through Traefik, keyed by session id).
export const startComputeNotebook = async (sessionId: string) =>
	callRouter("POST", `/sessions/${sessionId}/notebook`);

// AIBuildAI run: a gpu-batch session on Modal (the only backend with in-sandbox GPU),
// then the aibuildai CLI. Run budget is enforced by the Modal SDK timeout
// (timeoutSeconds = runBudgetMinutes*60), NOT a --run-budget-minutes flag (does not
// exist). Output is submit.py / submission.csv / progress.pdf (never inference.py).
export const launchAibuildaiRun = async (input: {
	environmentId: string;
	researcherId: string;
	orgId: string;
	taskName: string;
	dataDir: string;
	instruction: string;
	candidateCount: number;
	runBudgetMinutes: number;
	maxBudgetUsd: number;
}) => {
	const imageRef = process.env.RESEARCH_BASE_IMAGE_CUDA ?? "reg/base:cuda-v1";
	const session = await createComputeSession({
		requestId: `aib-${nanoidNonce()}`,
		backend: "modal",
		workloadType: "gpu-batch",
		backendImageRef: imageRef,
		maxBudgetUsd: input.maxBudgetUsd,
		gpu: "H100",
		environmentId: input.environmentId,
		cpu: 4,
		memoryGb: 16,
		diskGb: 20,
		timeoutSeconds: input.runBudgetMinutes * 60,
		researcherId: input.researcherId,
		orgId: input.orgId,
	} as any);

	const command = [
		"aibuildai",
		"--no-form",
		"--task-name",
		input.taskName,
		"--data-dir",
		input.dataDir, // materialized GCS mount, never a gs:// URI
		"--instruction",
		input.instruction,
		"--playground-dir",
		"/work/playground",
		...(input.candidateCount
			? ["--max-agent-calls", String(input.candidateCount)]
			: []),
	];
	// TODO(next): stream progress + sync submit.py/submission.csv/progress.pdf to GCS.
	await execInComputeSession(session.sessionId, command);
	return session;
};

// small local nonce generator so this file has no extra imports
function nanoidNonce(): string {
	return createHmac("sha256", VOUCHER_SECRET)
		.update(`${Date.now()}:${Math.random()}`)
		.digest("hex")
		.slice(0, 24);
}
