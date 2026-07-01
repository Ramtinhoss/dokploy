CREATE TYPE "public"."agentRunStatus" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agentType" AS ENUM('claude', 'codex', 'aibuildai');--> statement-breakpoint
CREATE TYPE "public"."computeBackend" AS ENUM('daytona', 'e2b', 'modal', 'local');--> statement-breakpoint
CREATE TYPE "public"."computeSessionStatus" AS ENUM('creating', 'running', 'stopped', 'expired', 'error');--> statement-breakpoint
CREATE TYPE "public"."computeWorkloadType" AS ENUM('interactive', 'untrusted-exec', 'gpu-batch', 'standing-infra');--> statement-breakpoint
CREATE TABLE "agent_run" (
	"agentRunId" text PRIMARY KEY NOT NULL,
	"sessionId" text NOT NULL,
	"routerRunId" text,
	"agentType" "agentType" NOT NULL,
	"status" "agentRunStatus" DEFAULT 'running' NOT NULL,
	"command" jsonb,
	"exitCode" integer,
	"output" text,
	"artifacts" jsonb,
	"budgetConsumedUsd" real DEFAULT 0 NOT NULL,
	"startedAt" text NOT NULL,
	"finishedAt" text
);
--> statement-breakpoint
CREATE TABLE "compute_session" (
	"sessionId" text PRIMARY KEY NOT NULL,
	"requestId" text NOT NULL,
	"backend" "computeBackend" NOT NULL,
	"backendNativeId" text,
	"status" "computeSessionStatus" DEFAULT 'creating' NOT NULL,
	"workloadType" "computeWorkloadType" NOT NULL,
	"backendImageRef" text NOT NULL,
	"costEstimatePerHour" real DEFAULT 0 NOT NULL,
	"costConsumedUsd" real DEFAULT 0 NOT NULL,
	"egressBaselineUsd" real DEFAULT 0 NOT NULL,
	"maxBudgetUsd" real NOT NULL,
	"voucherId" text NOT NULL,
	"gpu" text,
	"expiresAt" text,
	"isBudgetKilled" boolean DEFAULT false NOT NULL,
	"environmentId" text NOT NULL,
	"researcherId" text NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "canRequestGpu" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_sessionId_compute_session_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."compute_session"("sessionId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_session" ADD CONSTRAINT "compute_session_environmentId_environment_environmentId_fk" FOREIGN KEY ("environmentId") REFERENCES "public"."environment"("environmentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_session" ADD CONSTRAINT "compute_session_researcherId_member_id_fk" FOREIGN KEY ("researcherId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;