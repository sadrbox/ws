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

/*
 * НЕЗАКОНЧЕННАЯ КОПИЯ НЕ ВЫГЛЯДИТ ГОТОВОЙ (Н8 аудита 26.09).
 *
 * Файл писался сразу под итоговым именем. `pm2 restart` посреди pg_dump (умолчание pm2 — убить
 * через 1,6 с) оставлял усечённый `backup_*.sql.gz`, который список и расписание считали свежей
 * копией: следующий автобэкап пропускался на сутки, а ротация вытесняла целые копии обрезками.
 * Теперь пишем в `<имя>.partial` и переименовываем только после успешного завершения процесса и
 * сброса файла на диск. Переименование в одном каталоге атомарно: копия либо целая, либо её нет.
 * Обрезки `.partial` от убитого процесса не подходят ни под один вид и убираются при следующем
 * запуске (removePartials).
 */
export const PARTIAL_SUFFIX = ".partial";

/** Удалить незаконченные файлы (`*.partial`) — остатки прерванных запусков. */
export function removePartials(dir) {
	if (!fs.existsSync(dir)) return 0;
	let n = 0;
	for (const f of fs.readdirSync(dir)) {
		if (!f.endsWith(PARTIAL_SUFFIX)) continue;
		try { fs.unlinkSync(path.join(dir, f)); n++; } catch { /* ignore */ }
	}
	return n;
}

/*
 * ЗАВИСШИЙ ПРОЦЕСС КОПИИ НЕ ДЕРЖИТ УСТАНОВКУ БЕЗ КОПИЙ (КР-17 аудита 27.09). pg_dump или tar, повисший
 * на блокировке таблицы, сетевой папке или диске, держал промис копии вечно — а с ним кластерный лок
 * «backup» и флаг running планировщика: ручной запуск получал 409, плановый пропускался, до перезапуска.
 * Теперь у процесса предел BACKUP_TIMEOUT_MS (умолчание — час; 0 — без предела): по истечении SIGTERM,
 * через KILL_GRACE_MS — SIGKILL, `.partial` удаляется, промис отклоняется — лок и флаг снимаются в их
 * finally. pg_dump к тому же не ждёт блокировок таблиц дольше PG_DUMP_LOCK_WAIT_MS (--lock-wait-timeout:
 * миграция или VACUUM FULL в ту же минуту — понятная ошибка, а не зависание). Ошибка сжатия (zlib)
 * раньше роняла процесс сервера — у gzip-потока не было обработчика `error`.
 */
export const BACKUP_TIMEOUT_DEFAULT_MS = 60 * 60_000;
export const PG_DUMP_LOCK_WAIT_MS = 60_000;
const KILL_GRACE_MS = 5_000;

/** Предел одного процесса копии, мс: BACKUP_TIMEOUT_MS; пусто или мусор — умолчание, 0 — без предела. */
export function backupTimeoutMs(env = process.env) {
	const raw = env.BACKUP_TIMEOUT_MS;
	if (raw === undefined || String(raw).trim() === "") return BACKUP_TIMEOUT_DEFAULT_MS;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) {
		log.warn(`BACKUP_TIMEOUT_MS=${raw} — не число не меньше 0, беру умолчание ${BACKUP_TIMEOUT_DEFAULT_MS}`);
		return BACKUP_TIMEOUT_DEFAULT_MS;
	}
	return n;
}

/**
 * Процесс → поток в файл 600. `gzip` — сжать вывод (pg_dump пишет несжатый SQL); `timeoutMs` — предел
 * процесса (умолчание — BACKUP_TIMEOUT_MS); `makeGzip` — поток сжатия (подменяют тесты).
 */
