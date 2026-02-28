/*
state here is:
angularVelocity: Object { x: -0.007192423877718495, y: -0.00917091251644824, z: 0.0051109190924227875 }​
config: Object { deadzone: 0.08, velocityCurve: "cubic", maxLinearSpeed: 200, … }​
connected: true​
lastError: null​
lastUpdate: 1772080061575​
messages: Array []​
nickname: null​
orientation: Object { w: 0.6143217086791992, x: 0.5020197629928589, y: -0.3856935501098633, … }​
penDown: false​
position: Object { x: 0, y: 4.13487631793227, z: 0 }​
reconnectAttempts: 0​
serverConnected: true​
velocity: Object { x: -1.7741209915305032e-45, y: 1.7741209915305032e-45, z: 0 }​
version: null

 */

import {
	Paper,
	Stack,
	Text,
	Group,
	Grid,
	Button,
	Divider,
	Switch,
	ActionIcon,
	Collapse,
} from "@mantine/core";
import {
	useWebSocket,
	useWebSocketState,
	useWebSocketActions,
} from "~/contexts/WebSocketProvider";
import { useGyroscope, useAccelerometer, useDeviceOrientation } from "~/hooks";
import { VersorComponent } from "./VersorComponent.tsx";
import { useState, useEffect, useRef } from "react";
import {
	Activity,
	Smartphone,
	Settings2,
	ChevronDown,
	ChevronUp,
	Unlock,
	Move,
} from "lucide-react";

