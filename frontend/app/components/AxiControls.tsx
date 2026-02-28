import { Button, Group, Stack, Grid, ActionIcon, Menu, Divider, Tooltip, Paper, Text, Slider } from "@mantine/core";
import { useWebSocket, useWebSocketState, useWebSocketActions } from "~/contexts/WebSocketProvider";
import { useState } from "react";
import { 
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, 
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  PenTool, Home, ShieldAlert, Settings, RefreshCw,
  ChevronUp, ChevronDown, Download, Trash2, Power
} from "lucide-react";

export function AxiControls() {
	const state = useWebSocketState();
	const { emit, penToggle, penUp, penDown, penSync, home, stop, sendSpatial } = useWebSocketActions();
	const [stepSize, setStepSize] = useState(5);

	const handleMove = (dx: number, dy: number) => {
		const speed = (stepSize / 50) * 200;
		sendSpatial({
			velocity: { x: dx * speed, y: dy * speed, z: 0 }
		});
	};

	const stopMove = () => {
		sendSpatial({
			velocity: { x: 0, y: 0, z: 0 }
		});
	};

	const clearPath = async () => {
		const savedHost = localStorage.getItem("axiApiHost") || (import.meta as any).env?.VITE_AXI_API_HOST || window.location.origin;
		await fetch(`${savedHost}/path/clear`, { method: "POST" });
	};

	const downloadSVG = async () => {
		const savedHost = localStorage.getItem("axiApiHost") || (import.meta as any).env?.VITE_AXI_API_HOST || window.location.origin;
		const res = await fetch(`${savedHost}/path`);
		const data = await res.json();
		if (data.svg) {
			const blob = new Blob([data.svg], { type: "image/svg+xml" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "axidraw-path.svg";
			a.click();
			URL.revokeObjectURL(url);
		}
	};

	return (
		<Stack gap="md">
			<Paper withBorder p="xs" radius="md" bg="var(--mantine-color-dark-8)">
				<Grid gutter="xs" justify="center" align="center">
					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(-1, -1)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowUpLeft size={18} />
						</ActionIcon>
					</Grid.Col>
					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(0, -1)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowUp size={18} />
						</ActionIcon>
					</Grid.Col>
					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(1, -1)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowUpRight size={18} />
						</ActionIcon>
					</Grid.Col>

					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(-1, 0)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowLeft size={18} />
						</ActionIcon>
					</Grid.Col>
					<Grid.Col span={4}>
						<Stack gap={2} align="center">
							<ActionIcon 
                variant="filled" 
                color={state.penDown ? "red" : "blue"} 
                size="xl" 
                onClick={penToggle}
                loading={state.state === 'busy'}
              >
								<PenTool size={20} />
							</ActionIcon>
						</Stack>
					</Grid.Col>
					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(1, 0)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowRight size={18} />
						</ActionIcon>
					</Grid.Col>

					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(-1, 1)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowDownLeft size={18} />
						</ActionIcon>
					</Grid.Col>
					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(0, 1)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowDown size={18} />
						</ActionIcon>
					</Grid.Col>
					<Grid.Col span={4}>
						<ActionIcon variant="light" size="lg" onPointerDown={() => handleMove(1, 1)} onPointerUp={stopMove} onPointerLeave={stopMove}>
							<ArrowDownRight size={18} />
						</ActionIcon>
					</Grid.Col>
				</Grid>
			</Paper>

			<Group justify="center" grow gap="xs">
				<Stack gap={4}>
					<Group gap={4} grow>
						<Tooltip label="Raise Pen">
							<ActionIcon variant="outline" onClick={penUp} color="blue">
								<ChevronUp size={16} />
							</ActionIcon>
						</Tooltip>
						<Tooltip label="Lower Pen">
							<ActionIcon variant="outline" onClick={penDown} color="red">
								<ChevronDown size={16} />
							</ActionIcon>
						</Tooltip>
						<Tooltip label="Sync Pen State">
							<ActionIcon variant="outline" onClick={penSync} color="gray">
								<RefreshCw size={16} />
							</ActionIcon>
						</Tooltip>
					</Group>
				</Stack>
			</Group>

			<Group justify="center" grow gap="xs">
				<Button 
          variant="light" 
          color="yellow" 
          size="xs" 
          leftSection={<Home size={14} />} 
          onClick={home}
        >
					HOME
				</Button>
				<Button 
          variant="filled" 
          color="red" 
          size="xs" 
          leftSection={<ShieldAlert size={14} />} 
          onClick={stop}
        >
					STOP
				</Button>
			</Group>
			
			<Divider variant="dashed" />
			
			<Group justify="center" gap="xs">
				<Button variant="outline" size="xs" leftSection={<Power size={14} />} onClick={() => emit("connect")}>Connect</Button>
				<Menu shadow="md" width={200} position="bottom-end">
					<Menu.Target>
						<ActionIcon variant="outline" size="md">
							<Settings size={16} />
						</ActionIcon>
					</Menu.Target>
					<Menu.Dropdown>
						<Menu.Label>Actions</Menu.Label>
						<Menu.Item leftSection={<Download size={14} />} onClick={downloadSVG}>Save SVG</Menu.Item>
						<Menu.Item leftSection={<Trash2 size={14} />} color="red" onClick={clearPath}>Clear Path</Menu.Item>
						<Menu.Divider />
						<Menu.Label>System</Menu.Label>
						<Menu.Item leftSection={<RefreshCw size={14} />} color="orange" onClick={() => emit("reset")}>Reset EBB</Menu.Item>
						<Menu.Item leftSection={<Power size={14} />} color="red" onClick={() => emit("reboot")}>Reboot EBB</Menu.Item>
						<Menu.Divider />
						<Menu.Item onClick={() => emit("disconnect")}>Disconnect</Menu.Item>
					</Menu.Dropdown>
				</Menu>
			</Group>
		</Stack>
	);
}
