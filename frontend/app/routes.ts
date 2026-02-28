import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	// index("routes/landing.tsx"),
	route("ui", "routes/home.tsx", { id: "ui-route" }),
] satisfies RouteConfig;
