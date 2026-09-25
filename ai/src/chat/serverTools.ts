// Инструменты, которые исполняет сам сервис: задачи и заметки организации в ERP
// (план docs/PLAN_1C_TASKS_NOTES_2026-09-22.md).
//
// Остальные инструменты — это команда в 1С: их выполняет агент или форма. Эти лежат в ERP, и
// 1С о них ничего не знает. Единственное, что сервис обязан сделать сам, — не дать базе назвать
// чужой БИН: организация берётся из хода диалога и сверяется со списком организаций базы.
//
// Модели отдаём КОРОТКИЕ строки, а не записи ERP целиком: у задачи десяток служебных полей,
// которые в разговоре не нужны и стоят токенов на каждом ходе.

import type { ServerToolRunner, ServerToolContext } from "./workflow.ts";
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
	// Связанный документ — одной подписью: модели незачем знать ни типа, ни идентификатора.
	...(t.sourceLabel ? { document: t.sourceLabel } : {}),
	// Поля стандарта качества (E17) — только когда они что-то говорят: обычная задача без напоминаний и оценки
	// не должна стоить модели лишних токенов на каждом списке.
	...(t.kind && t.kind !== "task" ? { kind: t.kind } : {}),
	...(t.result ? { result: t.result } : {}),
	...(t.reminderCount ? { reminderCount: t.reminderCount } : {}),
	...(t.clientRating ? { clientRating: t.clientRating } : {}),
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
		 *
		 * `ids` — задачи, показанные в сводке: сервис кладёт их в «виденные» идентификаторы диалога. Сводка прямо
		 * предлагает taskId для update_task и complete_task, а проверка `known` пропускала только пришедшее из
		 * результатов инструментов — и первая же попытка закрыть задачу из сводки кончалась отказом (25.09).
		 */
		async summary(user) {
			const bin = binOf(user);
			if (!bin || !tasks.enabled) return null;
			try {
				/*
				 * ЧУЖОЙ БИН — БЕЗ СВОДКИ (25.09). Организацию хода присылает форма, и run() её сверяет со списком
				 * организаций базы, а сводка — нет: база с действующим токеном, назвав чужой БИН, получала в
				 * контексте модели открытые задачи и заметки чужой организации. Проверка та же, что в run().
				 */
				if (baseOrgs && user.onec && !(await baseOrgs.has(user.onec.baseId, bin))) return null;
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
				return { text: lines.join("\n"), ids: openTasks.map((t) => t.uuid) };
			} catch {
				return null;
			}
		},

		async run(spec: ToolSpec, payload: Record<string, unknown>, user: ChatUser, ctx?: ServerToolContext): Promise<Outcome> {
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
						/*
						 * СВЯЗЬ С ДОКУМЕНТОМ (СВ7). Модель называет только идентификатор, и он уже проверен
						 * по `seenIds` — выдуманный сюда не доходит. Тип и подпись берём из того, что 1С
						 * вернула в этом диалоге: со слов модели документ мог бы оказаться «реализацией»
						 * с номером из воздуха.
						 *
						 * ТИП С ПРИСТАВКОЙ `1c:`. Документ лежит В 1С, а не в ERP: ссылка вида `sales` +
						 * чужой uuid открывала бы в панели карточку, которой там нет. Приставка говорит
						 * панели, что открыть объект нельзя, — и подпись показывается как есть.
						 */
						const documentId = typeof payload.documentId === "string" ? payload.documentId : "";
						const doc = documentId ? ctx?.documents?.[documentId] : undefined;
						if (documentId && !doc) {
							return { ok: false, error: { code: "UNKNOWN_DOCUMENT", message: "Этот документ в диалоге не встречался — связать задачу с ним нельзя" } };
						}
						const item = await tasks.createTask(actor, {
							name: String(payload.name ?? ""),
							description: typeof payload.description === "string" ? payload.description : undefined,
							deadline: typeof payload.deadline === "string" ? payload.deadline : undefined,
							executorName: typeof payload.executorName === "string" ? payload.executorName : undefined,
							...(doc ? { sourceType: `1c:${doc.type}`, sourceUuid: documentId, sourceLabel: doc.label } : {}),
							// Обращение клиента (СК1.1); иначе поле не едет, и ERP ставит обычную задачу.
							...(payload.kind === "client_request" ? { kind: "client_request" as const } : {}),
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
							// Что сделано (СК1.2): без него закрытие ERP отвергнет — и её текст дойдёт до модели как есть.
							result: typeof payload.result === "string" && payload.result.trim() ? payload.result.trim() : undefined,
						});
						return { ok: true, data: taskView(item) };
					}
					case "TASKS_REMIND": {
						const item = await tasks.remindTask(actor, String(payload.taskId), typeof payload.note === "string" ? payload.note : undefined);
						return { ok: true, data: taskView(item) };
					}
					case "TASKS_RATE": {
						const item = await tasks.rateTask(actor, String(payload.taskId), Number(payload.rating),
							typeof payload.comment === "string" ? payload.comment : undefined);
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

// ── Карточки подтверждения задач и заметок ─────────────────────────────────────

/** Что карточке известно о диалоге: подписи объектов по идентификатору и документы 1С (СВ7). */
export type ServerCardNames = {
	/** Имя объекта по id из результатов диалога; не нашлось — сам id. */
	nameOf: (id: unknown) => string;
	docs?: Record<string, { type: string; label: string }>;
};

/** Текст из вызова модели — в карточку: одной строкой и не длиннее предела, чтобы карточка оставалась карточкой. */
const clip = (v: unknown, max = 300): string => {
	const s = String(v ?? "").replace(/\s+/g, " ").trim();
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * КАРТОЧКА ПОДТВЕРЖДЕНИЯ ДЛЯ ЗАДАЧ И ЗАМЕТОК (E17). Раньше эти инструменты попадали в общую ветку карточки
 * документа 1С, и человек видел «create_task: документ » и вопрос «Создать документ?» — подтверждать было нечего
 * читать. Теперь карточка говорит, ЧТО именно уйдёт в ERP: какую задачу закрываем и с каким результатом, о чём
 * напоминаем, какую оценку ставим. `null` — инструмент не из этого набора.
 */
export function serverToolCard(tool: string, payload: Record<string, unknown>, names: ServerCardNames): string | null {
	// Задачу называем по имени из списка задач этого диалога; не нашли — идентификатором: он хотя бы честен.
	const task = () => {
		const id = String(payload.taskId ?? "");
		const name = names.nameOf(id);
		return name && name !== id ? `«${clip(name, 150)}»` : id;
	};
	switch (tool) {
		case "create_task": {
			const doc = typeof payload.documentId === "string" ? names.docs?.[payload.documentId] : undefined;
			return [
				payload.kind === "client_request" ? "Новое обращение в BuhProf AI" : "Новая задача в BuhProf AI",
				`Задача: ${clip(payload.name, 200)}`,
				payload.description ? `Подробности: ${clip(payload.description)}` : null,
				payload.deadline ? `Срок: ${clip(payload.deadline, 40)}` : null,
				payload.executorName ? `Исполнитель: ${clip(payload.executorName, 100)}` : null,
				doc ? `Документ: ${clip(doc.label, 150)}` : null,
				payload.kind === "client_request" ? "Обращение клиента: бухгалтерия должна принять его в работу в срок реакции." : null,
			].filter(Boolean).join("\n");
		}
		case "update_task":
			return [
				`Изменить задачу ${task()}`,
				payload.name !== undefined ? `Заголовок: ${clip(payload.name, 200) || "—"}` : null,
				payload.description !== undefined ? `Подробности: ${clip(payload.description) || "—"}` : null,
				payload.deadline !== undefined ? (String(payload.deadline).trim() ? `Срок: ${clip(payload.deadline, 40)}` : "Срок: снять") : null,
				payload.status ? `Статус: ${clip(payload.status, 60)}` : null,
				payload.result ? `Результат: ${clip(payload.result, 500)}` : null,
			].filter(Boolean).join("\n");
		case "complete_task":
			return [
				`Закрыть задачу ${task()}`,
				`Результат: ${clip(payload.result, 500)}`,
			].join("\n");
		case "remind_task":
			return [
				`Напомнить о задаче ${task()}`,
				payload.note ? `Комментарий: ${clip(payload.note, 500)}` : null,
				"Исполнитель получит напоминание от вашего имени.",
			].filter(Boolean).join("\n");
		case "rate_task":
			return [
				`Оценка задачи ${task()}: ${String(payload.rating)} из 5`,
				payload.comment ? `Комментарий: ${clip(payload.comment, 500)}` : null,
			].filter(Boolean).join("\n");
		case "add_note":
			return `Заметка по организации:\n${clip(payload.body, 800)}`;
		default:
			return null;
	}
}

/** Вопрос под карточкой задач и заметок; `null` — не наш инструмент, вопрос выберет общий код. */
export function serverToolQuestion(tool: string): string | null {
	const q: Record<string, string> = {
		create_task: "Поставить задачу?",
		update_task: "Изменить задачу?",
		complete_task: "Закрыть задачу?",
		remind_task: "Отправить напоминание?",
		rate_task: "Сохранить оценку?",
		add_note: "Записать заметку?",
	};
	return q[tool] ?? null;
}
