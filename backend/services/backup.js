// Резервное копирование (E1.3): pg_dump → gzip-файл в backups/ с ротацией.
// Запуск — по требованию (POST /admin/backup, суперадмин) или по расписанию (единый
// планировщик, BACKUP_INTERVAL_HOURS — регистрируется в server.js). Требует бинари pg_dump
// и tar на сервере; соединение с основной базой берётся из DATABASE_URL.
//
// ЧТО В КОПИИ (25.09). Раньше копировалась одна база ERP — а восстановить установку по ней
// нельзя: база сервиса ИИ (агенты, базы 1С, диалоги и файлы чата) и загруженные файлы ERP
// (`uploads`) пропали бы вместе с диском. Теперь один запуск снимает НАБОР:
//   backup_<время>.sql.gz          — база ERP (имя прежнее: по нему живут список и расписание);
//   backup-ai_<время>.sql.gz       — база сервиса ИИ (адрес — BACKUP_AI_DATABASE_URL, иначе
//                                    DATABASE_URL из ../ai/.env той же установки; «off» — не снимать);
//   backup-uploads_<время>.tar.gz  — каталог uploads (BACKUP_UPLOADS=off — не архивировать).
// Каждый вид хранится в BACKUP_RETENTION_COUNT экземплярах.
//
// ПРАВА. В копии — все данные клиентов и хэши паролей, поэтому каталог 700, файлы 600: читать их
// может только пользователь, под которым работает сервер. Старые копии с 644 исправляются при запуске.
//
// ВНЕ СЕРВЕРА. Копия на том же диске не переживёт сам диск. BACKUP_COPY_DIR — каталог на ДРУГОМ
// носителе (сетевая папка, второй диск): набор копируется туда и ротируется так же. Не задан —
// копия остаётся только локальной, и результат бэкапа говорит об этом прямо.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { logger } from "./logger.js";

const log = logger("backup");

const BACKUP_DIR = path.resolve("backups");
const RETENTION = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT) || 14);

/** Виды файлов набора: префикс имени → расширение. */
const KINDS = {
	erp: { prefix: "backup_", ext: ".sql.gz" },
	ai: { prefix: "backup-ai_", ext: ".sql.gz" },
	uploads: { prefix: "backup-uploads_", ext: ".tar.gz" },
};

/** Разобрать postgres://user:pass@host:port/db в части соединения. */
function parseDbUrl(url) {
	const u = new URL(url);
	return {
		host: u.hostname || "localhost",
		port: u.port || "5432",
		user: decodeURIComponent(u.username || ""),
		password: decodeURIComponent(u.password || ""),
		database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
	};
}

/** Значение переменной из .env-файла (без подстановок): `KEY=value`, `KEY="value"`. */
export function readEnvValue(text, key) {
	for (const raw of String(text).split(/\r?\n/)) {
		const line = raw.trim();
		if (!line.startsWith(`${key}=`)) continue;
		let v = line.slice(key.length + 1).trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		return v;
	}
	return "";
}

/** Адрес базы сервиса ИИ: явная настройка → .env сервиса той же установки → нет. */
function aiDatabaseUrl() {
	const explicit = (process.env.BACKUP_AI_DATABASE_URL || "").trim();
	if (explicit.toLowerCase() === "off") return null;
	if (explicit) return explicit;
	try {
		return readEnvValue(fs.readFileSync(path.resolve("..", "ai", ".env"), "utf8"), "DATABASE_URL") || null;
	} catch {
		return null;
	}
}

/** Файлы вида в каталоге, новые первыми (имя = время, лексикографически). */
export function filesOfKind(dir, kind) {
	const { prefix, ext } = KINDS[kind];
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(ext)).sort().reverse();
}

/** Удалить старые файлы каждого вида сверх RETENTION. */
export function rotate(dir, retention = RETENTION) {
	for (const kind of Object.keys(KINDS)) {
		for (const f of filesOfKind(dir, kind).slice(retention)) {
			try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
		}
	}
}

/** Каталог 700, файлы копий 600 (в том числе оставшиеся от прежних версий с 644). */
export function tightenPermissions(dir) {
	try { fs.chmodSync(dir, 0o700); } catch { /* ignore */ }
	for (const kind of Object.keys(KINDS)) {
		for (const f of filesOfKind(dir, kind)) {
			try { fs.chmodSync(path.join(dir, f), 0o600); } catch { /* ignore */ }
		}
	}
}

/** Процесс → поток в файл 600. `gzip` — сжать вывод (pg_dump пишет несжатый SQL). */
function streamToFile(cmd, args, filePath, { env, gzip }) {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { env });
		const out = fs.createWriteStream(filePath, { mode: 0o600 });
		let errText = "";
		let failed = false;
		const fail = (e) => {
			if (failed) return;
			failed = true;
			out.destroy();
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
			reject(e);
		};
		proc.stderr.on("data", (d) => { errText += d.toString(); });
		proc.on("error", (e) => fail(new Error(`${cmd} не запущен: ${e.message} (нужен бинарь ${cmd} на сервере)`)));
		out.on("error", fail);
		let exited = null;
		let flushed = false;
		const done = () => { if (!failed && exited === 0 && flushed) resolve(); };
		out.on("finish", () => { flushed = true; done(); });
		proc.on("close", (code) => {
			exited = code;
			if (code !== 0) fail(new Error(`${cmd} завершился с кодом ${code}: ${errText.trim()}`));
			else done();
		});
		(gzip ? proc.stdout.pipe(zlib.createGzip()) : proc.stdout).pipe(out);
	});
}

