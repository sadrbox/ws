/**
 * РАСПИСАНИЕ ОБСЛУЖИВАНИЯ БАЗ (F2): выгрузка и проверка в назначенное окно, без человека.
 *
 * ЗАЧЕМ. Обслуживание запускалось только руками, и копия базы существовала ровно тогда,
 * когда о ней кто-то вспомнил. Подходящее окно при этом одно — ночь: днём в базах работают,
 * а выгрузка сотни баз занимает часы.
 *
 * ЧТО ЭТО ЗА СУЩНОСТЬ. Расписание — НАСТРОЙКА, а не журнал: прогоны становятся обычными
 * заданиями (`command_batches`), и итог по каждой базе смотрят там же, где итоги ручных
 * операций. Отсюда `last_batch_id` — ссылка на последний прогон, а не своя история.
 *
 * ПОЧЕМУ РЕШЕНИЕ «ПОРА» СЧИТАЕТСЯ ЗДЕСЬ, А НЕ В SQL. Это единственная тонкая часть задачи:
 * тик приходит не в ноль секунд, сервис перезапускают в середине окна, а расписание не
 * должно ни пропускать день, ни запускать выгрузку сотни баз дважды. Правило написано
 * чистой функцией (`isDue`) и проверено тестом на этих самых случаях.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/pool.ts";

export type MaintenanceSchedule = {
	id: string;
	organizationUuid: string;
	userUuid: string | null;
	name: string;
	type: string;
	baseKeys: string[];
	payload: Record<string, unknown>;
	/** Время запуска «ЧЧ:ММ» в зоне сервиса. */
	atTime: string;
	/** Дни недели (0 — воскресенье). Пустой массив — каждый день. */
	weekdays: number[];
	enabled: boolean;
	lastRunAt: string | null;
	lastBatchId: string | null;
};

type Row = {
	id: string; organization_uuid: string; user_uuid: string | null; name: string; type: string;
	base_keys: string[]; payload: Record<string, unknown> | null; at_time: string;
	weekdays: number[] | null; enabled: boolean;
	last_run_at: Date | null; last_batch_id: string | null;
};

/** «ЧЧ:ММ:СС» из postgres → «ЧЧ:ММ»: секунды в расписании обслуживания не нужны. */
const hhmm = (t: string): string => t.slice(0, 5);

const toView = (r: Row): MaintenanceSchedule => ({
	id: r.id,
	organizationUuid: r.organization_uuid,
	userUuid: r.user_uuid,
	name: r.name,
	type: r.type,
	baseKeys: r.base_keys ?? [],
	payload: r.payload ?? {},
	atTime: hhmm(r.at_time),
	weekdays: r.weekdays ?? [],
	enabled: r.enabled,
	lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
	lastBatchId: r.last_batch_id,
});

/** Минуты от начала суток: и для «ЧЧ:ММ», и для момента времени. */
const minutesOf = (time: string): number => {
	const [h, m] = time.split(":");
	return Number(h) * 60 + Number(m);
};

/**
 * Сколько минут после назначенного времени расписание ещё считается «пора».
 *
 * ЗАЧЕМ ОКНО. Тик приходит не в ноль секунд, а сервис могли перезапустить ровно в 02:00 —
 * без допуска расписание молча пропустило бы сутки. Час выбран не случайно: это меньше
 * любого разумного интервала между окнами и заметно больше и тика, и времени перезапуска.
 */
const WINDOW_MINUTES = 60;

/**
 * Пора ли запускать — на момент `now`, зная время последнего прогона.
 *
 * ПРАВИЛО ЦЕЛИКОМ: включено → сегодня подходящий день → время уже наступило и окно не
 * истекло → сегодня ещё не запускали. Последнее и защищает от двойного прогона: выгрузка
 * сотни баз занимает часы, и второй запуск в то же окно занял бы сеансы и лицензии у
 * первого.
 */
