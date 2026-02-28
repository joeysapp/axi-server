import { ThreeCanvas, LiquidDock } from "~/components";

export function meta() {
	return [
		{ title: "axi-lab" },
		{
			name: "description",
			content: "Multiplayer pen plotter control — steer an AxiDraw in real-time from your browser, see other pilots' cursors on a shared 3D canvas.",
		},
		// OpenGraph
		{ property: "og:type", content: "website" },
		{ property: "og:title", content: "axi-lab" },
		{ property: "og:description", content: "Multiplayer pen plotter control. Steer an AxiDraw in real-time from your browser — see other pilots' cursors on a shared 3D canvas." },
		{ property: "og:image", content: "/og-image.png" },
		{ property: "og:image:width", content: "939" },
		{ property: "og:image:height", content: "939" },
		{ property: "og:image:type", content: "image/png" },
		{ property: "og:site_name", content: "axi-lab" },
		// Twitter
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: "axi-lab" },
		{ name: "twitter:description", content: "Multiplayer pen plotter control. Steer an AxiDraw in real-time from your browser." },
		{ name: "twitter:image", content: "/og-image.png" },
	];
}

function AppHome() {
	return (
		<div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
			{/* The full-screen background canvas */}
			<ThreeCanvas />

			{/* The floating control dock */}
			<LiquidDock />
		</div>
	);
}

export default AppHome;
