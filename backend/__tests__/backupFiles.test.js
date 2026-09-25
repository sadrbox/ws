// Набор резервных копий (services/backup.js) — без базы и pg_dump: адрес базы сервиса ИИ из .env,
// ротация по видам, права на файлы.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEnvValue, filesOfKind, rotate, tightenPermissions } from "../services/backup.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));

test("адрес из .env: как есть, в кавычках, с пробелами и CRLF; нет ключа — пусто", () => {
	const text = "# comment\r\nPORT=3100\r\nDATABASE_URL=\"postgresql://u:p@localhost:5432/buhprof_ai\"  \r\nX=1\r\n";
	assert.equal(readEnvValue(text, "DATABASE_URL"), "postgresql://u:p@localhost:5432/buhprof_ai");
	assert.equal(readEnvValue("DATABASE_URL=postgresql://a/b", "DATABASE_URL"), "postgresql://a/b");
	assert.equal(readEnvValue("ERP_DATABASE_URL=postgresql://erp", "DATABASE_URL"), "", "другой ключ с тем же хвостом не подходит");
	assert.equal(readEnvValue("", "DATABASE_URL"), "");
});

test("ротация — отдельно по каждому виду, чужие файлы не трогаются", () => {
	const dir = tmp();
	const stamps = ["2026-09-21", "2026-09-22", "2026-09-23"];
	for (const s of stamps) {
		fs.writeFileSync(path.join(dir, `backup_${s}.sql.gz`), "x");
		fs.writeFileSync(path.join(dir, `backup-ai_${s}.sql.gz`), "x");
		fs.writeFileSync(path.join(dir, `backup-uploads_${s}.tar.gz`), "x");
	}
	fs.writeFileSync(path.join(dir, "notes.txt"), "x");
	rotate(dir, 2);
	assert.deepEqual(filesOfKind(dir, "erp"), ["backup_2026-09-23.sql.gz", "backup_2026-09-22.sql.gz"]);
	assert.deepEqual(filesOfKind(dir, "ai"), ["backup-ai_2026-09-23.sql.gz", "backup-ai_2026-09-22.sql.gz"]);
	assert.deepEqual(filesOfKind(dir, "uploads"), ["backup-uploads_2026-09-23.tar.gz", "backup-uploads_2026-09-22.tar.gz"]);
	assert.ok(fs.existsSync(path.join(dir, "notes.txt")));
	// Копии ERP не путаются с копиями ИИ: у «backup-ai_» другой префикс.
	assert.ok(filesOfKind(dir, "erp").every((f) => f.startsWith("backup_")));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("права: каталог 700, файлы копий 600 (в том числе старые 644)", { skip: process.platform === "win32" && "нет POSIX-прав" }, () => {
	const dir = tmp();
	const f = path.join(dir, "backup_2026-09-24.sql.gz");
	fs.writeFileSync(f, "x", { mode: 0o644 });
	fs.chmodSync(dir, 0o755);
	tightenPermissions(dir);
	assert.equal(fs.statSync(f).mode & 0o777, 0o600);
	assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
	fs.rmSync(dir, { recursive: true, force: true });
});
