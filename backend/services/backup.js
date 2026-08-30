// Резервное копирование БД (E1.3): pg_dump → gzip-файл в backups/ с ротацией.
// Запуск — по требованию (POST /admin/backup, суперадмин) или оппортунистически
// (планировщика в проекте нет — как и у audit-ретеншена). Требует бинарь pg_dump
// на сервере (обычно ставится вместе с PostgreSQL); соединение берётся из DATABASE_URL.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BACKUP_DIR = path.resolve("backups");
const RETENTION = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT) || 14);

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

/** Удалить старые дампы сверх RETENTION (по имени = по времени, лексикографически). */
function rotate() {
	const files = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith("backup_") && f.endsWith(".sql.gz"))
		.sort()
		.reverse();
	for (const f of files.slice(RETENTION)) {
		try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* ignore */ }
	}
}

/**
 * Сделать бэкап: pg_dump (stdout) → gzip → backups/backup_<ISO>.sql.gz + ротация.
 * @returns {Promise<{file:string,size:number,createdAt:string}>}
 */
export async function runBackup() {
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан");
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const { host, port, user, password, database } = parseDbUrl(process.env.DATABASE_URL);
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const filePath = path.join(BACKUP_DIR, `backup_${ts}.sql.gz`);

	await new Promise((resolve, reject) => {
		const pg = spawn(
			"pg_dump",
			["-h", host, "-p", String(port), "-U", user, "-d", database, "--no-owner", "--no-privileges"],
			{ env: { ...process.env, PGPASSWORD: password } },
		);
		const gz = zlib.createGzip();
		const out = fs.createWriteStream(filePath);
		let errText = "";
		pg.stderr.on("data", (d) => { errText += d.toString(); });
		pg.on("error", (e) => reject(new Error(`pg_dump не запущен: ${e.message} (нужен бинарь pg_dump на сервере)`)));
		out.on("error", reject);
		out.on("finish", resolve);
		pg.on("close", (code) => {
			if (code !== 0) {
				try { fs.unlinkSync(filePath); } catch { /* ignore */ }
				reject(new Error(`pg_dump завершился с кодом ${code}: ${errText.trim()}`));
			}
		});
		pg.stdout.pipe(gz).pipe(out);
	});

	rotate();
	const size = fs.statSync(filePath).size;
	return { file: path.basename(filePath), size, createdAt: new Date().toISOString() };
}

/** Список имеющихся дампов (новые первыми). */
export function listBackups() {
	if (!fs.existsSync(BACKUP_DIR)) return [];
	return fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith("backup_") && f.endsWith(".sql.gz"))
		.map((f) => {
			const s = fs.statSync(path.join(BACKUP_DIR, f));
			return { file: f, size: s.size, createdAt: s.mtime.toISOString() };
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Автозапуск по расписанию (opt-in через env BACKUP_INTERVAL_HOURS>0). Планировщика
 * в проекте нет — используем таймер процесса (1 инстанс pm2 fork). По умолчанию
 * ВЫКЛЮЧЕНО (0), чтобы не занимать диск без ведома администратора.
 */
export function startBackupScheduler() {
	const hours = Number(process.env.BACKUP_INTERVAL_HOURS) || 0;
	if (hours <= 0) return; // выключено
	const intervalMs = hours * 3_600_000;
	const tick = async () => {
		try {
			// Пропускаем, если свежая копия уже есть (напр. после ручного бэкапа).
			const last = listBackups()[0];
			if (last && Date.now() - new Date(last.createdAt).getTime() < intervalMs) return;
			const info = await runBackup();
			console.log(`[backup] авто-копия создана: ${info.file} (${info.size} байт)`);
		} catch (e) {
			console.error("[backup] авто-копия не удалась:", e?.message || e);
		}
	};
	// Проверяем не реже раза в час; первый прогон — через минуту после старта.
	setInterval(tick, Math.min(intervalMs, 3_600_000)).unref?.();
	setTimeout(tick, 60_000).unref?.();
	console.log(`[backup] авто-копирование включено: каждые ${hours} ч`);
}

export default { runBackup, listBackups, startBackupScheduler };
