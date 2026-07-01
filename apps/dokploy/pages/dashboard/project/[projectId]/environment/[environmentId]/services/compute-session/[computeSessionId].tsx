import { ResearchWorkspace } from "@/components/dashboard/compute-session/research-workspace";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { useRouter } from "next/router";
import type { ReactElement } from "react";

// Route: /dashboard/project/[projectId]/environment/[environmentId]/services/compute-session/[computeSessionId]
// Mirrors the application service page; renders the 4-tab Research Workspace.
const ComputeSessionPage = () => {
	const { query } = useRouter();
	const sessionId = query.computeSessionId as string | undefined;
	if (!sessionId) return null;
	return (
		<div className="w-full p-4">
			<ResearchWorkspace sessionId={sessionId} />
		</div>
	);
};

ComputeSessionPage.getLayout = (page: ReactElement) => (
	<DashboardLayout>{page}</DashboardLayout>
);

export default ComputeSessionPage;
