// ecosystem.config.js
module.exports = {
	apps: [
		// 1. Dev-сервер Vite в ./frontend (HMR через cloudflared, см. vite.config.ts)
		{
			name: "frontend",
			cwd: "./frontend", // Рабочая директория
			script: "npx",
			args: "vite --host", // dev-сервер на 0.0.0.0:5173 с HMR
			watch: false,
			ignore_watch: ["node_modules", "dist", "logs"],
			env: {
				NODE_ENV: "development",
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
			exec_mode: "cluster",
			instances: 4, // многоядерность: 4 воркера. DB-пул: 4 × дефолт Prisma(17) = 68 < max_connections 100
			// watch: ["server.js", "routes", "controllers"], // Опционально: слежение за файлами
			env: {
				NODE_ENV: "development",
				PORT: 3000,
			},
			error_file: "./logs/backend-err.log",
			out_file: "./logs/backend-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		},
		// 3. Prisma Studio (новый процесс)
		{
			name: "prisma-studio",
			cwd: "./backend", // ← папка с prisma/schema.prisma
			script: "npx",
			args: "prisma studio --port 5555 --browser none", // без открытия браузера
			watch: false, // не перезапускать при изменениях
			env: { NODE_ENV: "development" },
			error_file: "./logs/prisma-err.log",
			out_file: "./logs/prisma-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		},
	],
};
