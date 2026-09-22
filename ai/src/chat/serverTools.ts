// Инструменты, которые исполняет сам сервис: задачи и заметки организации в ERP
// (план docs/PLAN_1C_TASKS_NOTES_2026-09-22.md).
//
// Остальные инструменты — это команда в 1С: их выполняет агент или форма. Эти лежат в ERP, и
// 1С о них ничего не знает. Единственное, что сервис обязан сделать сам, — не дать базе назвать
// чужой БИН: организация берётся из хода диалога и сверяется со списком организаций базы.
//
// Модели отдаём КОРОТКИЕ строки, а не записи ERP целиком: у задачи десяток служебных полей,
// которые в разговоре не нужны и стоят токенов на каждом ходе.

import type { ServerToolRunner } from "./workflow.ts";
import type { ChatUser } from "./workflow.ts";
import type { ToolSpec } from "../tools/registry.ts";
import { ErpRefused, ErpUnavailable, type ErpTask, type ErpNote, type ErpTasks } from "../erp/tasks.ts";
import { isBin, type BaseOrganizationsStore } from "../bases/organizations.ts";

type Outcome = { ok: true; data: unknown } | { ok: false; error: { code?: string; message?: string; details?: unknown } | null };

const taskView = (t: ErpTask) => ({
	taskId: t.uuid,
	name: t.name,
	description: t.description,
	status: t.status,
	deadline: t.deadline,
	executor: t.executorName,
	author: t.curatorName,
});

const noteView = (n: ErpNote) => ({ noteId: n.uuid, body: n.body, author: n.authorName, at: n.createdAt });

/** Организация хода: её выбрал пользователь в форме, БИН пришёл вместе с сообщением. */
function binOf(user: ChatUser): string | null {
	const bin = user.onec?.organization?.bin?.trim() ?? "";
	return isBin(bin) ? bin : null;
}

export function serverTools(deps: { tasks: ErpTasks; baseOrgs?: BaseOrganizationsStore | null }): ServerToolRunner {
	const { tasks, baseOrgs } = deps;

	return {
		// Канал ERP не в счёт: у пользователя панели задачи и так перед глазами, а организация хода
		// там не названа БИНом.
		available: (user) => user.channel === "1c" && tasks.enabled && !!binOf(user),

		/**
		 * Контекст хода: открытые задачи и последние заметки организации. Он идёт в изменчивую часть
		 * системного промпта, поэтому короткий — десять задач и пять заметок. Сбой ERP контекст не
		 * рушит: диалог продолжается без него, а модель при надобности спросит инструментом.
		 */
		async summary(user) {
			const bin = binOf(user);
			if (!bin || !tasks.enabled) return null;
			try {
				const [openTasks, notes] = await Promise.all([
					tasks.listTasks(bin, { state: "open", limit: 10 }),
					tasks.listNotes(bin, { limit: 5 }),
				]);
				if (!openTasks.length && !notes.length) return null;
				const lines: string[] = [`Контекст организации «${user.onec?.organization?.name ?? bin}» в BuhProf AI.`];
				if (openTasks.length) {
					lines.push("", "Незакрытые задачи (taskId — для update_task и complete_task):");
					for (const t of openTasks) {
						const due = t.deadline ? `, срок ${String(t.deadline).slice(0, 10)}` : "";
						const who = t.executorName ? `, исполнитель ${t.executorName}` : "";
						lines.push(`- ${t.name ?? t.description ?? "без названия"} (taskId ${t.uuid}, статус ${t.status}${due}${who})`);
					}
				}
				if (notes.length) {
					lines.push("", "Последние заметки:");
					for (const n of notes) lines.push(`- ${String(n.createdAt).slice(0, 10)} ${n.authorName ?? ""}: ${n.body.slice(0, 300)}`);
				}
				lines.push("", "Это снимок на начало хода. За свежим списком — list_tasks и list_notes.");
				return lines.join("\n");
			} catch {
				return null;
			}
		},

		async run(spec: ToolSpec, payload: Record<string, unknown>, user: ChatUser): Promise<Outcome> {
			const bin = binOf(user);
			if (!bin) {
				return { ok: false, error: { code: "NO_ORGANIZATION", message: "В форме чата не выбрана организация — задачи и заметки ведутся по организации" } };
			}
			if (baseOrgs && user.onec && !(await baseOrgs.has(user.onec.baseId, bin))) {
				return { ok: false, error: { code: "ORG_NOT_IN_BASE", message: "Эта организация не зарегистрирована за базой — в 1С откройте «Подключение к BuhProf AI» и обновите список организаций" } };
			}
			const actor = { bin, user: { name: user.onec?.userName?.trim() || "Пользователь 1С" } };

			try {
				switch (spec.commandType) {
					case "TASKS_LIST": {
						const items = await tasks.listTasks(bin, { state: payload.state === "all" ? "all" : "open", limit: Number(payload.limit) || 50 });
						return { ok: true, data: { items: items.map(taskView), count: items.length } };
					}
					case "TASKS_CREATE": {
						const item = await tasks.createTask(actor, {
							name: String(payload.name ?? ""),
							description: typeof payload.description === "string" ? payload.description : undefined,
							deadline: typeof payload.deadline === "string" ? payload.deadline : undefined,
							executorName: typeof payload.executorName === "string" ? payload.executorName : undefined,
						});
						return { ok: true, data: taskView(item) };
					}
					case "TASKS_UPDATE":
					case "TASKS_COMPLETE": {
						const item = await tasks.updateTask(actor, String(payload.taskId), {
							name: typeof payload.name === "string" ? payload.name : undefined,
							description: typeof payload.description === "string" ? payload.description : undefined,
							// Пустая строка — «снять срок»: отличается от «поля нет вовсе».
							deadline: typeof payload.deadline === "string" ? (payload.deadline.trim() || null) : undefined,
							status: typeof payload.status === "string" ? payload.status : undefined,
							close: payload.close === true,
						});
						return { ok: true, data: taskView(item) };
					}
					case "NOTES_LIST": {
						const items = await tasks.listNotes(bin, { limit: Number(payload.limit) || 50 });
						return { ok: true, data: { items: items.map(noteView), count: items.length } };
					}
					case "NOTES_ADD": {
						const item = await tasks.addNote(actor, String(payload.body ?? ""));
						return { ok: true, data: noteView(item) };
					}
					default:
						return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Инструмент ${spec.name} не умеет исполняться в сервисе` } };
				}
			} catch (e) {
				// Отказ ERP — её словами: он написан для человека. Сбой связи — отдельным кодом:
				// «повторите позже» и «исправьте данные» — разные советы.
				if (e instanceof ErpRefused) return { ok: false, error: { code: "ERP_REFUSED", message: e.message } };
				if (e instanceof ErpUnavailable) return { ok: false, error: { code: "ERP_UNAVAILABLE", message: e.message } };
				throw e;
			}
		},
	};
}
