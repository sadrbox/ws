import type { Plugin } from "vite";
// defineConfig из vitest/config знает поле `test` — приведение всего конфига к any не нужно.
import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import react from "@vitejs/plugin-react";

// HMR-параметры конфигурируются через env, чтобы горячая перезагрузка работала
// и через туннель, и при прямом доступе по LAN/localhost (иначе HMR-сокет жёстко
// «стучится» на aleppo.kz и не подключается при открытии по IP).
//   Туннель (по умолчанию):  wss://aleppo.kz:443
//   Локально:  VITE_HMR_HOST=localhost VITE_HMR_PROTOCOL=ws VITE_HMR_CLIENT_PORT=5173
const HMR_HOST = process.env.VITE_HMR_HOST || "aleppo.kz";
const HMR_PROTOCOL = process.env.VITE_HMR_PROTOCOL || "wss";
const HMR_CLIENT_PORT = Number(process.env.VITE_HMR_CLIENT_PORT) || 443;

/*
 * ВЕРСИЯ СБОРКИ В SERVICE WORKER (аудит 26.09, Н10).
 *
 * public/sw.js копируется в сборку как есть, и его имя кэша было константой: между
 * деплоями файл не менялся, браузер не видел новой версии SW, событие activate не
 * наступало — и чанки всех прежних сборок копились в Cache Storage бессрочно. Теперь в
 * sw.js стоит метка __SW_BUILD_ID__, а сборка подставляет вместо неё хэш имён всех файлов
 * бандла (в именах уже есть хэш содержимого): код не изменился — sw.js тот же и
 * обновления SW нет; изменился — у кэша новое имя, и activate удаляет прежние.
 * На dev-сервере метка остаётся как есть: там SW в чанки Vite не вмешивается (isViteDev).
 */
function swBuildVersion(): Plugin {
	let buildId = "";
	return {
		name: "aleppo:sw-build-version",
		apply: "build",
		generateBundle(_options, bundle) {
			const names = Object.keys(bundle).sort().join("\n");
			buildId = createHash("sha256").update(names).digest("hex").slice(0, 12);
		},
		// public/ копируется в outDir ДО записи бандла, поэтому к writeBundle sw.js уже на месте.
		writeBundle(options) {
			const swPath = path.join(options.dir ?? "dist", "sw.js");
			if (!buildId || !fs.existsSync(swPath)) return;
			const src = fs.readFileSync(swPath, "utf8");
			if (!src.includes("__SW_BUILD_ID__")) {
				this.warn("sw.js: метка __SW_BUILD_ID__ не найдена — имя кэша не версионируется");
				return;
			}
			fs.writeFileSync(swPath, src.split("__SW_BUILD_ID__").join(buildId));
		},
	};
}

/*
 * ДОЛГИЙ КЭШ ХЭШИРОВАННЫХ АССЕТОВ ПРИ ПРОД-РАЗДАЧЕ ЧЕРЕЗ `vite preview` (аудит 26.09, Н10).
 *
 * Прод раздаёт dist через `vite preview` (ecosystem.config.js), а тот отвечает на всё
 * `Cache-Control: no-cache` — браузер и Cloudflare перепроверяют каждый чанк на каждом
 * открытии. Файлы в assets/ названы по хэшу содержимого и не меняются никогда, им —
 * год и immutable. index.html и sw.js не трогаем: они обязаны перепроверяться, иначе
 * новая сборка не дойдёт до пользователя. Заголовок ставится только существующему файлу:
 * на запрос исчезнувшего чанка отвечает запасной index.html, и навсегда закэшировать
 * его под именем чанка нельзя. `preview.headers` не подходит — он действует и на index.html.
 *
 * Проверить потом: предсжатие — `vite preview` жмёт gzip на лету на каждый запрос, brotli
 * нет; полноценно это решается раздачей dist через nginx/express с готовыми .br/.gz.
 */
function previewImmutableAssets(): Plugin {
	return {
		name: "aleppo:preview-immutable-assets",
		configurePreviewServer(server) {
			const outDir = path.resolve(server.config.root, server.config.build.outDir);
			server.middlewares.use((req, res, next) => {
				const pathname = (req.url ?? "").split("?")[0];
				const m = /(?:^|\/)assets\/([^/]+)$/.exec(pathname);
				if (m && fs.existsSync(path.join(outDir, "assets", decodeURIComponent(m[1])))) {
					res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
				}
				next();
			});
		},
	};
}

