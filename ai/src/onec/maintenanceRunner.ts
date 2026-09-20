/**
 * ТИК РАСПИСАНИЯ (F2): раз в минуту смотрит, чему пора, и ставит задание.
 *
 * ПОЧЕМУ РАЗ В МИНУТУ, А НЕ «ПО СОБЫТИЮ». Окно назначают с точностью до минуты, и таймер на
 * минуту — самый простой способ его не проспать; стоит он одного запроса к своей же БД.
 * Решение «пора» принимает чистая функция `isDue` (см. schedules.ts): она же защищает от
 * двойного прогона, если тик пришёл дважды в одном окне.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Своей постановки команд: задание ставит общий `startBatch` — тот же, что
 * и у кнопки в панели. Расписание отличается от человека ровно одним: у него нет `userUuid`,
 * и в журнале это видно как работа сервиса.
 *
 * ОДИН ИНСТАНС. Сервис 1С работает в одном процессе (pm2 fork, см. ecosystem.config.js) —
 * поэтому блокировка не нужна. Если инстансов станет несколько, тик обязан взять
 * advisory-lock, иначе два процесса поставят по заданию на одно окно.
 */
import { isBatchError, startBatch, type BatchDeps } from "./batchRunner.ts";
import { isDue, type ScheduleStore } from "./schedules.ts";
import type { Audit } from "../audit/index.ts";
import type { Logger } from "../logger.ts";

export type MaintenanceTickResult = { started: number; failed: number };

/**
 * Один проход расписания. Возвращает, сколько прогонов начато и сколько не удалось
 * поставить, — по этим числам и пишется строка в журнал.
 */
export async function runDueSchedules(
	deps: BatchDeps & { schedules: ScheduleStore; audit: Audit; log: Logger },
	now = new Date(),
): Promise<MaintenanceTickResult> {
	const all = await deps.schedules.enabled();
	let started = 0;
	let failed = 0;

	for (const s of all) {
		if (!isDue(s, now)) continue;

		const r = await startBatch(deps, {
			type: s.type,
			baseKeys: s.baseKeys,
			payload: s.payload,
			organizationUuid: s.organizationUuid,
			// Сервер расписания (C10): при нескольких серверах имя базы само по себе адреса не даёт.
			serverId: s.serverId,
			// Работа сервиса, а не человека: подставлять здесь автора расписания значило бы
			// приписывать ему ночные действия, которых он не делал.
			userUuid: null,
		});

		if (isBatchError(r)) {
			// ОТМЕТКУ ВСЁ РАВНО СТАВИМ: иначе негодное расписание (например, с исчезнувшей
			// базой) пыталось бы запуститься каждую минуту всего окна.
			await deps.schedules.markRun(s.id, null);
			failed += 1;
			deps.log.warn({ scheduleId: s.id, name: s.name, reason: r.error }, "расписание обслуживания не запущено");
			await deps.audit.write({
				event: "onec.maintenance.failed", organizationUuid: s.organizationUuid,
				details: { scheduleId: s.id, name: s.name, type: s.type, reason: r.error },
			});
			continue;
		}

		await deps.schedules.markRun(s.id, r.batchId);
		started += 1;
		deps.log.info({
			scheduleId: s.id, name: s.name, type: s.type,
			total: r.total, queued: r.queued, skipped: r.skipped.length, batchId: r.batchId,
		}, "обслуживание по расписанию запущено");
		await deps.audit.write({
			event: "onec.maintenance.run", organizationUuid: s.organizationUuid,
			details: {
				scheduleId: s.id, name: s.name, type: s.type, batchId: r.batchId,
				total: r.total, queued: r.queued, skipped: r.skipped.length,
			},
		});
	}

	return { started, failed };
}
