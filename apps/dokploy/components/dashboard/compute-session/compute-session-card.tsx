import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/utils/api";
import { Cpu, DollarSign, Zap } from "lucide-react";
import { useEffect, useState } from "react";

const BACKEND_STYLE: Record<string, string> = {
	daytona: "bg-teal-500/15 text-teal-600 border-teal-500/30",
	e2b: "bg-amber-500/15 text-amber-600 border-amber-500/30",
	modal: "bg-purple-500/15 text-purple-600 border-purple-500/30",
	local: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30",
};

const STATUS_DOT: Record<string, string> = {
	running: "bg-emerald-500",
	creating: "bg-amber-500 animate-pulse",
	stopped: "bg-zinc-400",
	expired: "bg-zinc-400",
	error: "bg-red-500",
};

// Cost visibility must never require opening a session (a hard requirement). The card
// polls the authoritative row every 5s and interpolates per-second between polls for a
// smooth ticker. Production swaps the poll for the heartbeat's WS push (wss/compute-events).
export const ComputeSessionCard = ({ sessionId }: { sessionId: string }) => {
	const { data: s } = api.computeSession.one.useQuery(
		{ sessionId },
		{ refetchInterval: 5000 },
	);
	const [consumed, setConsumed] = useState(0);

	useEffect(() => {
		if (!s) return;
		setConsumed(s.costConsumedUsd ?? 0);
		if (s.status !== "running") return;
		const perSec = (s.costEstimatePerHour ?? 0) / 3600;
		const t = setInterval(() => setConsumed((c) => c + perSec), 1000);
		return () => clearInterval(t);
	}, [s?.costConsumedUsd, s?.status, s?.costEstimatePerHour]);

	if (!s) return null;
	const remaining = Math.max(0, (s.maxBudgetUsd ?? 0) - consumed);
	const pct = s.maxBudgetUsd ? Math.min(100, (consumed / s.maxBudgetUsd) * 100) : 0;

	return (
		<Card>
			<CardContent className="flex flex-wrap items-center gap-4 p-4">
				<div className="flex items-center gap-2">
					<span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s.status] ?? "bg-zinc-400"}`} />
					<Badge variant="outline" className={BACKEND_STYLE[s.backend] ?? ""}>
						{s.gpu ? <Zap className="mr-1 size-3" /> : <Cpu className="mr-1 size-3" />}
						{s.backend}
						{s.gpu ? ` · ${s.gpu}` : ""}
					</Badge>
					<span className="text-sm text-muted-foreground">{s.workloadType}</span>
				</div>

				<div className="flex items-center gap-1.5 text-sm">
					<DollarSign className="size-4 text-muted-foreground" />
					<span className="tabular-nums">{s.costEstimatePerHour.toFixed(3)}/hr</span>
				</div>

				<div className="ml-auto flex min-w-[220px] flex-col gap-1">
					<div className="flex justify-between text-xs text-muted-foreground">
						<span>budget</span>
						<span className="tabular-nums">
							${consumed.toFixed(3)} / ${s.maxBudgetUsd?.toFixed(2)} · ${remaining.toFixed(2)} left
						</span>
					</div>
					<Progress value={pct} className={pct > 90 ? "[&>div]:bg-red-500" : ""} />
				</div>
			</CardContent>
		</Card>
	);
};
