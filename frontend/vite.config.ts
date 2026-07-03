import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";

// HMR-параметры конфигурируются через env, чтобы горячая перезагрузка работала
// и через туннель, и при прямом доступе по LAN/localhost (иначе HMR-сокет жёстко
// «стучится» на aleppo.kz и не подключается при открытии по IP).
//   Туннель (по умолчанию):  wss://aleppo.kz:443
//   Локально:  VITE_HMR_HOST=localhost VITE_HMR_PROTOCOL=ws VITE_HMR_CLIENT_PORT=5173
const HMR_HOST = process.env.VITE_HMR_HOST || "aleppo.kz";
const HMR_PROTOCOL = process.env.VITE_HMR_PROTOCOL || "wss";
const HMR_CLIENT_PORT = Number(process.env.VITE_HMR_CLIENT_PORT) || 443;

// https://vite.dev/config/
// Cast to any to allow Vitest-specific `test` field without TypeScript errors
export default defineConfig({
	server: {
		host: true, // слушать 0.0.0.0 — доступ из туннеля (cloudflared) и LAN
		// Разрешённые хосты: туннель + локальные + переопределённый HMR-хост.
		allowedHosts: ["aleppo.kz", "localhost", "127.0.0.1", ...(HMR_HOST !== "aleppo.kz" ? [HMR_HOST] : [])],
		hmr: {
			protocol: HMR_PROTOCOL,
			host: HMR_HOST,
			clientPort: HMR_CLIENT_PORT,
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
