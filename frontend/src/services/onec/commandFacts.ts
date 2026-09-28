/**
 * ЧТО ПАНЕЛЬ ДОБАВЛЯЕТ К ОТВЕТУ КОМАНДЫ 1С (28.09): путь исполнения и подсказку к коду отказа.
 *
 * ПУТЬ ИСПОЛНЕНИЯ — `via` (С1 задачи агента 28.09). С агента 2026-09-27 21:54 команды расширений
 * (`IB_INSTALL_EXTENSION`, `IB_DELETE_EXTENSION`, `IB_EXPORT_EXTENSION`, `IB_LIST_EXTENSIONS`) идут одним из двух
 * путей: соединением с базой (COM) или напрямую через СУБД (`ibcmd`). У путей разные отказы и разные лекарства:
 * COM упирается во вход в базу и блокировку сеансов, `ibcmd` — в монопольный доступ к базе данных. Без пути в
 * «Прогрессе» человек не знает, что чинить. Успех несёт путь в `via` результата, отказ — в `error.details.via`;
 * сервис хранит то и другое как есть.
 *
 * ПОДСКАЗКА К КОДУ ОТКАЗА (С2). Сервис дописывает свои подсказки к тексту отказа сам (ai/src/onec/errorHints.ts),
 * но про `IB_SESSIONS_DENIED` он пока молчит, а человеку нужен ответ «что делать» везде, где виден отказ. Подсказка
 * приписывается один раз: если сервис однажды допишет тот же текст, второй копии не будет.
 *
 * Чистые функции без JSX: их зовут и адаптер «Прогресса», и маршрутизатор ошибок, и строки «Заданий».
 */
import { translate } from "src/i18";

/** Путь, которым агент исполнил команду: соединение с базой или напрямую через СУБД. */
export type OnecVia = "com" | "ibcmd";

/** Порядок показа, когда путей несколько (задание по многим базам): сначала COM, как у агента. */
const VIA_ORDER: readonly OnecVia[] = ["com", "ibcmd"];

const asVia = (v: unknown): OnecVia | null => {
	if (typeof v !== "string") return null;
	const s = v.trim().toLowerCase();
	return (VIA_ORDER as readonly string[]).includes(s) ? (s as OnecVia) : null;
};

/**
 * Путь исполнения по ответу команды: у результата — `via`, у отказа — `details.via` (подойдёт и сам объект ошибки
 * `AiServiceError`, и `error` строки задания). Незнакомое значение — ничего: выдумывать путь хуже, чем промолчать.
 */
export function commandVia(x: unknown): OnecVia | null {
	if (!x || typeof x !== "object") return null;
	const o = x as { via?: unknown; details?: unknown };
	const own = asVia(o.via);
	if (own) return own;
	return o.details && typeof o.details === "object" ? asVia((o.details as { via?: unknown }).via) : null;
}

/** Путь словами: «соединение с базой (COM)» / «напрямую через СУБД (ibcmd)». */
export const viaLabel = (via: OnecVia): string => translate(via === "com" ? "onecViaCom" : "onecViaIbcmd");

/**
 * «Путь: соединение с базой (COM)» — по одному ответу или по нескольким (результаты и отказы баз одного задания).
 * Разные пути называются оба; пути нет ни у одного — пустая строка, и строку итога ею не засоряют.
 */
export function viaText(...sources: unknown[]): string {
	const found = new Set(sources.map(commandVia).filter((v): v is OnecVia => v !== null));
	const vias = VIA_ORDER.filter((v) => found.has(v));
	return vias.length ? `${translate("onecVia")}: ${vias.map(viaLabel).join("; ")}` : "";
}

/**
 * Вход в базу закрыт блокировкой начала сеансов, и войти с кодом разрешения агент не смог (агент 2026-09-27 22:42).
 * Сервис этот отказ не повторяет и «базой занятой» не считает (ai/src/commands/queue.ts, SESSIONS_DENIED_CODE):
 * повтор с той же блокировкой даст тот же отказ.
 */
export const SESSIONS_DENIED_CODE = "IB_SESSIONS_DENIED";

/** Код отказа → ключ подсказки «что делать». Только то, о чём сервис сам не подсказывает. */
const CODE_HINT_KEYS: Record<string, string> = {
	[SESSIONS_DENIED_CODE]: "onecHintSessionsDenied",
};

/** Код отказа у пойманной ошибки (`AiServiceError.code`) или у `error` строки задания. */
export const errorCode = (e: unknown): string | null => {
	const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
	return typeof code === "string" && code ? code : null;
};

/** Подсказка к коду отказа; кода нет или подсказки к нему нет — пустая строка. */
export const codeHint = (code: unknown): string =>
	typeof code === "string" && CODE_HINT_KEYS[code] ? translate(CODE_HINT_KEYS[code]) : "";

/** Текст отказа с подсказкой по коду — отдельным абзацем и один раз. */
export function withCodeHint(message: string, code: unknown): string {
	const hint = codeHint(code);
	if (!hint || message.includes(hint)) return message;
	return message ? `${message}\n\n${hint}` : hint;
}

/** Текст пойманного отказа для примечаний и итогов: сообщение и подсказка по его коду. */
export const failureText = (e: unknown): string =>
	withCodeHint(e instanceof Error ? e.message : String(e), errorCode(e));
