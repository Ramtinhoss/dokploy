import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/utils/api";

// Cost/status come from the session row; CPU/memory come from the router's per-backend
// metrics (E2B has real stats; Daytona/Modal return status + a note, shown honestly).
const Stat = ({ label, value }: { label: string; value: string }) => (
	<Card>
		<CardHeader className="pb-1">
			<CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
		</CardHeader>
		<CardContent className="text-2xl font-medium tabular-nums">{value}</CardContent>
	</Card>
);

export const MonitoringTab = ({ sessionId }: { sessionId: string }) => {
	const { data: s } = api.computeSession.one.useQuery(
		{ sessionId },
		{ refetchInterval: 5000 },
	);
	const { data: m } = api.computeSession.metrics.useQuery(
		{ sessionId },
		{ refetchInterval: 5000 },
	);
	if (!s) return null;

	const mem =
		m?.memUsedMb != null
			? `${m.memUsedMb} / ${m.memLimitMb ?? "?"} MB`
			: "—";

	return (
		<div className="flex flex-col gap-3">
			<div className="grid grid-cols-2 gap-4 md:grid-cols-3">
				<Stat label="Status" value={s.status} />
				<Stat label="Cost / hour" value={`$${s.costEstimatePerHour.toFixed(3)}`} />
				<Stat label="Consumed" value={`$${(s.costConsumedUsd ?? 0).toFixed(3)}`} />
				<Stat
					label="Budget left"
					value={`$${Math.max(0, (s.maxBudgetUsd ?? 0) - (s.costConsumedUsd ?? 0)).toFixed(2)}`}
				/>
				<Stat label="CPU" value={m?.cpuPct != null ? `${m.cpuPct}%` : "—"} />
				<Stat label="Memory" value={mem} />
			</div>
			{m?.note && (
				<p className="text-xs text-muted-foreground">
					{m.source}: {m.note}
				</p>
			)}
		</div>
	);
};
