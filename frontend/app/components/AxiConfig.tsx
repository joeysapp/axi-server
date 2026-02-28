import {
	Stack,
	Slider,
	Text,
	TextInput,
	Button,
	Paper,
	Group,
	Divider,
	Tooltip,
	ActionIcon,
	Collapse,
	Grid,
} from "@mantine/core";
import { useState, useEffect } from "react";
import { useWebSocket } from "~/contexts/WebSocketProvider";
import {
	Settings,
	Save,
	Globe,
	Info,
	ChevronDown,
	ChevronUp,
} from "lucide-react";

export function AxiConfig() {
	const { state } = useWebSocket();
	const [apiHost, setApiHost] = useState("");
	const [showHost, setShowHost] = useState(false);

	// Pen settings
	const [penDownSpeed, setPenDownSpeed] = useState(0.25);
	const [penUpSpeed, setPenUpSpeed] = useState(0.5);
	const [posUp, setPosUp] = useState(60);
	const [posDown, setPosDown] = useState(30);
	const [rateRaise, setRateRaise] = useState(75);
	const [rateLower, setRateLower] = useState(50);

	useEffect(() => {
		const saved = localStorage.getItem("axiApiHost");
		if (saved) setApiHost(saved);
		else if (typeof window !== "undefined") setApiHost(window.location.origin);

		if (state.config) {
			// Update local state from server config if available
			// (This would need server to return more config props)
		}
	}, [state.config]);

	const saveHost = () => {
		localStorage.setItem("axiApiHost", apiHost);
		window.location.reload();
	};

	const updateSettings = async () => {
		try {
			const savedHost =
				localStorage.getItem("axiApiHost") || window.location.origin;
			await fetch(`${savedHost}/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					penDownSpeed,
					penUpSpeed,
					posUp,
					posDown,
					rateRaise,
					rateLower,
				}),
			});
		} catch (e) {
			console.error("Failed to update settings", e);
		}
	};

	return (
		<Paper p="sm" withBorder radius="md">
			<Stack gap="xs">
				<Group justify="space-between">
					<Group gap="xs">
						<Settings size={18} />
						<Text fw={700} size="sm">
							HARDWARE CONFIG
						</Text>
					</Group>
					<Button
						variant="subtle"
						size="compact-xs"
						leftSection={<Save size={14} />}
						onClick={updateSettings}
					>
						Apply
					</Button>
				</Group>

				<Divider variant="dashed" />

				<div>
					<Group justify="space-between">
						<Text size="xs" fw={700}>
							Pen Down Speed:{" "}
							<Text span c="blue" inherit>
								{penDownSpeed}
							</Text>{" "}
							in/s
						</Text>
						<Tooltip label="Speed when pen is touching surface">
							<Info size={12} color="gray" />
						</Tooltip>
					</Group>
					<Slider
						min={0}
						max={1}
						step={0.01}
						value={penDownSpeed}
						onChange={setPenDownSpeed}
						onChangeEnd={updateSettings}
						size="sm"
					/>
				</div>

				<div>
					<Group justify="space-between">
						<Text size="xs" fw={700}>
							Pen Up Speed:{" "}
							<Text span c="blue" inherit>
								{penUpSpeed}
							</Text>{" "}
							in/s
						</Text>
						<Tooltip label="Travel speed between paths">
							<Info size={12} color="gray" />
						</Tooltip>
					</Group>
					<Slider
						min={0}
						max={2}
						step={0.01}
						value={penUpSpeed}
						onChange={setPenUpSpeed}
						onChangeEnd={updateSettings}
						size="sm"
					/>
				</div>

				<Divider label="Pen Height" labelPosition="center" variant="dashed" />

				<Grid gutter="md">
					<Grid.Col span={6}>
						<Text size="xs" fw={700}>
							Height UP: {posUp}%
						</Text>
						<Slider
							value={posUp}
							onChange={setPosUp}
							onChangeEnd={updateSettings}
							min={0}
							max={100}
							size="xs"
						/>
					</Grid.Col>
					<Grid.Col span={6}>
						<Text size="xs" fw={700}>
							Height DOWN: {posDown}%
						</Text>
						<Slider
							value={posDown}
							onChange={setPosDown}
							onChangeEnd={updateSettings}
							min={0}
							max={100}
							size="xs"
						/>
					</Grid.Col>
				</Grid>

				<Divider variant="dashed" />

				<Group justify="space-between">
					<Button
						variant="subtle"
						size="compact-xs"
						leftSection={<Globe size={14} />}
						onClick={() => setShowHost(!showHost)}
						rightSection={
							showHost ? <ChevronUp size={14} /> : <ChevronDown size={14} />
						}
					>
						Connection Details
					</Button>
				</Group>

				<Collapse in={showHost}>
					<Paper p="xs" withBorder bg="var(--mantine-color-dark-8)">
						<Stack gap="xs">
							<TextInput
								label="API Host"
								size="xs"
								placeholder="http://localhost:9700"
								value={apiHost}
								onChange={(e) => setApiHost(e.currentTarget.value)}
							/>
							<Button size="xs" variant="outline" fullWidth onClick={saveHost}>
								Update & Reload
							</Button>
						</Stack>
					</Paper>
				</Collapse>
			</Stack>
		</Paper>
	);
}
