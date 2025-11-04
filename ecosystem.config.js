// ecosystem.config.js
module.exports = {
	apps: [
		// 1. Vite dev-сервер в ./frontend
		{
			name: "frontend-vite",
			cwd: "./frontend", // Рабочая директория
			script: "npx", // Используем npx, чтобы найти локальный vite
			args: "vite --host",
			watch: false, // Перезапуск при изменении файлов
			ignore_watch: ["node_modules", "dist", "logs"], // Игнорируем эти папки
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
			script: "node",
			args: "server.js",
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
			args: "prisma studio", // без открытия браузера
			watch: false, // не перезапускать при изменениях
			env: { NODE_ENV: "development" },
			error_file: "./logs/prisma-err.log",
			out_file: "./logs/prisma-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss",
		},
	],
};
