import { useState, useCallback } from "react";
import { Paper, Text, Stack, Group, Button } from "@mantine/core";
import { useWebSocket } from "~/contexts/WebSocketProvider";

export function AxiUpload() {
	const { state } = useWebSocket();
	const [dragging, setDragging] = useState(false);

	const handleFile = useCallback(async (file: File) => {
		const formData = new FormData();
		formData.append("file", file);

		try {
			const savedHost = localStorage.getItem("axiApiHost") || (import.meta as any).env?.VITE_AXI_API_HOST || window.location.origin;
			const res = await fetch(`${savedHost}/svg/upload`, {
				method: "POST",
				body: formData,
			});
			const data = await res.json();
			if (data.error) throw new Error(data.error);
			console.log("Uploaded SVG", data);
		} catch (e) {
			console.error("Failed to upload SVG", e);
		}
	}, []);

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragging(false);
		const file = e.dataTransfer.files[0];
		if (file) handleFile(file);
	};

	return (
		<Paper 
			p="xl" 
			withBorder 
			style={{ 
				borderStyle: "dashed", 
				backgroundColor: dragging ? "rgba(233, 69, 96, 0.1)" : "transparent",
				borderColor: dragging ? "#e94560" : undefined,
				cursor: "pointer",
				textAlign: "center"
			}}
			onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
			onDragLeave={() => setDragging(false)}
			onDrop={onDrop}
			onClick={() => document.getElementById("svg-upload-input")?.click()}
		>
			<input 
				id="svg-upload-input" 
				type="file" 
				accept=".svg" 
				style={{ display: "none" }} 
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) handleFile(file);
				}}
			/>
			<Stack gap="xs">
				<Text size="xl">📄</Text>
				<Text fw={500}>Click or drag SVG here</Text>
				<Text size="xs" c="dimmed">Maximum size 10MB</Text>
			</Stack>
		</Paper>
	);
}
