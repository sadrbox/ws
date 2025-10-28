import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
	server: {
		allowedHosts: ["buhprof.ddns.me"],
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
					@use "src/app/styles/variables.scss" as *;
				`,
				// includePaths: [path.resolve(__dirname, "src/styles")],
			},
		},
	},
});

// @use "src/styles/index.scss" as *;
