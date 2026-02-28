/*
 * THIS IS WRONG. PLEASE MAKE INTO ACTUAL VERSOR.
 */

import { Paper, Text, Group, Box, Stack } from "@mantine/core";

// lol
interface VersorProps {
	velocity?: { x: number; y: number; z: number; w: number };
}

export function VersorComponent({
	velocity = { x: 0, y: 0, z: 0, w: 0 },
	min = 0,
	max = 100,
}: VersorProps) {
	const renderBar = (label: string, value: number, color: string) => {
		// Mapped to a 0-100% height of div
		// This was made with 10x as the default (idk), so we times our max=1 * 100 to map to 100%
		const delta = max === 100 ? 10.0 : 100.0;
		const heightOfValue = Math.min(Math.abs(value) * delta, 100);
		return (
			<Stack align="space-around" gap={4}>
				<Text size="xs" fw={700}>
					{label}
				</Text>
				<Box
					style={{
						height: "100px",
						width: "12px",
						backgroundColor: "rgba(255,255,255,0.1)",
						borderRadius: "4px",
						position: "relative",
						overflow: "hidden",
					}}
				>
					<Box
						style={{
							position: "absolute",
							bottom: 0,
							width: "100%",
							height: `${heightOfValue}%`,
							backgroundColor: color,
							transition: "height 0.1s ease",
						}}
					/>
				</Box>
				<Text size="10px" fontFamily="monospace" style={{ width: "auto" }}>
					{value.toFixed(2)}
				</Text>
			</Stack>
		);
	};

	return (
		<Paper p="xs" withBorder bg="transparent">
			<Group justify="center" gap="lg">
				{velocity.x === undefined
					? null
					: renderBar("X", velocity.x, "#e94560")}
				{velocity.y === undefined
					? null
					: renderBar("Y", velocity.y, "#4ecca3")}
				{velocity.z === undefined
					? null
					: renderBar("Z", velocity.z, "#3498db")}
				{velocity.w === undefined ? null : renderBar("W", velocity.w, "f63cf4")}
			</Group>
		</Paper>
	);
}

export default VersorComponent;
