// ecosystem.config.js
//
// РЕЖИМ ЗАДАЁТСЯ ПЕРЕМЕННОЙ APP_MODE, а не правкой файла.
//
//   APP_MODE не задан (умолчание) — РАЗРАБОТКА: фронт живёт dev-сервером Vite с HMR,
//     бэкенд одним процессом в fork. Так удобно работать и отлаживать.
//   APP_MODE=production — ПРОД: фронт раздаёт собранный `dist` (`vite preview`), бэкенд
//     идёт кластером на четыре воркера, NODE_ENV=production у обоих.
//
// Зачем разделение. Прод работал dev-сервером: неминифицированный код, предупреждения
// React, sourcemaps наружу и HMR-сокет, стучащийся на локальный адрес разработчика. Сборка
// при этом есть и собирается за полминуты (194 кБ gzip главного чанка) — не хватало только
// раздачи. А объявленный здесь кластер на четыре воркера (под него и считался пул Prisma:
// 4 × 17 = 68 < 100 соединений) фактически не включался.
//
// Порядок выкладки прода:
//   cd frontend && npm run build
//   APP_MODE=production pm2 start ecosystem.config.js
const PRODUCTION = process.env.APP_MODE === "production";
const NODE_ENV = PRODUCTION ? "production" : "development";

module.exports = {
	apps: [
		// 1. Dev-сервер Vite в ./frontend (см. vite.config.ts).
		// HMR настроен на ПРЯМОЙ доступ по LAN http://192.168.1.112:5173 (ws, порт 5173).
		// Чтобы вернуть HMR через туннель aleppo.kz — задать VITE_HMR_HOST=aleppo.kz,
		// VITE_HMR_PROTOCOL=wss, VITE_HMR_CLIENT_PORT=443 (или убрать эти env — дефолт
		// в vite.config.ts = aleppo.kz). HMR-сокет работает только для того хоста,
		// которым открываешь страницу.
		{
			name: "frontend",
			cwd: "./frontend", // Рабочая директория
			script: "npx",
			// Прод раздаёт СОБРАННОЕ (`vite preview` отдаёт ./dist на том же порту), а
			// разработка — dev-сервер с HMR. Порт один и тот же: снаружи (туннель, LAN)
			// ничего перенастраивать не нужно.
			args: PRODUCTION ? "vite preview --host --port 5173" : "vite --host",
			watch: false,
			ignore_watch: ["node_modules", "dist", "logs"],
			env: {
				NODE_ENV,
				// HMR — только у dev-сервера: у раздачи `dist` сокета нет вовсе.
				VITE_HMR_HOST: "192.168.1.112",
				VITE_HMR_PROTOCOL: "ws",
				VITE_HMR_CLIENT_PORT: "5173",
			},
			error_file: "./logs/frontend-err.log",
			out_file: "./logs/frontend-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		},

		// 2. Node.js сервер в ./backend
		{
			name: "backend-node",
			cwd: "./backend", // Рабочая директория
			//script: "server.js", // Прямой запуск server.js
			script: "server.js", // ESM-вход; PM2 cluster с ESM проверен — работает
			// Кластер — только в проде: в разработке один процесс проще отлаживать
			// (точки останова, перезапуск, чтение логов без чересполосицы воркеров).
			exec_mode: PRODUCTION ? "cluster" : "fork",
			instances: PRODUCTION ? 4 : 1, // DB-пул: 4 × дефолт Prisma(17) = 68 < max_connections 100
			// watch: ["server.js", "routes", "controllers"], // Опционально: слежение за файлами
			env: {
				NODE_ENV,
				PORT: 3000,
			},
			error_file: "./logs/backend-err.log",
			out_file: "./logs/backend-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		},
		// 4. BuhProf AI Service (./ai) — диалоговый интерфейс к 1С через bpapi-agent.
		// TypeScript исполняется Node без сборки (type stripping, Node >= 22.6).
		// Один инстанс: long-poll агентов и очередь команд рассчитаны на один процесс.
		// Конфиг — ./ai/.env (секреты там, в git не попадает).
		{
			name: "ai-service",
			cwd: "./ai",
			script: "node",
			args: "--experimental-strip-types --no-warnings=ExperimentalWarning --env-file=.env src/server.ts",
			exec_mode: "fork",
			instances: 1,
			watch: false,
			max_memory_restart: "400M",
			env: { NODE_ENV: "production" },
			error_file: "./logs/ai-service-err.log",
			out_file: "./logs/ai-service-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		},

		// 3. Prisma Studio (новый процесс)
		// Prisma Studio — ИНСТРУМЕНТ РАЗРАБОТЧИКА: полный доступ ко всем таблицам мимо прав
		// приложения. В проде его не поднимаем вовсе; нужен разово — запускается руками.
		...(PRODUCTION ? [] : [{
			name: "prisma-studio",
			cwd: "./backend", // ← папка с prisma/schema.prisma
			script: "npx",
			args: "prisma studio --port 5555 --browser none", // без открытия браузера
			watch: false, // не перезапускать при изменениях
			env: { NODE_ENV: "development" },
			error_file: "./logs/prisma-err.log",
			out_file: "./logs/prisma-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		}]),
	],
};
