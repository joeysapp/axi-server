/*
 * Not a threejs/fiber implementation of projection.
 *
 * Just a reminder. Likely threejs has helpers for this with cameras,
 * we'll need to be calculating the actual math and storing it for svg export though.
 */

import { useRef, useEffect } from "react";

export const WebGPUProjectionCanvas = () => {
	const canvasRef = useRef(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");

		// Simple cube data (same as 3D)
		const vertices = [
			[-0.5, -0.5, 0.5],
			[0.5, -0.5, 0.5],
			[0.5, 0.5, 0.5],
			[-0.5, 0.5, 0.5],
			[-0.5, -0.5, -0.5],
			[0.5, -0.5, -0.5],
			[0.5, 0.5, -0.5],
			[-0.5, 0.5, -0.5],
		];

		// Projection parameters (observer at z=0.5)
		const projectionDistance = 0.5;

		function project(vertex) {
			const [x, y, z] = vertex;
			const scale = projectionDistance / z;
			return [x * scale, y * scale];
		}

		function render() {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = "black";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			// Project and draw
			for (const vertex of vertices) {
				const [x, y] = project(vertex);
				const screenX = ((x + 1) * canvas.width) / 2;
				const screenY = ((y + 1) * canvas.height) / 2;
				ctx.fillStyle = "red";
				ctx.fillRect(screenX, screenY, 5, 5);
			}
		}

		render();
	}, []);

	return (
		<canvas
			ref={canvasRef}
			width={400}
			height={300}
			style={{ border: "1px solid black" }}
		/>
	);
};

export default WebGPUProjectionCanvas;
