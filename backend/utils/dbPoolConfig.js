// ─────────────────────────────────────────────────────────────────────────────
// Настройки пула соединений с БД (Н2 аудита 26.09) — отдельно от prisma-client.js, чтобы
// проверяться без базы.
//
// БЫЛО: `new Pool({ statement_timeout: 0, query_timeout: 0 })` — то есть умолчания pg:
//   • max = 10, а расчёт в ecosystem.config.js — «4 воркера × 17 = 68 < max_connections 100»;
//   • ожидание свободного соединения — бесконечное;
//   • запрос без ограничения по времени.
// Один отчёт на всю историю или веер из сотен запросов занимал пул, и ВСЕ остальные запросы
// воркера (а на каждый — ещё 4–7 запросов проверки прав) вставали в очередь навсегда. Снаружи
// это выглядело как «сервер завис», и выходом был только перезапуск.
//
// СТАЛО: предел пула явный и совпадает с расчётом; соединение ждём ограниченное время (потом —
// ошибка, запрос получает ответ, а не висит); запрос дольше `statement_timeout` Postgres
// прерывает сам, освобождая соединение. Всё настраивается переменными окружения:
//   DB_POOL_MAX                    — соединений в пуле процесса (умолчание 17);
//   DB_POOL_CONNECTION_TIMEOUT_MS  — сколько ждать соединения, мс (5000; 0 — без предела);
//   DB_STATEMENT_TIMEOUT_MS        — предел одного SQL-запроса, мс (30000; 0 — без предела).
// Скрипты с заведомо долгими запросами (генератор тестовых данных, разовые пересчёты)
// запускают с DB_STATEMENT_TIMEOUT_MS=0.
// ─────────────────────────────────────────────────────────────────────────────

export const DB_POOL_DEFAULTS = Object.freeze({
	max: 17,
	connectionTimeoutMillis: 5_000,
	statementTimeoutMs: 30_000,
});

/** Целое неотрицательное из окружения; пусто или мусор — умолчание (с предупреждением о мусоре). */
function intFromEnv(env, name, def, { min = 0, warn } = {}) {
	const raw = env[name];
	if (raw === undefined || String(raw).trim() === "") return def;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min) {
		warn?.(`[db] ${name}=${raw} — не целое число не меньше ${min}, беру умолчание ${def}`);
		return def;
	}
	return n;
}

/**
 * Параметры pg.Pool из окружения.
 * @param {Record<string, string|undefined>} [env]
 * @param {{ warn?: (msg: string) => void }} [opts]
 */
export function dbPoolConfig(env = process.env, { warn = (m) => console.warn(m) } = {}) {
	const max = intFromEnv(env, "DB_POOL_MAX", DB_POOL_DEFAULTS.max, { min: 1, warn });
	const connectionTimeoutMillis = intFromEnv(env, "DB_POOL_CONNECTION_TIMEOUT_MS", DB_POOL_DEFAULTS.connectionTimeoutMillis, { warn });
	const statementTimeout = intFromEnv(env, "DB_STATEMENT_TIMEOUT_MS", DB_POOL_DEFAULTS.statementTimeoutMs, { warn });
	return {
		connectionString: env.DATABASE_URL,
		max,
		// 0 у pg означает «ждать бесконечно» — ровно то, от чего уходим; но явный 0 в окружении
		// оставляем выбором администратора.
		connectionTimeoutMillis,
		// Предел выставляет сам Postgres (SET statement_timeout при подключении): прерванный
		// запрос освобождает соединение. Клиентский query_timeout не нужен — он бросает ожидание,
		// а запрос продолжает работать в базе и держит соединение.
		statement_timeout: statementTimeout,
		// По имени соединения приложения видны в pg_stat_activity (рядом — aleppo-bus, aleppo-locks).
		application_name: "aleppo-app",
	};
}

export default { dbPoolConfig, DB_POOL_DEFAULTS };
