// Н8 аудита 26.09: копия пишется во временный файл и получает итоговое имя только после успеха —
// прерванный pg_dump не оставляет «свежую» усечённую копию. HEADLESS: вместо pg_dump — sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { streamToFile, removePartials, filesOfKind, PARTIAL_SUFFIX } from "../services/backup.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "backup-atomic-"));

test("успех: итоговый файл появляется целиком, временного не остаётся", async () => {
	const dir = tmp();
	const file = path.join(dir, "backup_2026-09-26.sql.gz");
	await streamToFile("sh", ["-c", "echo 'SELECT 1;'"], file, { env: process.env, gzip: true });
	assert.ok(fs.existsSync(file));
	assert.ok(!fs.existsSync(file + PARTIAL_SUFFIX));
	assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	assert.deepEqual(filesOfKind(dir, "erp"), ["backup_2026-09-26.sql.gz"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("сбой процесса посреди вывода: ни итогового, ни временного файла", async () => {
	const dir = tmp();
	const file = path.join(dir, "backup_2026-09-26.sql.gz");
	await assert.rejects(
		streamToFile("sh", ["-c", "echo часть; exit 3"], file, { env: process.env, gzip: true }),
		/кодом 3/,
	);
	assert.ok(!fs.existsSync(file), "усечённая копия не должна выглядеть готовой");
	assert.ok(!fs.existsSync(file + PARTIAL_SUFFIX));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("пока копия пишется, её нет в списке; обрезок убитого процесса убирается следующим запуском", async () => {
	const dir = tmp();
	const file = path.join(dir, "backup_2026-09-26.sql.gz");
	const running = streamToFile("sh", ["-c", "echo начало; sleep 0.3; echo конец"], file, { env: process.env, gzip: true });
	await new Promise((r) => setTimeout(r, 100));
	assert.deepEqual(filesOfKind(dir, "erp"), [], "незаконченная копия не считается копией");
	assert.ok(fs.existsSync(file + PARTIAL_SUFFIX));
	await running;
	assert.deepEqual(filesOfKind(dir, "erp"), ["backup_2026-09-26.sql.gz"]);

	// Процесс убит посреди записи (pm2 restart): остался только .partial.
	fs.writeFileSync(path.join(dir, `backup_2026-09-27.sql.gz${PARTIAL_SUFFIX}`), "обрезок");
	assert.deepEqual(filesOfKind(dir, "erp"), ["backup_2026-09-26.sql.gz"]);
	assert.equal(removePartials(dir), 1);
	assert.deepEqual(fs.readdirSync(dir), ["backup_2026-09-26.sql.gz"]);
	fs.rmSync(dir, { recursive: true, force: true });
});
