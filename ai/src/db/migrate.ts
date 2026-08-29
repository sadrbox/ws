// Миграции: обычные SQL-файлы из ../migrations, применяются при старте сервиса.
//
// Почему не Prisma, как у бэкенда: у сервиса нет оператора с shell на сервере в момент
// деплоя, а `prisma migrate deploy` требует его на каждое изменение схемы. Миграции,
// которые сервис применяет сам, превращают деплой в «скопировать файлы и перезапустить».
// Схема здесь маленькая, ORM ей не нужен.
//
// Каждый файл выполняется в транзакции и записывается в _migrations; повторный запуск
// ничего не делает. Файлы нумеруются: 001_init.sql, 002_....sql — порядок = сортировка имён.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./pool.ts";
import type { Logger } from "../logger.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "../../migrations");

export async function migrate(db: Db, log: Logger): Promise<void> {
	await db.query(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name        text PRIMARY KEY,
			applied_at  timestamptz NOT NULL DEFAULT now()
		)`);

	// Один процесс за раз: pm2 может поднять несколько инстансов одновременно.
	const client = await db.connect();
	try {
		await client.query("SELECT pg_advisory_lock(7213001)");

		const applied = new Set(
			(await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name),
		);
		const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

		for (const file of files) {
			if (applied.has(file)) continue;
			const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
			await client.query("BEGIN");
			try {
				await client.query(sql);
				await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
				await client.query("COMMIT");
				log.info({ migration: file }, "миграция применена");
			} catch (e) {
				await client.query("ROLLBACK");
				throw new Error(`миграция ${file} не применилась: ${(e as Error).message}`);
			}
		}
	} finally {
		await client.query("SELECT pg_advisory_unlock(7213001)").catch(() => {});
		client.release();
	}
}
