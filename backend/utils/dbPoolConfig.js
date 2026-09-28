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
//   DB_POOL_MAX                    — соединений в пуле процесса (умолчание 12, расчёт ниже);
//   DB_POOL_CONNECTION_TIMEOUT_MS  — сколько ждать соединения, мс (5000; 0 — без предела);
//   DB_STATEMENT_TIMEOUT_MS        — предел одного SQL-запроса, мс (30000; 0 — без предела).
// Скрипты с заведомо долгими запросами (генератор тестовых данных, разовые пересчёты)
// запускают с DB_STATEMENT_TIMEOUT_MS=0.
//
// РАСЧЁТ ПУЛА (КР-17 аудита 27.09). Умолчание 17 считалось без сервиса ИИ и без запаса:
// max_connections=100, из них 3 — резерв суперпользователя (prisma_user им не является) → 97;
// 4 воркера × (17 + шина + блокировки) = 76, сервис ИИ — 10 + 4 = 14, итого 90: на `pm2 reload`
// (новый воркер поднимается до остановки старого, +19), открытый Studio или psql под нагрузкой
// оставалось ~7 — «too many clients» у всех. Теперь 12: постоянно 4 × (12 + 2) + 14 = 70, в пике
// reload +14 и запас 12 на Studio/psql/миграции — 96 ≤ 97 (connectionBudget ниже, тест держит
// умолчание в пределах). Больше воркеров или поднят max_connections — пересчитать тем же расчётом.
// ─────────────────────────────────────────────────────────────────────────────

export const DB_POOL_DEFAULTS = Object.freeze({
	max: 12,
	connectionTimeoutMillis: 5_000,
	statementTimeoutMs: 30_000,
});

/** Бюджет соединений установки по умолчанию (КР-17): Postgres, воркеры backend, сервис ИИ, запас. */
export const PG_CONNECTION_BUDGET = Object.freeze({
	maxConnections: 100, // max_connections Postgres по умолчанию
	superuserReserved: 3, // superuser_reserved_connections — prisma_user их не получает
	workers: 4, // ecosystem.config.js, прод
	perWorkerService: 2, // aleppo-bus (LISTEN шины кэшей) + aleppo-locks (сессионные блокировки)
	ai: 14, // ai/src/db/pool.ts: основной пул 10 + служебный 4
	reserve: 12, // Prisma Studio, psql, migrate deploy, pg_dump бэкапа
});

/**
 * Сколько соединений займёт установка при пуле poolMax: постоянно (steady) и в пике pm2 reload
 * с запасом (peak); available — сколько их доступно prisma_user.
 */
export function connectionBudget(poolMax, b = PG_CONNECTION_BUDGET) {
	const perWorker = poolMax + b.perWorkerService;
	const steady = b.workers * perWorker + b.ai;
	return { steady, peak: steady + perWorker + b.reserve, available: b.maxConnections - b.superuserReserved };
}

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

export default { dbPoolConfig, DB_POOL_DEFAULTS, PG_CONNECTION_BUDGET, connectionBudget };
