import {
	Paper,
	Text,
	Stack,
	Group,
	Badge,
	ScrollArea,
	Button,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useWebSocket } from "~/contexts/WebSocketProvider";
import { Trash2 } from "lucide-react";

export function AxiQueue() {
	const { state } = useWebSocket();
	const [queue, setQueue] = useState({ jobs: [], status: { pendingCount: 0 } });

	useEffect(() => {
		const fetchQueue = async () => {
			if (!state.serverConnected) return;
			try {
				const savedHost =
					localStorage.getItem("axiApiHost") || window.location.origin;
				const res = await fetch(`${savedHost}/queue`);
				const data = await res.json();
				setQueue(data);
			} catch (e) {
				// silent error
			}
		};

		if (state.serverConnected) {
			fetchQueue();
		}
	}, [state.serverConnected]);

	// Listen for queue_update messages
	useEffect(() => {
		const lastMessage = state.messages[state.messages.length - 1];
		if (lastMessage?.type === "queue_update") {
			setQueue({ jobs: lastMessage.jobs, status: lastMessage.status });
		}
	}, [state.messages]);

	const clearQueue = async () => {
		const savedHost =
			localStorage.getItem("axiApiHost") || window.location.origin;
		await fetch(`${savedHost}/queue/clear`, { method: "POST" });
	};

	const acceptJob = async (id: string) => {
		const savedHost =
			localStorage.getItem("axiApiHost") || window.location.origin;
		await fetch(`${savedHost}/queue/${id}/accept`, { method: "POST" });
	};

	const removeJob = async (id: string) => {
		const savedHost =
			localStorage.getItem("axiApiHost") || window.location.origin;
		await fetch(`${savedHost}/queue/${id}`, { method: "DELETE" });
	};

	return (
		<Paper p="md" withBorder h="100%">
			<Group justify="space-between" mb="xs">
				<Text fw={700} size="sm" c="dimmed">
					QUEUE ({queue.status?.pendingCount || 0})
				</Text>
				<Button
					size="compact-xs"
					variant="subtle"
					color="red"
					onClick={clearQueue}
				>
					Clear
				</Button>
			</Group>
			<ScrollArea h={220}>
				<Stack gap="xs">
					{queue.jobs.length === 0 ? (
						<Text size="xs" c="dimmed" ta="center" py="xl">
							No jobs in queue
						</Text>
					) : (
						queue.jobs.map((job: any, i) => (
							<Paper key={job.id || i} p="xs" withBorder>
								<Stack gap={4}>
									<Group justify="space-between" wrap="nowrap">
										<div style={{ overflow: "hidden" }}>
											<Text size="xs" fw={700} truncate="end">
												{job.name || "Untitled"}
											</Text>
											<Text size="10px" c="dimmed">
												{job.state === "running" ? `${job.progress || 0}% complete` : job.state}
											</Text>
										</div>
										<Badge
											size="xs"
											color={
												job.state === "running" 
													? "green" 
													: job.state === "planned" 
														? "yellow" 
														: "gray"
											}
										>
											{job.state}
										</Badge>
									</Group>
									
									{job.state === "planned" && (
										<Group gap="xs" mt={4}>
											<Button 
												size="compact-xs" 
												variant="filled" 
												color="green" 
												onClick={() => acceptJob(job.id)}
												fullWidth
											>
												PLOT
											</Button>
											<Button 
												size="compact-xs" 
												variant="outline" 
												color="red" 
												onClick={() => removeJob(job.id)}
											>
												<Trash2 size={12} />
											</Button>
										</Group>
									)}
								</Stack>
							</Paper>
						))
					)}
				</Stack>
			</ScrollArea>
		</Paper>
	);
}

