import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Cpu } from "lucide-react";
import { useRouter } from "next/router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

const schema = z.object({
	workloadType: z
		.enum(["interactive", "untrusted-exec", "gpu-batch"])
		.default("interactive"),
	backend: z.enum(["auto", "daytona", "e2b", "modal"]).default("auto"),
	cpu: z.coerce.number().min(1).default(2),
	memoryGb: z.coerce.number().min(1).default(4),
	diskGb: z.coerce.number().min(1).default(10),
	maxBudgetUsd: z.coerce.number().positive().default(5),
	gpu: z.enum(["none", "T4", "L4", "A10G", "A100", "H100"]).default("none"),
});
type Schema = z.infer<typeof schema>;

// "Compute Session" entry for the project's Create Service menu. Interactive → Daytona
// (persistent, Marimo), untrusted-exec → E2B, gpu-batch → Modal; leave backend on "auto"
// to let the router decide. On create, navigate straight into the 4-tab Research Workspace.
export const AddComputeSession = ({ environmentId }: { environmentId: string }) => {
	const [visible, setVisible] = useState(false);
	const router = useRouter();
	const projectId = router.query.projectId as string;
	const utils = api.useUtils();
	const { mutateAsync, isLoading } = api.computeSession.create.useMutation();

	const form = useForm<Schema>({
		resolver: zodResolver(schema),
		defaultValues: {
			workloadType: "interactive",
			backend: "auto",
			cpu: 2,
			memoryGb: 4,
			diskGb: 10,
			maxBudgetUsd: 5,
			gpu: "none",
		},
	});
	const workloadType = form.watch("workloadType");

	const onSubmit = async (data: Schema) => {
		await mutateAsync({
			requestId: crypto.randomUUID(),
			environmentId,
			workloadType: data.workloadType,
			backend: data.backend === "auto" ? undefined : data.backend,
			cpu: data.cpu,
			memoryGb: data.memoryGb,
			diskGb: data.diskGb,
			maxBudgetUsd: data.maxBudgetUsd,
			gpu:
				data.workloadType === "gpu-batch" && data.gpu !== "none"
					? data.gpu
					: undefined,
			timeoutSeconds: 3600,
		})
			.then(async (created: any) => {
				toast.success("Compute session created");
				setVisible(false);
				await utils.environment.one.invalidate({ environmentId });
				router.push(
					`/dashboard/project/${projectId}/environment/${environmentId}/services/compute-session/${created.sessionId}`,
				);
			})
			.catch(() => toast.error("Error creating compute session"));
	};

	return (
		<Dialog open={visible} onOpenChange={setVisible}>
			<DialogTrigger className="w-full">
				<DropdownMenuItem
					className="w-full cursor-pointer space-x-3"
					onSelect={(e) => e.preventDefault()}
				>
					<Cpu className="size-4 text-muted-foreground" />
					<span>Compute Session</span>
				</DropdownMenuItem>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New compute session</DialogTitle>
				</DialogHeader>

				<Form {...form}>
					<form
						id="add-compute-session"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-5"
					>
						<FormField
							control={form.control}
							name="workloadType"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Workload</FormLabel>
									<Select onValueChange={field.onChange} value={field.value}>
										<FormControl>
											<SelectTrigger><SelectValue /></SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="interactive">Interactive — notebook + terminal</SelectItem>
											<SelectItem value="untrusted-exec">Untrusted exec — isolated</SelectItem>
											<SelectItem value="gpu-batch">GPU batch — training / AIBuildAI</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										Routing is automatic: interactive → Daytona, untrusted → E2B, gpu-batch → Modal.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="backend"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Backend</FormLabel>
									<Select onValueChange={field.onChange} value={field.value}>
										<FormControl>
											<SelectTrigger><SelectValue /></SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="auto">Auto (recommended)</SelectItem>
											<SelectItem value="daytona">Daytona</SelectItem>
											<SelectItem value="e2b">E2B</SelectItem>
											<SelectItem value="modal">Modal</SelectItem>
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="grid grid-cols-3 gap-3">
							{(["cpu", "memoryGb", "diskGb"] as const).map((n) => (
								<FormField
									key={n}
									control={form.control}
									name={n}
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{n === "cpu" ? "vCPU" : n === "memoryGb" ? "RAM (GB)" : "Disk (GB)"}
											</FormLabel>
											<FormControl>
												<Input type="number" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							))}
						</div>

						<div className="grid grid-cols-2 gap-3">
							<FormField
								control={form.control}
								name="maxBudgetUsd"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Max budget (USD)</FormLabel>
										<FormControl>
											<Input type="number" step="0.5" {...field} />
										</FormControl>
										<FormDescription>Hard ceiling — the session is killed on breach.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
							{workloadType === "gpu-batch" && (
								<FormField
									control={form.control}
									name="gpu"
									render={({ field }) => (
										<FormItem>
											<FormLabel>GPU</FormLabel>
											<Select onValueChange={field.onChange} value={field.value}>
												<FormControl>
													<SelectTrigger><SelectValue /></SelectTrigger>
												</FormControl>
												<SelectContent>
													{["none", "T4", "L4", "A10G", "A100", "H100"].map((g) => (
														<SelectItem key={g} value={g}>{g}</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}
						</div>

						<DialogFooter>
							<Button type="submit" isLoading={isLoading} form="add-compute-session">
								Create
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
};
