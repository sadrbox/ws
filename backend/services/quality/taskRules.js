// Правила задач E17 (СК1) — чистые функции без Prisma: SLA, переходы статусов, результат.
// Проверяются headless-тестом; работу с базой делает services/quality/todos.js.

import { addWorkingMinutes } from "./workTime.js";

/** Виды задач. От вида зависят SLA, правила кандидатов и эскалация. */
export const TODO_KINDS = ["task", "client_request", "error", "control", "check_finding", "regulation", "manager_order"];
export const TODO_PRIORITIES = ["low", "normal", "high", "urgent"];
/** Кто нашёл ошибку. client — п. 4 («ошибку первым выявил клиент»). */
export const REPORTED_BY = ["client", "staff", "chief", "check"];

/**
 * Коды отмены по умолчанию — только для записей справочника без признака `isCancel` (до 25.09).
 * Отмене результат не нужен: отменённая задача не выполнялась. Свой статус отмены помечают
 * признаком «Отмена» в справочнике статусов.
 */
export const CANCEL_CODES = new Set(["cancelled", "canceled", "cancel"]);

export const normKind = (v) => (TODO_KINDS.includes(v) ? v : "task");
export const normPriority = (v) => (TODO_PRIORITIES.includes(v) ? v : "normal");
export const normReportedBy = (v) => (REPORTED_BY.includes(v) ? v : null);

/**
 * Срок принятия обращения в работу по SLA (только для обращений клиента). `work` — параметры рабочего
 * времени (workTime.workOptions): срок считается в рабочих минутах, иначе — календарно.
 */
export function reactionDueAt(createdAt, priority, settings, work = null) {
	const mins = settings?.sla?.reactionMinutes?.[normPriority(priority)];
	if (!Number.isFinite(mins) || mins <= 0) return null;
	if (work) return addWorkingMinutes(createdAt, mins, work);
	return new Date(new Date(createdAt).getTime() + mins * 60_000);
}

/** Срок решения обращения по SLA — если человек не поставил свой. Часы — рабочие при `work`. */
export function resolveDueAt(createdAt, priority, settings, work = null) {
	const hours = settings?.sla?.resolveHours?.[normPriority(priority)];
	if (!Number.isFinite(hours) || hours <= 0) return null;
	if (work) return addWorkingMinutes(createdAt, hours * 60, work);
	return new Date(new Date(createdAt).getTime() + hours * 3_600_000);
}

/**
 * «Формальный» результат — то, что стандарт прямо называет не-результатом (п. 1):
 * «написала», «позвонила», «передала», «не ответили», «программа не работает».
 * Решено 25.09: сверх стандарта отвергаются и «сделано», «готово», «выполнено», «ок» — они так же ничего не
 * говорят о том, чем кончилось. Перечень повторён в сервисе ai (tools/registry.ts NOT_A_RESULT) и в панели
 * (Todos/todoRules.ts) — править вместе; главный — этот: его проверяет сервер при любом закрытии.
 */
const FORMAL_RESULT_RE = /^(написал[аи]?|позвонил[аи]?|передал[аи]?|отправил[аи]?|не ответил[аи]?|не отвечают|программа не работает|сделано|сделал[аи]?|готово|выполнено|выполнил[аи]?|ок|ok|\+|-)$/i;
export const MIN_RESULT_LENGTH = 10;

/** Текст ошибки результата или null, если результат годится. */
export function resultError(result) {
	const text = String(result ?? "").trim();
	if (!text) return "Нужен результат: что сделано. Без результата задачу не закрыть";
	const bare = text.replace(/[.!…\s]+$/u, "").trim();
	if (FORMAL_RESULT_RE.test(bare)) {
		return "«Написала», «позвонила», «передала», «не ответили», «программа не работает» — не результат. Опишите, чем закончилось";
	}
	if (text.length < MIN_RESULT_LENGTH) return `Результат слишком короткий: опишите, что сделано (не меньше ${MIN_RESULT_LENGTH} знаков)`;
	return null;
}

/** Статус из справочника по коду. */
export function statusOf(statuses, code) {
	return (statuses || []).find((s) => s.code === code) || null;
}

export function isFinalStatus(statuses, code) {
	return !!statusOf(statuses, code)?.isFinal;
}

/**
 * Отмена — финальный статус без результата. Признак `isCancel` справочника главнее кода: свой статус
 * отмены с любым кодом работает так же (25.09). Старые записи без признака — по коду.
 */
export function isCancelStatus(statuses, code) {
	const st = statusOf(statuses, code);
	if (!st?.isFinal) return false;
	return st.isCancel === true || (st.isCancel === undefined && CANCEL_CODES.has(code));
}

/**
 * Проверка перехода задачи в новый статус. null — можно, иначе текст для человека.
 * @param {{nextStatus:string, statuses:{code:string,isFinal:boolean,isWaiting?:boolean}[], result?:string|null, nextControlAt?:Date|string|null}} p
 */
export function transitionError({ nextStatus, statuses, result, nextControlAt }) {
	const st = statusOf(statuses, nextStatus);
	if (!st) return null; // неизвестный код — не наш вопрос, его отвергнет справочник
	if (st.isFinal && !isCancelStatus(statuses, st.code)) {
		const err = resultError(result);
		if (err) return err;
	}
	if (st.isWaiting && !nextControlAt) {
		return "Для статуса ожидания нужна дата следующего контроля: ожидание без даты — задача без движения";
	}
	return null;
}

/**
 * Отметки времени при смене статуса: начало работы при первом уходе из «новой», завершение
 * при переходе в финальный, сброс завершения при возврате из финального.
 */
export function transitionStamps({ prevStatus, nextStatus, statuses, startedAt, now = new Date() }) {
	const out = {};
	if (prevStatus === nextStatus) return out;
	const nextFinal = isFinalStatus(statuses, nextStatus);
	const prevFinal = isFinalStatus(statuses, prevStatus);
	if (!startedAt && nextStatus !== "new" && !nextFinal) out.startedAt = now;
	if (nextFinal && !prevFinal) out.completedAt = now;
	if (!nextFinal && prevFinal) out.completedAt = null;
	return out;
}

/**
 * Правило просрочки для кандидата в нарушения: какой пункт стандарта нарушен просрочкой.
 * check_finding — не здесь: по находкам свой срок и свой кандидат (иначе один факт дал бы
 * два нарушения). control — п. 5 (нет контроля исправления), поручение руководителя — п. 35.
 */
export function overdueItemFor(kind) {
	if (kind === "check_finding") return null;
	if (kind === "control") return 5;
	if (kind === "manager_order") return 35;
	return 20;
}

export default {
	TODO_KINDS, TODO_PRIORITIES, REPORTED_BY, CANCEL_CODES, MIN_RESULT_LENGTH,
	normKind, normPriority, normReportedBy, reactionDueAt, resolveDueAt, resultError,
	statusOf, isFinalStatus, isCancelStatus, transitionError, transitionStamps, overdueItemFor,
};
