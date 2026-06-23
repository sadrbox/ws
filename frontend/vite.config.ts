import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// Cast to any to allow Vitest-specific `test` field without TypeScript errors
export default defineConfig({
	server: {
		// host: true,
		allowedHosts: ["aleppo.kz"],
		// watch: {
		// 	usePolling: true,
		// 	// interval: 10,
		// },
	},
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: "src/setupTests.ts",
	},
	plugins: [react()],
	resolve: {
		alias: {
			src: path.resolve(__dirname, "src"),
			// "@/": `${path.resolve(__dirname, "src")}/`,
		},
	},
	css: {
		preprocessorOptions: {
			scss: {
				additionalData: `
					@use "src/styles/variables.scss" as *;
				`,
				// includePaths: [path.resolve(__dirname, "src/styles")],
			},
		},
	},
} as any);

// @use "src/styles/index.scss" as *;
