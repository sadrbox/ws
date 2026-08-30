// ESLint (flat config) для бэкенда — Node.js ESM (Q10).
// Бэкенд на чистом JS (без TypeScript), поэтому type-aware правила не подключаем —
// только @eslint/js recommended (ловит реальные баги: no-undef, no-unreachable,
// no-dupe-keys, no-unused-vars и т.п.). Полный прогон пока красный → гасим долг
// монотонно через scripts/eslint-ratchet.mjs (.eslint-baseline), как на фронте.
import js from "@eslint/js";
import globals from "globals";

export default [
	{
		ignores: [
			"node_modules/**",
			"logs/**",
			"uploads/**",
			"backups/**",
			"prisma/manual/**",
		],
	},
	{
		...js.configs.recommended,
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: {
				...globals.node,
			},
		},
		rules: {
			...js.configs.recommended.rules,
			// Служебные аргументы/переменные с префиксом _ и пойманные ошибки — не шум.
			"no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
			],
			// `catch {}` — намеренное глотание ошибок парсинга опциональных query-
			// параметров (сортировка/фильтры): падать из-за кривого ввода нельзя.
			"no-empty": ["error", { allowEmptyCatch: true }],
		},
	},
	{
		// Тесты: добавляем node:test глобали не нужны (импортируются), но допускаем
		// более свободный стиль — оставляем те же правила, отдельных послаблений нет.
		files: ["__tests__/**/*.js"],
		languageOptions: { globals: { ...globals.node } },
	},
];