/*
 * ПРЕДЗАГРУЗКА СЛОВАРЯ И ЧАНКА ПРИЛОЖЕНИЯ (аудит 26.09, О5).
 *
 * Старт идёт в три последовательные фазы (main.tsx): точка входа → словарь → приложение.
 * Порядок ИСПОЛНЕНИЯ обязателен (словарь раньше модулей приложения), но СКАЧИВАТЬ всё это
 * можно сразу: modulepreload только загружает и компилирует модуль, не исполняя его. Через
 * туннель это минус один-два круга до сервера на первом входе и после каждого деплоя.
 * Казахский словарь не предзагружаем: он нужен не всем, а русский грузится всегда (основа).
 */
function preloadBootChunks(): Plugin {
	let base = "./";
	return {
		name: "aleppo:preload-boot-chunks",
		apply: "build",
		configResolved(config) {
			base = config.base;
		},
		transformIndexHtml: {
			order: "post",
			handler(_html, ctx) {
				const { bundle, chunk: entry } = ctx;
				if (!bundle || !entry) return;
				const prefix = base === "" || base === "./" ? "./" : base;
				const scripts = new Set<string>();
				const styles = new Set<string>();
				const add = (fileName: string) => {
					const c = bundle[fileName];
					if (!c || c.type !== "chunk" || scripts.has(fileName)) return;
					if (fileName === entry.fileName || entry.imports.includes(fileName)) return; // уже в HTML
					scripts.add(fileName);
					c.viteMetadata?.importedCss.forEach((css) => styles.add(css));
					c.imports.forEach(add);
				};
				for (const fileName of entry.dynamicImports) {
					const c = bundle[fileName];
					if (!c || c.type !== "chunk") continue;
					const isBoot = c.moduleIds.some((id) =>
						/[\\/]src[\\/]i18[\\/]translations\.json$/.test(id) || /[\\/]src[\\/]app[\\/]index\.tsx$/.test(id));
					if (isBoot) add(fileName);
				}
				return [
					...[...styles].map((href) => ({
						tag: "link", injectTo: "head" as const,
						attrs: { rel: "preload", as: "style", crossorigin: true, href: prefix + href },
					})),
					...[...scripts].map((href) => ({
						tag: "link", injectTo: "head" as const,
						attrs: { rel: "modulepreload", crossorigin: true, href: prefix + href },
					})),
				];
			},
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	base: process.env.VITE_BASE_URL || "./",
	server: {
		host: true, // слушать 0.0.0.0 — доступ из туннеля (cloudflared) и LAN
		// Разрешённые хосты: туннель + локальные + переопределённый HMR-хост.
		allowedHosts: [
			"aleppo.kz",
			"localhost",
			"127.0.0.1",
			...(HMR_HOST !== "aleppo.kz" ? [HMR_HOST] : []),
		],
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
	plugins: [react(), swBuildVersion(), previewImmutableAssets(), preloadBootChunks()],
	// Словари и конфиги колонок импортируются только целиком (`import x from "./a.json"`),
	// именованных импортов из JSON нет. Именованные экспорты удваивали словарь: каждый ключ
	// шёл отдельной `export const` плюс объект по умолчанию — хвост в 85 КБ на словарь.
	// stringify: JSON.parse строки парсится быстрее, чем тот же объект литералом JS (аудит 26.09, О5).
	json: { namedExports: false, stringify: true },
	build: {
		// xlsx/pdf — крупные сторонние либы, дробятся в свои чанки и грузятся лениво;
		// ниже их уже не ужать, поэтому лимит предупреждения поднят до 600 КБ.
		chunkSizeWarningLimit: 600,
		rollupOptions: {
			output: {
				// Выносим тяжёлые vendor-либы в отдельные чанки → ядро приложения
				// не раздувается, тяжёлое грузится по требованию.
				manualChunks(id: string) {
					// `?url`-импорт (pdf.worker.min.mjs?url) — это строка с адресом файла, а не
					// сама библиотека. Попав по правилу «pdfjs» в чанк pdf, он заставлял формы
					// Контрагентов, Организаций, Договоров, Задач и Файлов статически тянуть весь
					// pdf.js (131 КБ gzip). Строку оставляем там, где её импортируют (аудит 26.09, О1).
					if (id.includes("?url")) return undefined;
					if (!id.includes("node_modules")) return undefined;
					if (id.includes("xlsx")) return "xlsx";
					if (id.includes("mammoth")) return "mammoth";
					if (id.includes("pdfjs") || id.includes("react-pdf")) return "pdf";
					if (
						id.includes("recharts") ||
						id.includes("d3-") ||
						id.includes("victory-vendor")
					)
						return "recharts";
					if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
						return "react-vendor";
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
});

// @use "src/styles/index.scss" as *;
