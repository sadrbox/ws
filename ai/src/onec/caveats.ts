/**
 * ОГОВОРКИ УСПЕШНОЙ КОМАНДЫ — одним текстом, по типу команды (С41).
 *
 * «Выполнено» у изменяющей команды 1С не всегда значит «сделано, как просили»: кластер мог принять запрет заданий и
 * оставить их разрешёнными (`warning`), не отдать состояние после записи (`unverified`), расширение могло встать
 * под именем из файла `.cfe` (`requestedName`), а часть свойств пользователя — не принята (`skipped`). Раньше
 * это разбиралось только у записи пользователя; остальное молча терялось, и панель показывала чистый успех.
 * Один разбор — для строки задания и для ответа одиночной команды.
 */
import { userWriteWarning } from "./writeBack.ts";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);

const CLUSTER_FIELD: Record<string, string> = {
	denied: "запрет регламентных заданий",
	enabled: "блокировка начала сеансов",
};

export function commandCaveat(type: string, result: unknown): string | null {
	if (!isObj(result)) return null;
	const parts: string[] = [];
	switch (type) {
		case "IB_CREATE_USER":
		case "IB_UPDATE_USER": {
			const w = userWriteWarning(result as { unverified?: unknown; skipped?: unknown });
			if (w) parts.push(w);
			break;
		}
		case "CLUSTER_SET_SCHEDULED_JOBS":
		case "CLUSTER_SET_SESSIONS_LOCK": {
			if (typeof result.warning === "string" && result.warning.trim()) parts.push(result.warning.trim());
			const unverified = strings(result.unverified);
			if (unverified.length) {
				parts.push(`кластер не отдал состояние после записи (${unverified.map((k) => CLUSTER_FIELD[k] ?? k).join(", ")}) — `
					+ "проверьте в консоли кластера");
			}
			break;
		}
		/*
		 * ПУБЛИКАЦИЯ БЕЗ ПОДТВЕРЖДЕНИЯ (С47, агент 2026-09-18 13:13 / А49). Агент отвечает `unverified: ["publication"]`,
		 * когда не может САМ убедиться, что веб-сервер принял запись: у Apache он конфигурацию не читает, а у IIS
		 * адрес мог не подтвердиться. Команда при этом выполнена — но «Выполнено» без оговорки читается как
		 * «публикация работает», хотя проверял это никто.
		 */
		case "IB_PUBLISH":
		case "IB_UNPUBLISH": {
			if (strings(result.unverified).includes("publication")) {
				parts.push("веб-сервер не проверен после записи (у Apache агент судить не может) — "
					+ "проверьте публикацию в браузере");
			}
			break;
		}
		case "IB_INSTALL_EXTENSION": {
			const requested = typeof result.requestedName === "string" ? result.requestedName.trim() : "";
			const actual = typeof result.name === "string" ? result.name.trim() : "";
			if (requested && requested !== actual) {
				parts.push(actual
					? `расширение установлено под именем «${actual}», а запрошено «${requested}» — ищите его в списке под этим именем`
					: `расширение установлено под именем из файла .cfe, а не «${requested}» — ищите его в списке под именем из файла`);
			}
			const skipped = strings(result.skipped);
			if (skipped.length) parts.push(`платформа не приняла свойства расширения: ${skipped.join(", ")}`);
			break;
		}
		default:
			break;
	}
	return parts.length ? parts.join("; ") : null;
}
