// Два подключения к PostgreSQL.
//
//   db  — своя база сервиса (buhprof_ai): агенты, команды, диалоги, аудит.
//   erp — база ERP (buhprof), ТОЛЬКО ЧТЕНИЕ: users и access_rights для авторизации.
//
// ERP-база принадлежит бэкенду; писать в неё отсюда нельзя ни при каких обстоятельствах —
// у бэкенда свои миграции, свой drift-check и своя логика. Поэтому пул ERP открывается с
// `default_transaction_read_only`: даже случайный UPDATE упадёт на уровне СУБД.
//
// ОБРЫВ СОЕДИНЕНИЯ — НЕ ПОВОД ПАДАТЬ (25.09). Postgres закрывает соединения и сам: перезапуск,
// `pg_terminate_backend`, «terminating connection due to administrator command». Соединение, у которого
// в этот момент нет запроса, сообщает об этом событием `error`, а необработанное `error` в Node роняет
// процесс: так сервис падал с 18.09 — pm2 поднимал его, но долгие опросы агентов и диалоги рвались.
// Слушать надо в двух местах: пул сообщает об обрыве ПРОСТАИВАЮЩЕГО соединения, а у выданного
// (`db.connect()` — миграции, очередь команд, транзакции агентов) pg-pool свой слушатель снимает, и
// обрыв между запросами транзакции приходит событием самого соединения. Сломанное соединение пул при
// возврате выбрасывает и открывает новое, а запрос, попавший на обрыв, получает ошибку как обычно —
// здесь достаточно записать случившееся.

import pg from "pg";

export type Db = pg.Pool;

/** Куда писать обрыв: логгер сервиса (pino подходит как есть); инструментам без логгера хватит консоли. */
export type PoolLog = { warn: (entry: Record<string, unknown>, msg: string) => void };

/**
 * Слушать обрывы пула и его соединений. Обрыв простаивающего соединения приходит дважды (событием
 * соединения и затем пула) — одним и тем же объектом ошибки, поэтому записывается один раз.
 */
export function guardPool(pool: pg.Pool, name: string, log?: PoolLog): void {
	const reported = new WeakSet<Error>();
	const report = (err: Error & { code?: string }) => {
		if (reported.has(err)) return;
		reported.add(err);
		const entry = { pool: name, code: err.code, err: err.message };
		if (log) log.warn(entry, "соединение с Postgres оборвано — пул откроет новое");
		else console.warn("[pool] соединение с Postgres оборвано — пул откроет новое", entry);
	};
	pool.on("error", report);
	pool.on("connect", (client) => { client.on("error", report); });
}

export function createPools(databaseUrl: string, erpDatabaseUrl: string, log?: PoolLog): { db: Db; erp: Db } {
	const db = new pg.Pool({
		connectionString: databaseUrl,
		max: 10,
		idleTimeoutMillis: 30_000,
		application_name: "buhprof-ai",
	});

	const erp = new pg.Pool({
		connectionString: erpDatabaseUrl,
		max: 4,
		idleTimeoutMillis: 30_000,
		application_name: "buhprof-ai-readonly",
		options: "-c default_transaction_read_only=on",
	});

	guardPool(db, "db", log);
	guardPool(erp, "erp", log);
	return { db, erp };
}
