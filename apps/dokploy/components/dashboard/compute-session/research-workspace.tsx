import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/utils/api";
import { Activity, Bot, BookOpen, TerminalSquare } from "lucide-react";
import { ComputeSessionCard } from "./compute-session-card";
import { AgentRunsTab } from "./tabs/agent-runs-tab";
import { MonitoringTab } from "./tabs/monitoring-tab";
import { NotebookTab } from "./tabs/notebook-tab";
import { TerminalTab } from "./tabs/terminal-tab";

// The Research Workspace: one place per Compute Session to get a terminal + notebook on a
// persistent remote workspace, launch AI agents, and watch cost/metrics — with the session
// card (backend badge + live cost ticker + remaining budget) always visible above.
export const ResearchWorkspace = ({ sessionId }: { sessionId: string }) => {
	const { data: s } = api.computeSession.one.useQuery({ sessionId });

	return (
		<div className="flex flex-col gap-4">
			<ComputeSessionCard sessionId={sessionId} />

			<Tabs defaultValue="terminal">
				<TabsList>
					<TabsTrigger value="terminal" className="gap-1.5">
						<TerminalSquare className="size-4" /> Terminal
					</TabsTrigger>
					<TabsTrigger value="notebook" className="gap-1.5">
						<BookOpen className="size-4" /> Notebook
					</TabsTrigger>
					<TabsTrigger value="agents" className="gap-1.5">
						<Bot className="size-4" /> Agent runs
					</TabsTrigger>
					<TabsTrigger value="monitoring" className="gap-1.5">
						<Activity className="size-4" /> Monitoring
					</TabsTrigger>
				</TabsList>

				<TabsContent value="terminal" className="mt-4">
					<TerminalTab sessionId={sessionId} />
				</TabsContent>
				<TabsContent value="notebook" className="mt-4">
					<NotebookTab sessionId={sessionId} backend={s?.backend ?? ""} />
				</TabsContent>
				<TabsContent value="agents" className="mt-4">
					<AgentRunsTab sessionId={sessionId} environmentId={s?.environmentId ?? ""} />
				</TabsContent>
				<TabsContent value="monitoring" className="mt-4">
					<MonitoringTab sessionId={sessionId} />
				</TabsContent>
			</Tabs>
		</div>
	);
};
