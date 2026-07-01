import {
	createComputeSession,
	execInComputeSession,
	findAgentRunById,
	findAgentRunsBySessionId,
	findComputeSessionById,
	findComputeSessionsByEnvironmentId,
	getComputeSessionMetrics,
	launchAibuildaiRun,
	launchComputeAgent,
	reconcileAgentRun,
	startComputeNotebook,
	teardownComputeSession,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import { environments, member } from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateComputeSession,
	apiExecComputeSession,
	apiFindOneAgentRun,
	apiFindOneComputeSession,
	apiLaunchAgent,
	apiListAgentRuns,
	apiListComputeSessions,
	apiRemoveComputeSession,
} from "@/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";

// Resolve the org member id for the caller (schema.researcherId -> member.id) and
// enforce that a session's environment belongs to the caller's active organization.
async function requireEnvMember(ctx: any, environmentId: string) {
	const env = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	const orgId = env?.project?.organizationId;
	if (!orgId || orgId !== ctx.session.activeOrganizationId) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "environment not in your org" });
	}
	const m = await db.query.member.findFirst({
		where: and(eq(member.userId, ctx.user.id), eq(member.organizationId, orgId)),
	});
	if (!m) throw new TRPCError({ code: "UNAUTHORIZED", message: "not a member" });
	return { orgId, memberId: m.id, member: m };
}

// GPU gating is the human-level lever, orthogonal to the per-session voucher budget.
// Reads the member's canRequestGpu flag (add the column + access-control statement
// per APPLY.md). Only Modal/gpu-batch is gated; daytona/e2b/local are open.
function assertGpuAllowed(m: any, backend: string | undefined, workloadType: string) {
	const needsGpu = backend === "modal" || workloadType === "gpu-batch";
	if (needsGpu && !m.canRequestGpu) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "you are not permitted to request GPU (gpu-batch/Modal) sessions",
		});
	}
}

export const computeSessionRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateComputeSession)
		.mutation(async ({ input, ctx }) => {
			const { orgId, memberId, member } = await requireEnvMember(ctx, input.environmentId);
			assertGpuAllowed(member, input.backend, input.workloadType);
			const session = await createComputeSession({ ...input, researcherId: memberId, orgId });
			await audit(ctx, {
				action: "create",
				resourceType: "compute-session" as any,
				resourceId: session.sessionId,
				resourceName: `${session.backend}:${input.workloadType}`,
			});
			return session;
		}),

	one: protectedProcedure
		.input(apiFindOneComputeSession)
		.query(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return s;
		}),

	all: protectedProcedure
		.input(apiListComputeSessions)
		.query(async ({ input, ctx }) => {
			await requireEnvMember(ctx, input.environmentId);
			return findComputeSessionsByEnvironmentId(input.environmentId);
		}),

	exec: protectedProcedure
		.input(apiExecComputeSession)
		.mutation(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return execInComputeSession(input.sessionId, input.command, input.session);
		}),

	// Notebook tab: launch server-mode Marimo (real kernel) in this session's sandbox.
	// Interactive sessions are Daytona-backed, so the kernel persists; the router rejects
	// any non-persistent backend and never serves WASM.
	notebook: protectedProcedure
		.input(apiFindOneComputeSession)
		.mutation(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return startComputeNotebook(input.sessionId);
		}),

	// Monitoring tab: normalized per-backend metrics from the router.
	metrics: protectedProcedure
		.input(apiFindOneComputeSession)
		.query(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return getComputeSessionMetrics(input.sessionId);
		}),

	// Agent runs tab: launch a headless Claude Code / Codex run + list/get past runs.
	launchAgent: protectedProcedure
		.input(apiLaunchAgent)
		.mutation(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return launchComputeAgent(input);
		}),

	agentRuns: protectedProcedure
		.input(apiListAgentRuns)
		.query(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return findAgentRunsBySessionId(input.sessionId);
		}),

	agentRunOne: protectedProcedure
		.input(apiFindOneAgentRun)
		.query(async ({ input, ctx }) => {
			const run = await findAgentRunById(input.agentRunId);
			const s = await findComputeSessionById(run.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			return reconcileAgentRun(input.agentRunId);
		}),

	// AIBuildAI run form -> a gpu-batch session on Modal + the aibuildai CLI. GPU-gated.
	launchAibuildaiRun: protectedProcedure
		.input(
			z.object({
				environmentId: z.string().min(1),
				taskName: z.string().min(1),
				dataDir: z.string().min(1),
				instruction: z.string().min(1),
				candidateCount: z.number().int().min(1).default(3),
				runBudgetMinutes: z.number().int().min(1).default(90),
				maxBudgetUsd: z.number().positive().default(20),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const { orgId, memberId, member } = await requireEnvMember(
				ctx,
				input.environmentId,
			);
			assertGpuAllowed(member, "modal", "gpu-batch");
			const session = await launchAibuildaiRun({
				...input,
				researcherId: memberId,
				orgId,
			});
			await audit(ctx, {
				action: "create",
				resourceType: "compute-session" as any,
				resourceId: session.sessionId,
				resourceName: `aibuildai:${input.taskName}`,
			});
			return session;
		}),

	remove: protectedProcedure
		.input(apiRemoveComputeSession)
		.mutation(async ({ input, ctx }) => {
			const s = await findComputeSessionById(input.sessionId);
			await requireEnvMember(ctx, s.environmentId);
			await audit(ctx, {
				action: "delete",
				resourceType: "compute-session" as any,
				resourceId: input.sessionId,
			});
			return teardownComputeSession(input.sessionId, input.reason);
		}),
});
