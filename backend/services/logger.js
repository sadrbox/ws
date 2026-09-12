/**
 * Логгер бэкенда: уровень, время и один формат строки — без новых зависимостей.
 *
 * ЗАЧЕМ ОН ПОЯВИЛСЯ (Q4). Служебные сообщения писались прямым `console.log`: в потоке pm2
 * они шли без времени и без уровня, а главное — их нельзя было ни приглушить, ни выделить.
 * На приёме событий 1С это особенно заметно: одна строка на КАЖДОЕ событие, и отключить её
 * можно было только правкой кода. Теперь уровень задаётся переменной среды, а формат один
 * на все сообщения, поэтому их видно и можно искать.
 *
 * ПОЧЕМУ СВОЙ, А НЕ pino/winston. Нужны ровно две вещи: порог уровня и единый префикс.
 * Зависимость ради этого добавляет транспорт, сериализацию и свой формат, который всё равно
 * пришлось бы настраивать; а pm2 уже пишет stdout/stderr в файлы с датой.
 *
 * УРОВЕНЬ — `LOG_LEVEL` (debug | info | warn | error, по умолчанию info). Ошибки идут в
 * stderr, остальное в stdout: pm2 держит их в разных файлах, и «что сломалось» не нужно
 * выуживать из потока обычных сообщений.
 *
 * ЧТО ПИСАТЬ. Сообщение — для человека, который разбирает происшествие через неделю:
 * что случилось и с чем, без дампов тел запросов (в них реквизиты документов и имена
 * пользователей — этому в логах не место).
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = () => LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

/** Время в логе — местное и читаемое: логи смотрит человек, а не парсер. */
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function write(level, scope, message, extra) {
	if (LEVELS[level] < threshold()) return;
	const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${scope ? `[${scope}] ` : ""}${message}`;
	const out = level === "error" ? console.error : console.log;
	if (extra === undefined) out(line);
	else out(line, extra);
}

/**
 * Логгер с постоянным префиксом: `logger("wa").info("вебхук подтверждён")`.
 *
 * Префикс — имя подсистемы, а не файла: по нему и отбирают строки в общем потоке
 * (`pm2 logs | grep '\[wa\]'`).
 */
export function logger(scope = "") {
	return {
		debug: (message, extra) => write("debug", scope, message, extra),
		info: (message, extra) => write("info", scope, message, extra),
		warn: (message, extra) => write("warn", scope, message, extra),
		error: (message, extra) => write("error", scope, message, extra),
	};
}

/** Логгер без префикса — для мест, где подсистема не называется. */
export const log = logger();

export default logger;
