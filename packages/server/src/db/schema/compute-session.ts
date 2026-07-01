import { relations } from "drizzle-orm";
import { boolean, pgEnum, pgTable, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { member } from "./account";
import { environments } from "./environment";

// A Compute Session is a 4th resource type alongside application/postgres/compose.
// It is the durable, authoritative row for a remote sandbox; the compute-router
// (FastAPI sidecar) holds only transient provider state and reconciles against this.
export const computeBackend = pgEnum("computeBackend", [
	"daytona",
	"e2b",
	"modal",
	"local",
]);

export const computeWorkloadType = pgEnum("computeWorkloadType", [
	"interactive",
	"untrusted-exec",
	"gpu-batch",
	"standing-infra",
]);

export const computeSessionStatus = pgEnum("computeSessionStatus", [
	"creating",
	"running",
	"stopped",
	"expired",
	"error",
]);

export const computeSessions = pgTable("compute_session", {
	sessionId: text("sessionId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	// idempotency key: retries with the same requestId must NOT double-provision.
	// A UNIQUE index on this is the gate for hardening finding #1 (see migration note).
	requestId: text("requestId").notNull(),
	backend: computeBackend("backend").notNull(),
	backendNativeId: text("backendNativeId"),
	status: computeSessionStatus("status").notNull().default("creating"),
	workloadType: computeWorkloadType("workloadType").notNull(),
	backendImageRef: text("backendImageRef").notNull(), // Artifact Registry ref
	costEstimatePerHour: real("costEstimatePerHour").notNull().default(0),
	costConsumedUsd: real("costConsumedUsd").notNull().default(0), // accrued by heartbeat
	egressBaselineUsd: real("egressBaselineUsd").notNull().default(0), // finding #8
	maxBudgetUsd: real("maxBudgetUsd").notNull(),
	voucherId: text("voucherId").notNull(),
	gpu: text("gpu"), // null => CPU-only
	expiresAt: text("expiresAt"),
	isBudgetKilled: boolean("isBudgetKilled").notNull().default(false),
	environmentId: text("environmentId")
		.notNull()
		.references(() => environments.environmentId, { onDelete: "cascade" }),
	researcherId: text("researcherId")
		.notNull()
		.references(() => member.id, { onDelete: "cascade" }),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const computeSessionsRelations = relations(computeSessions, ({ one }) => ({
	environment: one(environments, {
		fields: [computeSessions.environmentId],
		references: [environments.environmentId],
	}),
	researcher: one(member, {
		fields: [computeSessions.researcherId],
		references: [member.id],
	}),
}));

const createSchema = createInsertSchema(computeSessions, {
	requestId: z.string().min(1),
	backend: z.enum(["daytona", "e2b", "modal", "local"]).optional(),
	workloadType: z.enum([
		"interactive",
		"untrusted-exec",
		"gpu-batch",
		"standing-infra",
	]),
	backendImageRef: z.string().optional(), // resolved server-side by workloadType if omitted
	maxBudgetUsd: z.number().positive(),
	gpu: z.enum(["T4", "L4", "A10G", "A100", "H100"]).optional(),
	environmentId: z.string().min(1),
});

export const apiCreateComputeSession = createSchema
	.pick({
		requestId: true,
		backend: true,
		workloadType: true,
		backendImageRef: true,
		maxBudgetUsd: true,
		gpu: true,
		environmentId: true,
	})
	.extend({
		cpu: z.number().min(1).default(2),
		memoryGb: z.number().min(1).default(4),
		diskGb: z.number().min(1).default(10),
		timeoutSeconds: z.number().min(60).default(3600),
	});

export const apiFindOneComputeSession = z.object({
	sessionId: z.string().min(1),
});

export const apiRemoveComputeSession = z.object({
	sessionId: z.string().min(1),
	reason: z.string().optional(),
});

export const apiExecComputeSession = z.object({
	sessionId: z.string().min(1),
	command: z.array(z.string()).min(1),
	session: z.string().optional(), // set => persistent shell (terminal)
});

export const apiListComputeSessions = z.object({
	environmentId: z.string().min(1),
});
