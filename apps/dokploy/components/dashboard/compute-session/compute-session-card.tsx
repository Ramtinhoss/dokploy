import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/utils/api";
import { Cpu, DollarSign, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

type Live = {
	status: string;
	costEstimatePerHour: number;
	costConsumedUsd: number;
	maxBudgetUsd: number;
};

// Cost visibility must never require opening a session. The static fields come from one
// query; the live cost/status are PUSHED over /compute-events (WS), and the card
// interpolates per second between the 2s pushes for a smooth ticker.
export const ComputeSessionCard = ({ sessionId }: { sessionId: string }) => {
	const { data: s } = api.computeSession.one.useQuery({ sessionId });
	const [live, setLive] = useState<Live | null>(null);
	const [consumed, setConsumed] = useState(0);

	useEffect(() => {
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(
			`${proto}//${window.location.host}/compute-events?sessionId=${sessionId}`,
		);
		ws.onmessage = (ev) => {
			const d = JSON.parse(ev.data) as Live;
			setLive(d);
			setConsumed(d.costConsumedUsd ?? 0);
		};
		return () => ws.readyState === WebSocket.OPEN && ws.close();
	}, [sessionId]);

	const perHour = live?.costEstimatePerHour ?? s?.costEstimatePerHour ?? 0;
	const status = live?.status ?? s?.status ?? "creating";
	useEffect(() => {
		if (status !== "running") return;
		const t = setInterval(() => setConsumed((c) => c + perHour / 3600), 1000);
		return () => clearInterval(t);
	}, [status, perHour]);

	if (!s) return null;
	const maxBudget = live?.maxBudgetUsd ?? s.maxBudgetUsd ?? 0;
	const remaining = Math.max(0, maxBudget - consumed);
	const pct = maxBudget ? Math.min(100, (consumed / maxBudget) * 100) : 0;

	return (
		<Card>
			<CardContent className="flex flex-wrap items-center gap-4 p-4">
				<div className="flex items-center gap-2">
					<span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status] ?? "bg-zinc-400"}`} />
					<Badge variant="outline" className={BACKEND_STYLE[s.backend] ?? ""}>
						{s.gpu ? <Zap className="mr-1 size-3" /> : <Cpu className="mr-1 size-3" />}
						{s.backend}
						{s.gpu ? ` · ${s.gpu}` : ""}
					</Badge>
					<span className="text-sm text-muted-foreground">{s.workloadType}</span>
				</div>

				<div className="flex items-center gap-1.5 text-sm">
					<DollarSign className="size-4 text-muted-foreground" />
					<span className="tabular-nums">{perHour.toFixed(3)}/hr</span>
				</div>

				<div className="ml-auto flex min-w-[220px] flex-col gap-1">
					<div className="flex justify-between text-xs text-muted-foreground">
						<span>budget</span>
						<span className="tabular-nums">
							${consumed.toFixed(3)} / ${maxBudget.toFixed(2)} · ${remaining.toFixed(2)} left
						</span>
					</div>
					<Progress value={pct} className={pct > 90 ? "[&>div]:bg-red-500" : ""} />
				</div>
			</CardContent>
		</Card>
	);
};
