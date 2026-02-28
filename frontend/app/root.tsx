// Import styles of packages that you've installed.
import "@mantine/core/styles.css";
import "./styles/breakpoints.scss";
import "./styles/js.scss";
import { mantineTheme } from "./styles/mantine.js";

import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteError,
} from "react-router";
import { MantineProvider } from "@mantine/core";
import { WebSocketProvider } from "~/contexts/WebSocketProvider";

import type { Route } from "./+types/root";

export const links: Route.LinksFunction = () => [
	{ rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
	{ rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
	{ rel: "icon", type: "image/png", href: "/favicon.png" },
	{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
	{ rel: "manifest", href: "/manifest.json" },
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"
				/>
				<meta name="theme-color" content="#0a0a0a" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta
					name="apple-mobile-web-app-status-bar-style"
					content="black-translucent"
				/>
				<Meta />
				<Links />
			</head>
			<body>
				<MantineProvider theme={mantineTheme} defaultColorScheme="dark">
					<WebSocketProvider>{children}</WebSocketProvider>
				</MantineProvider>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	if (isRouteErrorResponse(error)) {
		return (
			<div style={{ padding: 20 }}>
				<h1>
					{error.status} {error.statusText}
				</h1>
				<p>{error.data}</p>
			</div>
		);
	} else if (error instanceof Error) {
		return (
			<div style={{ padding: 20 }}>
				<h1>Error</h1>
				<p>{error.message}</p>
				<pre>{error.stack}</pre>
			</div>
		);
	} else {
		return <h1>Unknown Error</h1>;
	}
}

export function HydrateFallback() {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				height: "100vh",
				background: "#0a0a0a",
				color: "#4ecca3",
			}}
		>
			Loading...
		</div>
	);
}

export default function App() {
	return <Outlet />;
}
