/**
 * ЧТО ЗАПИСАТЬ В РЕЕСТР ПОСЛЕ УСПЕШНОЙ ИЗМЕНЯЮЩЕЙ КОМАНДЫ — чистое решение по типу, телу и ответу.
 *
 * Правило (TASK_SERVICE_ECHO_WRITE_COMMANDS.md): изменение → в ответе новое состояние → реестр
 * обновлён в тот же миг, когда команда стала `done`. Нет `state` (агент старее E1–E6, перечитать
 * не удалось) — запасной путь: записать известное по факту команды или поставить чтение, но
 * НИКОГДА не оставлять реестр прежним молча.
 *
 * Отдельно от agentRouter, чтобы правила проверял тест, а не разбор кода обработчика.
 */
import type { AgentProcess } from "../agents/service.ts";

export type LockState = {
	enabled: boolean;
	message: string | null;
	from: string | null;
	to: string | null;
	/** Когда прочитано у кластера; null — не читалось (записано по команде). */
	seenAt: string | null;
};

export type ConfigState = { name: string | null; version: string | null; seenAt: string | null };

export type WriteStateAction =
	| { kind: "lock"; lock: LockState; source: "cluster" | "command" }
	| { kind: "infobases"; items: Record<string, unknown>[] }
	| { kind: "missing" }
	| { kind: "config"; config: ConfigState }
	| { kind: "processes"; items: AgentProcess[] }
	| { kind: "publication"; published: boolean; url: string | null; seenAt: string | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const stateOf = (result: unknown, key: string): unknown =>
	isObj(result) && isObj(result.state) ? result.state[key] : undefined;

/** Состояние блокировки из эха (E1) или из строки среза баз. Без `enabled`-булева — не состояние. */
export function parseLock(v: unknown): LockState | null {
	if (!isObj(v) || typeof v.enabled !== "boolean") return null;
	return {
		enabled: v.enabled,
		message: str(v.message),
		from: str(v.from),
		to: str(v.to),
		seenAt: str(v.readAt),
	};
}

/** Процессы в форме heartbeat; одна кривая строка — весь список не принимаем. */
export function parseProcesses(v: unknown): AgentProcess[] | null {
	if (!Array.isArray(v)) return null;
	const out: AgentProcess[] = [];
	for (const p of v) {
		if (!isObj(p) || !Number.isInteger(p.pid) || typeof p.tool !== "string") return null;
		out.push({
			pid: p.pid as number, tool: p.tool,
			...(typeof p.what === "string" ? { what: p.what } : {}),
			...(typeof p.base === "string" || p.base === null ? { base: p.base as string | null } : {}),
			...(Number.isInteger(p.ageSecs) ? { ageSecs: p.ageSecs as number } : {}),
			...(typeof p.orphan === "boolean" ? { orphan: p.orphan } : {}),
		});
	}
	return out;
}

const dryRun = (payload: Record<string, unknown>): boolean => payload.dryRun === true;

export function planWriteState(
	type: string, payload: Record<string, unknown>, result: unknown,
): WriteStateAction[] {
	switch (type) {
		case "CLUSTER_SET_SESSIONS_LOCK": {
			const lock = parseLock(stateOf(result, "lock"));
			if (lock) return [{ kind: "lock", lock, source: "cluster" }];
			// Кластер состояние не сообщил — известно то, что панель велела и что выполнено.
			if (typeof payload.enabled !== "boolean") return [];
			return [{
				kind: "lock", source: "command",
				lock: {
					enabled: payload.enabled,
					message: payload.enabled ? str(payload.message) : null,
					from: payload.enabled ? str(payload.from) : null,
					to: payload.enabled ? str(payload.to) : null,
					seenAt: null,
				},
			}];
		}
		case "CLUSTER_DROP_INFOBASE": {
			const list = stateOf(result, "infobases");
			if (isObj(list) && list.complete === true && Array.isArray(list.items) && list.items.every(isObj)) {
				return [{ kind: "infobases", items: list.items as Record<string, unknown>[] }];
			}
			// Агент удаляет регистрацию, только убедившись, что базы данных нет, — это факт.
			return [{ kind: "missing" }];
		}
		case "IB_RESTORE":
		case "IB_APPLY_UPDATE": {
			if (dryRun(payload)) return [];
			const c = stateOf(result, "config");
			if (isObj(c) && (typeof c.version === "string" || typeof c.name === "string")) {
				return [{ kind: "config", config: { name: str(c.name), version: str(c.version), seenAt: str(c.readAt) } }];
			}
			// Обновление без эха: версия, до которой обновили, известна из самого ответа.
			const to = isObj(result) ? str(result.versionTo) : null;
			return type === "IB_APPLY_UPDATE" && to
				? [{ kind: "config", config: { name: null, version: to, seenAt: null } }]
				: [];
		}
		// Прерывание начатой команды, снявшее процесс (killed), тоже приносит список (аудит 14.09, T3).
		case "AGENT_CANCEL_COMMAND":
		case "AGENT_KILL_PROCESS": {
			const list = stateOf(result, "processes");
			const items = isObj(list) ? parseProcesses(list.items) : null;
			return items ? [{ kind: "processes", items }] : [];
		}
		case "AGENT_LIST_PROCESSES": {
			// Живое чтение — тоже снимок: без этого «Проверить сейчас» не обновляло таблицу.
			const items = isObj(result) ? parseProcesses(result.items) : null;
			return items ? [{ kind: "processes", items }] : [];
		}
		case "IB_PUBLISH":
		case "IB_UNPUBLISH": {
			const pub = stateOf(result, "publication");
			if (!isObj(pub) || typeof pub.published !== "boolean") return [];
			return [{ kind: "publication", published: pub.published, url: pub.published ? str(pub.url) : null, seenAt: str(pub.readAt) }];
		}
		default:
			return [];
	}
}

export type ReadAfter = "IB_LIST_USERS" | "IB_LIST_EXTENSIONS";

/**
 * Какие чтения поставить после ОТКАЗА (S3). `IB_FIELD_NOT_APPLIED` после записи: остальные поля
 * команды в базе уже записаны (у создания — пользователь создан), а эха у отказа нет — без
 * чтения реестр остался бы с тем, что было до команды.
 */
export function readsAfterFailure(type: string, code: string | undefined): ReadAfter[] {
	if (code !== "IB_FIELD_NOT_APPLIED") return [];
	return type === "IB_CREATE_USER" || type === "IB_UPDATE_USER" ? ["IB_LIST_USERS"] : [];
}

/**
 * Какие чтения поставить после изменения — только то, чего эхо не принесло.
 *
 * Загрузка из выгрузки заменяет базу целиком: и пользователей, и расширения. Обновление
 * конфигурации может сделать расширения неприменимыми. `dryRun` не меняет ничего.
 */
export function readsAfter(
	type: string, payload: Record<string, unknown>, applied: { users: boolean; extensions: boolean },
): ReadAfter[] {
	const MAP: Record<string, ReadAfter[]> = {
		IB_CREATE_USER: ["IB_LIST_USERS"],
		IB_UPDATE_USER: ["IB_LIST_USERS"],
		IB_DELETE_USER: ["IB_LIST_USERS"],
		IB_INSTALL_EXTENSION: ["IB_LIST_EXTENSIONS"],
		IB_DELETE_EXTENSION: ["IB_LIST_EXTENSIONS"],
		IB_RESTORE: ["IB_LIST_USERS", "IB_LIST_EXTENSIONS"],
		// Новая конфигурация может не знать ролей, выданных в старой (агент R7-А5): пользователи тоже (T4).
		IB_APPLY_UPDATE: ["IB_LIST_USERS", "IB_LIST_EXTENSIONS"],
	};
	if (dryRun(payload)) return [];
	return (MAP[type] ?? []).filter((t) => !(t === "IB_LIST_USERS" ? applied.users : applied.extensions));
}
