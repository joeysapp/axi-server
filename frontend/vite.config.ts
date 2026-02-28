import path from "path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: {
		allowedHosts: [],
		host: "0.0.0.0",
	},
	resolve: {
		alias: {
			"@components": path.resolve(import.meta.dirname, "app/components"),
			"@contexts": path.resolve(import.meta.dirname, "app/contexts"),
			"@routes": path.resolve(import.meta.dirname, "app/routes"),
			"@stores": path.resolve(import.meta.dirname, "app/stores"),
			"@styles": path.resolve(import.meta.dirname, "app/styles"),
			"@hooks": path.resolve(import.meta.dirname, "app/hooks"),
		},
	},
	sourcemap: true,
	plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