export function SpatialStateDisplay() {
	const state = useWebSocketState();
	const { sendSpatial } = useWebSocketActions();
	const [syncActive, setSyncActive] = useState(false);
	const [showDetails, setShowDetails] = useState(true);

	const {
		rotationRate,
		orientation: localOrientation,
		isSupported: gyroSupported,
		permissionGranted: gyroPermission,
		requestPermission: requestGyroPermission,
	} = useGyroscope();

	const {
		acceleration,
		velocity: localVelocity,
		isSupported: accelSupported,
		permissionGranted: accelPermission,
		requestPermission: requestAccelPermission,
	} = useAccelerometer();

	// const { alpha, beta, gamma, unsupported } = useDeviceOrientation();
	const { alpha, beta, gamma, unsupported } = useDeviceOrientation();
	useEffect(() => {
		deviceOrientRef.current = { alpha, beta, gamma }; // alpha,beta,gamma,unsupported
	}, [alpha, beta, gamma]);

	// Use refs to store latest sensor data without triggering effect re-runs
	const velRef = useRef(localVelocity);
	const orientRef = useRef(localOrientation);
	const deviceOrientRef = useRef(alpha);

	useEffect(() => {
		velRef.current = localVelocity;
	}, [localVelocity]);

	useEffect(() => {
		orientRef.current = localOrientation;
	}, [localOrientation]);

	const handleRequestPermissions = async () => {
		const g = await requestGyroPermission();
		const a = await requestAccelPermission();
	};

	// Continuous sync when active - stable loop
	useEffect(() => {
		if (!syncActive) return;

		const interval = setInterval(() => {
			sendSpatial({
				velocity: {
					x: velRef.current.x * 20,
					y: -velRef.current.y * 20, // Invert Y to match screen
					z: 0,
				},
				orientation: {
					x: 0,
					y: 0,
					z: Math.sin((orientRef.current.alpha * Math.PI) / 360),
					w: Math.cos((orientRef.current.alpha * Math.PI) / 360),
				},
			});
		}, 50); // 20Hz update rate

		return () => clearInterval(interval);
	}, [syncActive, sendSpatial]);

	return (
		<Stack gap="xs" w="100%">
			<Paper p="sm" withBorder radius="md">
				<Group justify="space-between" mb="xs">
					<Group gap="xs">
						<Activity size={18} color="var(--mantine-color-blue-filled)" />
						<Text fw={700} size="sm">
							SPATIAL STATE
						</Text>
					</Group>
					<ActionIcon
						variant="subtle"
						size="sm"
						onClick={() => setShowDetails(!showDetails)}
					>
						{showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
					</ActionIcon>
				</Group>

				<Collapse in={showDetails}>
					<Grid mt="xs" gutter="xs">
						<Grid.Col span={4}>
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									Linear Velocity
								</Text>
								<VersorComponent velocity={state.velocity} />
							</Stack>
						</Grid.Col>
						<Grid.Col span={4}>
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									Angular Velocity
								</Text>
								<VersorComponent velocity={state.angularVelocity} />
							</Stack>
						</Grid.Col>
						<Grid.Col span={4}>
							<Stack gap={2}>
								<Text size="xs" c="dimmed">
									Spatial Orientation
								</Text>
								<VersorComponent velocity={state.orientation} min={0} max={1} />
							</Stack>
						</Grid.Col>
					</Grid>
				</Collapse>
			</Paper>

			<Paper
				p="sm"
				withBorder
				radius="md"
				bg={syncActive ? "rgba(78, 204, 163, 0.05)" : undefined}
			>
				<Group justify="space-between">
					<Group gap="xs">
						<Smartphone size={18} />
						<Text fw={700} size="sm">
							LOCAL SPATIAL SENSORS
						</Text>
					</Group>

					{!gyroPermission ? (
						<Button
							size="compact-xs"
							variant="outline"
							leftSection={<Unlock size={14} />}
							onClick={handleRequestPermissions}
						>
							Enable Sensors
						</Button>
					) : (
						<Switch
							label="Use to Control Axi"
							size="xs"
							checked={syncActive}
							onChange={(e) => {
								window.addEventListener("deviceorientation", console.log);
								return () => {
									window.removeEventListener("deviceorientation", console.log);
								};

								setSyncActive(e.currentTarget.checked);
							}}
							thumbIcon={syncActive ? <Move size={12} /> : undefined}
						/>
					)}
				</Group>

				{(true || gyroPermission) && (
					<Grid mt="xs" gutter="xs">
						<Grid.Col span={4}>
							<Paper p="xs" withBorder bg="var(--mantine-color-dark-8)">
								<Text size="xs" c="dimmed" fw={700}>
									LOCAL GYROSCOPE
								</Text>
								<Text size="xs" fontFamily="monospace">
									α: {deviceOrientRef?.current?.alpha?.toFixed(0)}° β:
									{deviceOrientRef?.current?.beta?.toFixed(0)}°
								</Text>
							</Paper>
						</Grid.Col>
						<Grid.Col span={4}>
							<Paper p="xs" withBorder bg="var(--mantine-color-dark-8)">
								<Text size="xs" c="dimmed" fw={700}>
									LOCAL ACCELOMETER
								</Text>
								<Text size="xs" fontFamily="monospace">
									{acceleration.x.toFixed(2)}, {acceleration.y.toFixed(2)},{" "}
									{acceleration.z.toFixed(2)}
								</Text>
							</Paper>
						</Grid.Col>
						<Grid.Col span={4}>
							<Paper p="xs" withBorder bg="var(--mantine-color-dark-8)">
								<Text size="xs" c="dimmed" fw={700}>
									LOCAL ORIENTATION
								</Text>
								<Text size="xs" fontFamily="monospace">
									{state.orientation.x.toFixed(2)},{" "}
									{state.orientation.y.toFixed(2)},{" "}
									{state.orientation.z.toFixed(2)},{" "}
									{state.orientation.z.toFixed(2)}
								</Text>
								<Text size="xs" fontFamily="monospace" className="d-none">
									α: {localOrientation.alpha.toFixed(0)}° β:
									{localOrientation.beta.toFixed(0)}°
								</Text>
							</Paper>
						</Grid.Col>
					</Grid>
				)}
			</Paper>
		</Stack>
	);
}