export function streamToFile(cmd, args, filePath, { env, gzip, timeoutMs = backupTimeoutMs(), makeGzip = () => zlib.createGzip() }) {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { env });
		const partial = filePath + PARTIAL_SUFFIX;
		const out = fs.createWriteStream(partial, { mode: 0o600 });
		let errText = "";
		let failed = false;
		let closed = false;
		let timer = null;
		let killTimer = null;
		// Процесс ещё жив, а копия уже не нужна (таймаут, ошибка записи или сжатия) — остановить: иначе он
		// висит, упёршись в полный канал вывода, которого никто не читает.
		const stop = () => {
			if (closed) return;
			try { proc.kill("SIGTERM"); } catch { /* уже нет */ }
			killTimer = setTimeout(() => { if (!closed) try { proc.kill("SIGKILL"); } catch { /* уже нет */ } }, KILL_GRACE_MS);
			killTimer.unref?.();
		};
		const fail = (e) => {
			if (failed) return;
			failed = true;
			clearTimeout(timer);
			stop();
			out.destroy();
			try { fs.unlinkSync(partial); } catch { /* ignore */ }
			reject(e);
		};
		if (timeoutMs > 0) {
			timer = setTimeout(() => fail(new Error(`${cmd} не завершился за ${Math.max(1, Math.round(timeoutMs / 60_000))} мин — прерван (BACKUP_TIMEOUT_MS)`)), timeoutMs);
			timer.unref?.();
		}
		proc.stderr.on("data", (d) => { errText += d.toString(); });
		proc.on("error", (e) => fail(new Error(`${cmd} не запущен: ${e.message} (нужен бинарь ${cmd} на сервере)`)));
		out.on("error", fail);
		let exited = null;
		let flushed = false;
		const done = () => {
			if (failed || exited !== 0 || !flushed) return;
			clearTimeout(timer);
			try {
				fs.renameSync(partial, filePath);
			} catch (e) {
				return fail(e);
			}
			resolve();
		};
		// `close`, а не `finish`: к нему дескриптор закрыт и данные отданы системе.
		out.on("close", () => { flushed = true; done(); });
		proc.on("close", (code, signal) => {
			closed = true;
			clearTimeout(killTimer);
			exited = code;
			if (code !== 0) fail(new Error(`${cmd} завершился ${code === null ? `по сигналу ${signal}` : `с кодом ${code}`}: ${errText.trim()}`));
			else done();
		});
		if (gzip) {
			const gz = makeGzip();
			gz.on("error", (e) => fail(new Error(`сжатие копии (${cmd}): ${e.message}`)));
			proc.stdout.pipe(gz).pipe(out);
		} else {
			proc.stdout.pipe(out);
		}
	});
}

/** Аргументы pg_dump (пароль — через PGPASSWORD, не в командной строке). */
export function pgDumpArgs({ host, port, user, database }) {
	return ["-h", host, "-p", String(port), "-U", user, "-d", database, "--no-owner", "--no-privileges", `--lock-wait-timeout=${PG_DUMP_LOCK_WAIT_MS}`];
}

function dumpDatabase(url, filePath) {
	const conn = parseDbUrl(url);
	return streamToFile("pg_dump", pgDumpArgs(conn), filePath, { env: { ...process.env, PGPASSWORD: conn.password }, gzip: true });
}

function archiveDir(dir, filePath) {
	return streamToFile("tar", ["-czf", "-", "-C", path.dirname(dir), path.basename(dir)], filePath, { env: process.env, gzip: false });
}

/** Скопировать набор в каталог вне сервера и ротировать там. */
function copyOut(files, targetDir) {
	fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
	removePartials(targetDir);
	for (const f of files) {
		// Через временное имя — как и локальная копия: оборванное копирование не выдаёт себя за целую.
		const to = path.join(targetDir, f);
		fs.copyFileSync(path.join(BACKUP_DIR, f), to + PARTIAL_SUFFIX);
		fs.chmodSync(to + PARTIAL_SUFFIX, 0o600);
		fs.renameSync(to + PARTIAL_SUFFIX, to);
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
	// Обрезки прерванных запусков. Два запуска разом не идут: плановый и ручной берут одну
	// блокировку «backup» (server.js, api/router/backup.js).
	removePartials(BACKUP_DIR);
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
