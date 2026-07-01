import { relations } from "drizzle-orm";
import { integer, jsonb, pgEnum, pgTable, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { computeSessions } from "./compute-session";

// A headless agent invocation inside a compute session (Claude Code / Codex / AIBuildAI).
// The authoritative record lives here; the router executes + streams and reports back.
export const agentType = pgEnum("agentType", ["claude", "codex", "aibuildai"]);
export const agentRunStatus = pgEnum("agentRunStatus", [
	"running",
	"succeeded",
	"failed",
]);

export const agentRuns = pgTable("agent_run", {
	agentRunId: text("agentRunId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	sessionId: text("sessionId")
		.notNull()
		.references(() => computeSessions.sessionId, { onDelete: "cascade" }),
	routerRunId: text("routerRunId"), // the compute-router's run id (for stream + reconcile)
	agentType: agentType("agentType").notNull(),
	status: agentRunStatus("status").notNull().default("running"),
	command: jsonb("command").$type<string[]>(),
	exitCode: integer("exitCode"),
	output: text("output"),
	artifacts: jsonb("artifacts").$type<{ name: string; path: string }[]>(),
	budgetConsumedUsd: real("budgetConsumedUsd").notNull().default(0),
	startedAt: text("startedAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	finishedAt: text("finishedAt"),
});

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
	session: one(computeSessions, {
		fields: [agentRuns.sessionId],
		references: [computeSessions.sessionId],
	}),
}));

const createSchema = createInsertSchema(agentRuns, {
	sessionId: z.string().min(1),
	agentType: z.enum(["claude", "codex", "aibuildai"]),
});

export const apiLaunchAgent = z.object({
	sessionId: z.string().min(1),
	agentType: z.enum(["claude", "codex"]),
	task: z.string().min(1),
});

export const apiListAgentRuns = z.object({
	sessionId: z.string().min(1),
});

export const apiFindOneAgentRun = z.object({
	agentRunId: z.string().min(1),
});
