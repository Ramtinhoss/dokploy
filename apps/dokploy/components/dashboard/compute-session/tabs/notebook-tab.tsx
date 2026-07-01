import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { BookOpen, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// Notebook tab: launches SERVER-MODE Marimo (a real Python kernel) inside the session's
// persistent Daytona sandbox and iframes it through Traefik. Never WASM — the router
// refuses non-persistent backends, so this tab is only meaningful for interactive sessions.
export const NotebookTab = ({
	sessionId,
	backend,
}: {
	sessionId: string;
	backend: string;
}) => {
	const [url, setUrl] = useState<string | null>(null);
	const launch = api.computeSession.notebook.useMutation({
		onSuccess: (r: any) => setUrl(r.notebook_url),
		onError: (e) => toast.error(e.message),
	});

	if (backend !== "daytona") {
		return (
			<div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
				<TriangleAlert className="size-4 text-amber-600" />
				The reactive Marimo kernel runs server-side and needs a persistent workspace, so
				the notebook is available only on interactive (Daytona) sessions — not {backend}.
			</div>
		);
	}

	if (!url) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-lg border p-10 text-center">
				<BookOpen className="size-8 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">
					Start a live Marimo kernel (server mode) in this workspace.
				</p>
				<Button onClick={() => launch.mutate({ sessionId })} disabled={launch.isPending}>
					{launch.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
					Launch notebook
				</Button>
			</div>
		);
	}

	return (
		<iframe
			title="marimo notebook"
			src={url}
			className="h-[72vh] w-full rounded-lg border"
			allow="clipboard-read; clipboard-write"
		/>
	);
};
