import { Badge, Group, Text, Paper, Stack, Tooltip } from "@mantine/core";
import { useWebSocketState } from "~/contexts/WebSocketProvider";

export function AxiStatus() {
	const state = useWebSocketState();

	return (
		<Paper p="xs" withBorder>
			<Stack gap="xs">
				<Group justify="space-between" gap="xl">
					<Text size="sm" fw={700}>SERVER</Text>
					<Group gap={5}>
						{state.reconnectAttempts > 0 && !state.serverConnected && (
							<Badge size="xs" color="yellow" variant="outline">
								RETRIES: {state.reconnectAttempts}
							</Badge>
						)}
						{state.lastError && (
							<Tooltip label={state.lastError}>
								<Badge size="xs" color="red" variant="outline">ERROR</Badge>
							</Tooltip>
						)}
						<Badge color={state.serverConnected ? "green" : "red"} variant="filled">
							{state.serverConnected ? "CONNECTED" : "DISCONNECTED"}
						</Badge>
					</Group>
				</Group>
				<Group justify="space-between">
					<Text size="sm" fw={700}>AXIDRAW</Text>
					<Badge color={state.connected ? "green" : "red"} variant="filled">
						{state.connected ? (state.config ? "READY" : "CONNECTED") : "OFFLINE"}
					</Badge>
				</Group>
				<Group justify="space-between">
					<Text size="sm" fw={700}>PEN</Text>
					<Badge color={state.penDown ? "orange" : "gray"} variant="filled">
						{state.penDown ? "DOWN" : "UP"}
					</Badge>
				</Group>
			</Stack>
		</Paper>
	);
}
