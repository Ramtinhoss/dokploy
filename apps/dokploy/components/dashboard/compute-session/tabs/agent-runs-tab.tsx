import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";
import { Bot, FileText, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AibuildaiRunForm } from "../aibuildai-run-form";

const STATUS_VARIANT: Record<string, string> = {
	running: "bg-amber-500/15 text-amber-600",
	succeeded: "bg-emerald-500/15 text-emerald-600",
	failed: "bg-red-500/15 text-red-600",
};

// Agent runs: launch headless Claude Code / Codex (persisted as agent_run rows) or an
// AIBuildAI run. The router runs the agent async and streams output; the launched run
// is tailed live over /compute-agent-stream. Past runs list below with status + artifacts.
export const AgentRunsTab = ({
	sessionId,
	environmentId,
}: {
	sessionId: string;
	environmentId: string;
}) => {
	const [tool, setTool] = useState<"claude" | "codex">("claude");
	const [task, setTask] = useState("");
	const [liveRunId, setLiveRunId] = useState<string | null>(null);
	const [liveOutput, setLiveOutput] = useState("");
	const outputRef = useRef<HTMLPreElement>(null);
	const utils = api.useUtils();

	const { data: runs } = api.computeSession.agentRuns.useQuery(
		{ sessionId },
		{ refetchInterval: 4000 },
	);
	const launch = api.computeSession.launchAgent.useMutation({
		onSuccess: (row: any) => {
			toast.success("Agent run started");
			setTask("");
			setLiveOutput("");
			setLiveRunId(row.agentRunId);
		},
		onError: (e) => toast.error(e.message),
	});

	// Tail the live run over the browser websocket -> /compute-agent-stream proxy.
	useEffect(() => {
		if (!liveRunId) return;
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(
			`${proto}//${window.location.host}/compute-agent-stream?agentRunId=${liveRunId}`,
		);
		ws.onmessage = (ev) => {
			setLiveOutput((o) => `${o}${ev.data}\n`);
			outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
		};
		ws.onclose = () => {
			void utils.computeSession.agentRuns.invalidate({ sessionId });
			setLiveRunId(null);
		};
		return () => ws.readyState === WebSocket.OPEN && ws.close();
	}, [liveRunId, sessionId, utils]);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-3 rounded-lg border p-4">
				<div className="flex items-center gap-2 text-sm font-medium">
					<Bot className="size-4" /> Interactive coding agent
				</div>
				<div className="flex gap-2">
					<Select value={tool} onValueChange={(v) => setTool(v as "claude" | "codex")}>
						<SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
						<SelectContent>
							<SelectItem value="claude">Claude Code</SelectItem>
							<SelectItem value="codex">Codex</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<Textarea
					rows={3}
					placeholder="Describe the task for the agent…"
					value={task}
					onChange={(e) => setTask(e.target.value)}
				/>
				<Button
					className="self-start"
					disabled={launch.isPending || !task}
					onClick={() => launch.mutate({ sessionId, agentType: tool, task })}
				>
					{launch.isPending ? (
						<Loader2 className="mr-2 size-4 animate-spin" />
					) : (
						<Play className="mr-2 size-4" />
					)}
					Run headless
				</Button>
				{liveRunId && (
					<div className="flex flex-col gap-1">
						<span className="flex items-center gap-1.5 text-xs text-amber-600">
							<Loader2 className="size-3 animate-spin" /> live output
						</span>
						<pre
							ref={outputRef}
							className="max-h-56 overflow-auto rounded-md bg-black/90 p-2 text-xs text-emerald-300"
						>
							{liveOutput || "…"}
						</pre>
					</div>
				)}
			</div>

			{runs && runs.length > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">Runs</span>
					{runs.map((r: any) => (
						<div key={r.agentRunId} className="rounded-lg border p-3">
							<div className="flex items-center gap-2">
								<span className="text-sm font-medium">{r.agentType}</span>
								<Badge variant="outline" className={STATUS_VARIANT[r.status] ?? ""}>
									{r.status}
								</Badge>
								{r.exitCode != null && (
									<span className="text-xs text-muted-foreground">exit {r.exitCode}</span>
								)}
								<span className="ml-auto text-xs text-muted-foreground">{r.startedAt}</span>
							</div>
							{r.output && (
								<pre className="mt-2 max-h-48 overflow-auto rounded-md bg-black/90 p-2 text-xs text-emerald-300">
									{r.output}
								</pre>
							)}
							{Array.isArray(r.artifacts) && r.artifacts.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-2">
									{r.artifacts.map((a: { name: string; path: string }) => (
										<Badge key={a.name} variant="outline" className="gap-1">
											<FileText className="size-3" />
											{a.name}
										</Badge>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			<Separator />

			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2 text-sm font-medium">
					<FileText className="size-4" /> AIBuildAI run (gpu-batch → Modal)
				</div>
				<AibuildaiRunForm environmentId={environmentId} />
				<p className="text-xs text-muted-foreground">
					On completion, links to progress.pdf and submit.py (synced to GCS) appear in the run above.
				</p>
			</div>
		</div>
	);
};
