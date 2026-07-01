import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";
import { Loader2, Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// Bespoke "new AIBuildAI run" form (the one-click template engine produces compose stacks
// from TOML — a poor fit). Submits a gpu-batch run routed to Modal. Uses the VERIFIED
// CLI only: output is submit.py (not inference.py), and run budget is enforced by the
// Modal SDK timeout (timeoutSeconds = runBudgetMinutes*60), not a --run-budget-minutes
// flag (which does not exist).
export const AibuildaiRunForm = ({ environmentId }: { environmentId: string }) => {
	const [f, setF] = useState({
		taskName: "",
		dataDir: "/work/data",
		instruction: "",
		candidateCount: 3,
		runBudgetMinutes: 90,
		maxBudgetUsd: 20,
	});
	const run = api.computeSession.launchAibuildaiRun.useMutation({
		onSuccess: () => toast.success("AIBuildAI run started on Modal (gpu-batch)"),
		onError: (e) => toast.error(e.message),
	});

	const set = (k: keyof typeof f) => (v: string) =>
		setF((p) => ({ ...p, [k]: k === "instruction" || k.endsWith("Name") || k.endsWith("Dir") ? v : Number(v) }));

	return (
		<div className="flex flex-col gap-4 rounded-lg border p-4">
			<div className="grid grid-cols-2 gap-4">
				<div className="flex flex-col gap-1.5">
					<Label>Task name</Label>
					<Input value={f.taskName} onChange={(e) => set("taskName")(e.target.value)}
						placeholder="spooky-author-identification" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Data dir (GCS mount)</Label>
					<Input value={f.dataDir} onChange={(e) => set("dataDir")(e.target.value)} />
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label>Instruction</Label>
				<Textarea rows={4} value={f.instruction}
					onChange={(e) => set("instruction")(e.target.value)}
					placeholder="Task: predict the author… Optimize log loss. Produce submit.py." />
			</div>
			<div className="grid grid-cols-3 gap-4">
				<div className="flex flex-col gap-1.5">
					<Label>Candidate count</Label>
					<Input type="number" value={f.candidateCount}
						onChange={(e) => set("candidateCount")(e.target.value)} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Run budget (min)</Label>
					<Input type="number" value={f.runBudgetMinutes}
						onChange={(e) => set("runBudgetMinutes")(e.target.value)} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>Max budget (USD)</Label>
					<Input type="number" value={f.maxBudgetUsd}
						onChange={(e) => set("maxBudgetUsd")(e.target.value)} />
				</div>
			</div>
			<Button className="self-start" disabled={run.isPending || !f.taskName}
				onClick={() => run.mutate({ ...f, environmentId })}>
				{run.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Rocket className="mr-2 size-4" />}
				Start run
			</Button>
		</div>
	);
};
