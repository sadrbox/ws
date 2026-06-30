import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// Cast to any to allow Vitest-specific `test` field without TypeScript errors
export default defineConfig({
	server: {
		host: true, // слушать 0.0.0.0 — доступ из туннеля (cloudflared) и LAN
		allowedHosts: ["aleppo.kz"],
		// HMR через cloudflared: клиент подключается по wss://aleppo.kz:443
		// (cloudflared проксирует websocket). HMR настроен на хост туннеля, поэтому
		// горячая перезагрузка работает при доступе через https://aleppo.kz.
		// При прямом доступе по локалке (http://192.168.1.x:5173) HMR-сокет
		// «стучится» на aleppo.kz и не подключится — там обновляй вкладку вручную.
		hmr: {
			protocol: "wss",
			host: "aleppo.kz",
			clientPort: 443,
		},
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
	build: {
		// xlsx/pdf — крупные сторонние либы, дробятся в свои чанки и грузятся лениво;
		// ниже их уже не ужать, поэтому лимит предупреждения поднят до 600 КБ.
		chunkSizeWarningLimit: 600,
		rollupOptions: {
			output: {
				// Выносим тяжёлые vendor-либы в отдельные чанки → ядро приложения
				// не раздувается, тяжёлое грузится по требованию.
				manualChunks(id: string) {
					if (!id.includes("node_modules")) return undefined;
					if (id.includes("xlsx")) return "xlsx";
					if (id.includes("mammoth")) return "mammoth";
					if (id.includes("pdfjs") || id.includes("react-pdf")) return "pdf";
					if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
					if (id.includes("@tanstack")) return "tanstack";
					// Остальные либы НЕ сливаем в один vendor — Vite распределит их
					// по чанкам-потребителям (часто ленивым), это эффективнее.
					return undefined;
				},
			},
		},
	},
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