function dumpDatabase(url, filePath) {
	const { host, port, user, password, database } = parseDbUrl(url);
	return streamToFile(
		"pg_dump",
		["-h", host, "-p", String(port), "-U", user, "-d", database, "--no-owner", "--no-privileges"],
		filePath,
		{ env: { ...process.env, PGPASSWORD: password }, gzip: true },
	);
}

function archiveDir(dir, filePath) {
	return streamToFile("tar", ["-czf", "-", "-C", path.dirname(dir), path.basename(dir)], filePath, { env: process.env, gzip: false });
}

/** Скопировать набор в каталог вне сервера и ротировать там. */
function copyOut(files, targetDir) {
	fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
	for (const f of files) {
		const to = path.join(targetDir, f);
		fs.copyFileSync(path.join(BACKUP_DIR, f), to);
		fs.chmodSync(to, 0o600);
	}
	rotate(targetDir);
	tightenPermissions(targetDir);
}

/**
 * Сделать набор копий: база ERP (обязательно), база сервиса ИИ и uploads (если есть), копия вне
 * сервера (если задан BACKUP_COPY_DIR). Не получилось обязательное — ошибка; дополнительное —
 * предупреждение в результате: одна сломанная часть не должна оставлять установку без копии ERP.
 * @returns {Promise<{file:string,size:number,createdAt:string,extras:{kind:string,file:string,size:number}[],copiedTo:string|null,warnings:string[]}>}
 */
export async function runBackup() {
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан");
	fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
	tightenPermissions(BACKUP_DIR);
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const name = (kind) => `${KINDS[kind].prefix}${ts}${KINDS[kind].ext}`;
	const warnings = [];
	const extras = [];

	const main = name("erp");
	await dumpDatabase(process.env.DATABASE_URL, path.join(BACKUP_DIR, main));

	const aiUrl = aiDatabaseUrl();
	if (aiUrl) {
		try {
			await dumpDatabase(aiUrl, path.join(BACKUP_DIR, name("ai")));
			extras.push({ kind: "ai", file: name("ai") });
		} catch (e) {
			warnings.push(`база сервиса ИИ не скопирована: ${e.message}`);
		}
	} else if ((process.env.BACKUP_AI_DATABASE_URL || "").trim().toLowerCase() !== "off") {
		warnings.push("база сервиса ИИ не скопирована: не найден её адрес (BACKUP_AI_DATABASE_URL или ../ai/.env)");
	}

	const uploads = path.resolve("uploads");
	if ((process.env.BACKUP_UPLOADS || "").trim().toLowerCase() !== "off" && fs.existsSync(uploads)) {
		try {
			await archiveDir(uploads, path.join(BACKUP_DIR, name("uploads")));
			extras.push({ kind: "uploads", file: name("uploads") });
		} catch (e) {
			warnings.push(`uploads не заархивированы: ${e.message}`);
		}
	}

	rotate(BACKUP_DIR);
	for (const x of extras) x.size = fs.statSync(path.join(BACKUP_DIR, x.file)).size;

	let copiedTo = null;
	const copyDir = (process.env.BACKUP_COPY_DIR || "").trim();
	if (copyDir) {
		try {
			copyOut([main, ...extras.map((x) => x.file)], path.resolve(copyDir));
			copiedTo = path.resolve(copyDir);
		} catch (e) {
			warnings.push(`копия вне сервера не сделана (${copyDir}): ${e.message}`);
		}
	} else {
		warnings.push("копия только на этом сервере: задайте BACKUP_COPY_DIR (каталог на другом носителе)");
	}

	// Плановый запуск пишет в журнал только имя файла — предупреждения набора должны быть видны там же.
	for (const w of warnings) log.warn(w);
	const size = fs.statSync(path.join(BACKUP_DIR, main)).size;
	return { file: main, size, createdAt: new Date().toISOString(), extras, copiedTo, warnings };
}

/** Список имеющихся копий базы ERP (новые первыми) — по нему живут экран копий и расписание. */
export function listBackups() {
	return filesOfKind(BACKUP_DIR, "erp")
		.map((f) => {
			const s = fs.statSync(path.join(BACKUP_DIR, f));
			return { file: f, size: s.size, createdAt: s.mtime.toISOString() };
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Авто-запуск бэкапа по расписанию (opt-in через BACKUP_INTERVAL_HOURS>0) вынесен
// в единый планировщик services/scheduler.js (Z5) — регистрируется в server.js.

export default { runBackup, listBackups };
