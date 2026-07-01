import { AttachAddon } from "@xterm/addon-attach";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { FitAddon } from "xterm-addon-fit";

// Mirrors docker-terminal.tsx, but points at /compute-terminal (which the Dokploy wss
// proxies to the compute-router's streaming terminal WS -> a persistent tmux shell in the
// session's sandbox, the SAME sandbox that hosts the server-mode Marimo kernel).
export const TerminalTab = ({ sessionId }: { sessionId: string }) => {
	const termRef = useRef<HTMLDivElement>(null);
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		if (!termRef.current) return;
		termRef.current.innerHTML = "";
		const term = new Terminal({
			cursorBlink: true,
			lineHeight: 1.4,
			convertEol: true,
			theme: {
				cursor: resolvedTheme === "light" ? "#000000" : "transparent",
				background: "rgba(0, 0, 0, 0)",
				foreground: "currentColor",
			},
		});
		const fit = new FitAddon();
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(
			`${protocol}//${window.location.host}/compute-terminal?sessionId=${sessionId}`,
		);
		term.open(termRef.current);
		term.loadAddon(fit);
		term.loadAddon(new AttachAddon(ws));
		fit.fit();
		const onResize = () => fit.fit();
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			ws.readyState === WebSocket.OPEN && ws.close();
			term.dispose();
		};
	}, [sessionId, resolvedTheme]);

	return (
		<div className="rounded-lg border bg-black/90 p-3">
			<div ref={termRef} className="h-[60vh] w-full" />
		</div>
	);
};
