import { Paper, Stack, Text, Group, Grid, Badge, Progress, Button } from "@mantine/core";
import { useWebSocket, useWebSocketState } from "~/contexts/WebSocketProvider";
import { Cpu, Zap, Activity, Database, Power } from "lucide-react";

export function SerialStateDisplay() {
	const { state, emit } = useWebSocket();
	const serial = state.serialState;

	if (!serial) {
		return (
			<Paper p="sm" withBorder radius="md">
				<Group justify="space-between">
					<Group gap="xs">
						<Cpu size={18} color="gray" />
						<Text fw={700} size="sm" c="dimmed">SERIAL STATE (WAITING...)</Text>
					</Group>
					<Button size="compact-xs" variant="outline" onClick={() => emit("motors_on")}>Engage Motors</Button>
				</Group>
			</Paper>
		);
	}

	const { steps, power, hardware, utility } = serial;

	return (
		<Paper p="sm" withBorder radius="md">
			<Stack gap="xs">
				<Group justify="space-between">
					<Group gap="xs">
						<Cpu size={18} color="var(--mantine-color-orange-filled)" />
						<Text fw={700} size="sm">SERIAL STATE</Text>
					</Group>
					<Group gap="xs">
						<Button 
							size="compact-xs" 
							variant="light" 
							color="green" 
							leftSection={<Power size={12} />}
							onClick={() => emit("motors_on")}
						>
							Motors On
						</Button>
						<Button 
							size="compact-xs" 
							variant="light" 
							color="red" 
							leftSection={<Power size={12} />}
							onClick={() => emit("motors_off")}
						>
							Motors Off
						</Button>
						<Badge size="xs" color={hardware?.commandExecuting ? "orange" : "blue"}>
							{hardware?.commandExecuting ? "EXECUTING" : "IDLE"}
						</Badge>
					</Group>
				</Group>

				<Grid gutter="xs">
					<Grid.Col span={{ base: 6, md: 3 }}>
						<Stack gap={2}>
							<Text size="10px" c="dimmed" fw={700}>STEP POSITIONS</Text>
							<Text size="xs" fontFamily="monospace">M1: {steps?.motor1}</Text>
							<Text size="xs" fontFamily="monospace">M2: {steps?.motor2}</Text>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 6, md: 3 }}>
						<Stack gap={2}>
							<Text size="10px" c="dimmed" fw={700}>POWER</Text>
							<Group gap={4}>
								<Zap size={12} color={power?.voltageLow ? "red" : "yellow"} />
								<Text size="xs" fontFamily="monospace">{(power?.voltage / 10).toFixed(1)}V</Text>
							</Group>
							<Text size="xs" c="dimmed" style={{ fontSize: '9px' }}>Current: {power?.current}</Text>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 6, md: 3 }}>
						<Stack gap={2}>
							<Text size="10px" c="dimmed" fw={700}>HARDWARE BITS</Text>
							<Group gap={4} wrap="wrap">
								<Badge variant="dot" size="10px" color={hardware?.penUp ? "blue" : "red"}>PEN {hardware?.penUp ? "UP" : "DOWN"}</Badge>
								<Badge variant="dot" size="10px" color={hardware?.fifoEmpty ? "gray" : "orange"}>FIFO {hardware?.fifoEmpty ? "EMPTY" : "BUSY"}</Badge>
								<Badge variant="dot" size="10px" color={hardware?.motor1Moving ? "green" : "gray"}>M1 {hardware?.motor1Moving ? "MOVE" : "IDLE"}</Badge>
								<Badge variant="dot" size="10px" color={hardware?.motor2Moving ? "green" : "gray"}>M2 {hardware?.motor2Moving ? "MOVE" : "IDLE"}</Badge>
							</Group>
						</Stack>
					</Grid.Col>

					<Grid.Col span={{ base: 6, md: 3 }}>
						<Stack gap={2}>
							<Text size="10px" c="dimmed" fw={700}>FIFO UTILITY</Text>
							{utility?.fifoMax ? (
								<>
									<Text size="xs" fontFamily="monospace">{utility.fifoCount} / {utility.fifoMax}</Text>
									<Progress 
										value={(parseInt(utility.fifoCount) / parseInt(utility.fifoMax)) * 100} 
										size="xs" 
										color="orange" 
									/>
								</>
							) : (
								<Text size="xs" c="dimmed">Legacy Firmware</Text>
							)}
						</Stack>
					</Grid.Col>
				</Grid>
			</Stack>
		</Paper>
	);
}