export function isDue(
	s: Pick<MaintenanceSchedule, "enabled" | "atTime" | "weekdays" | "lastRunAt">,
	now: Date,
): boolean {
	if (!s.enabled) return false;
	if (s.weekdays.length && !s.weekdays.includes(now.getDay())) return false;

	const nowMin = now.getHours() * 60 + now.getMinutes();
	const dueMin = minutesOf(s.atTime);
	if (nowMin < dueMin || nowMin > dueMin + WINDOW_MINUTES) return false;

	if (!s.lastRunAt) return true;
	const last = new Date(s.lastRunAt);
	// «Сегодня» — по календарю сервиса: прогон в 02:10 и тик в 02:20 того же дня.
	return !(last.getFullYear() === now.getFullYear()
		&& last.getMonth() === now.getMonth()
		&& last.getDate() === now.getDate());
}

export class ScheduleStore {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	async list(organizationUuid: string): Promise<MaintenanceSchedule[]> {
		const r = await this.db.query<Row>(
			`SELECT * FROM maintenance_schedules WHERE organization_uuid = $1 ORDER BY at_time, name`,
			[organizationUuid],
		);
		return r.rows.map(toView);
	}

	async get(id: string): Promise<MaintenanceSchedule | null> {
		const r = await this.db.query<Row>(`SELECT * FROM maintenance_schedules WHERE id = $1`, [id]);
		return r.rows[0] ? toView(r.rows[0]) : null;
	}

	/** ВСЕ включённые расписания — для тика: он смотрит их по всем организациям. */
	async enabled(): Promise<MaintenanceSchedule[]> {
		const r = await this.db.query<Row>(`SELECT * FROM maintenance_schedules WHERE enabled ORDER BY at_time`);
		return r.rows.map(toView);
	}

	async create(input: Omit<MaintenanceSchedule, "id" | "lastRunAt" | "lastBatchId">): Promise<MaintenanceSchedule> {
		const id = randomUUID();
		await this.db.query(
			`INSERT INTO maintenance_schedules
			   (id, organization_uuid, user_uuid, name, type, base_keys, payload, at_time, weekdays, enabled)
			 VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::time, $9::smallint[], $10)`,
			[id, input.organizationUuid, input.userUuid, input.name, input.type, input.baseKeys,
				JSON.stringify(input.payload ?? {}), input.atTime, input.weekdays, input.enabled],
		);
		return (await this.get(id))!;
	}

	/**
	 * Правка расписания. Переданные поля заменяются, остальные остаются как есть:
	 * переключение «включено» не должно требовать присылать весь набор баз.
	 */
	async update(id: string, patch: Partial<Omit<MaintenanceSchedule, "id" | "organizationUuid">>): Promise<MaintenanceSchedule | null> {
		const sets: string[] = [];
		const vals: unknown[] = [];
		const put = (sql: string, value: unknown) => { vals.push(value); sets.push(sql.replace("$?", `$${vals.length}`)); };

		if (patch.name !== undefined) put("name = $?", patch.name);
		if (patch.type !== undefined) put("type = $?", patch.type);
		if (patch.baseKeys !== undefined) put("base_keys = $?::text[]", patch.baseKeys);
		if (patch.payload !== undefined) put("payload = $?::jsonb", JSON.stringify(patch.payload));
		if (patch.atTime !== undefined) put("at_time = $?::time", patch.atTime);
		if (patch.weekdays !== undefined) put("weekdays = $?::smallint[]", patch.weekdays);
		if (patch.enabled !== undefined) put("enabled = $?", patch.enabled);
		if (!sets.length) return this.get(id);

		vals.push(id);
		await this.db.query(
			`UPDATE maintenance_schedules SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`,
			vals,
		);
		return this.get(id);
	}

	async remove(id: string): Promise<boolean> {
		const r = await this.db.query(`DELETE FROM maintenance_schedules WHERE id = $1`, [id]);
		return (r.rowCount ?? 0) > 0;
	}

	/**
	 * Отметить прогон.
	 *
	 * Пишется СРАЗУ после постановки задания, а не после его окончания: задание живёт часами,
	 * и до отметки тик считал бы расписание незапущенным и ставил его снова.
	 */
	async markRun(id: string, batchId: string | null): Promise<void> {
		await this.db.query(
			`UPDATE maintenance_schedules SET last_run_at = now(), last_batch_id = $2 WHERE id = $1`,
			[id, batchId],
		);
	}
}
