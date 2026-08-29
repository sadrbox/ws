// Два подключения к PostgreSQL.
//
//   db  — своя база сервиса (buhprof_ai): агенты, команды, диалоги, аудит.
//   erp — база ERP (buhprof), ТОЛЬКО ЧТЕНИЕ: users и access_rights для авторизации.
//
// ERP-база принадлежит бэкенду; писать в неё отсюда нельзя ни при каких обстоятельствах —
// у бэкенда свои миграции, свой drift-check и своя логика. Поэтому пул ERP открывается с
// `default_transaction_read_only`: даже случайный UPDATE упадёт на уровне СУБД.

import pg from "pg";

export type Db = pg.Pool;

export function createPools(databaseUrl: string, erpDatabaseUrl: string): { db: Db; erp: Db } {
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

	return { db, erp };
}
