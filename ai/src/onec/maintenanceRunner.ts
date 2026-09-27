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
 * ОКНО ЗАНИМАЕТСЯ ДО ПОСТАНОВКИ (Н9 аудита 26.09). Раньше отметка прогона ставилась после `startBatch`: сбой
 * посреди постановки (БД на enqueue) или перезапуск процесса в это время оставляли расписание «не запускавшимся»,
 * и каждую минуту часового окна ставилось новое задание — первые базы получали IB_BACKUP по кругу. Теперь окно
 * занимается одной атомарной записью (`claimRun`, сравнение с прочитанным `last_run_at`): второй тик и второй
 * процесс его уже не получат. Исключение одного расписания не прерывает остальные.
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
	deps: BatchDeps & {
		schedules: Pick<ScheduleStore, "enabled" | "claimRun" | "markRun">; audit: Pick<Audit, "write">; log: Pick<Logger, "info" | "warn">;
		/**
		 * Серверы, на которые вправе идти расписание организации (C11, режим ONEC_SERVER_SCOPE=organizations); null —
		 * все. Без него ночной запуск шёл без `allowedServers` и мог уйти на сервер чужого клиента (аудит 26.09).
		 */
		serversOf?: ((organizationUuid: string) => Promise<ReadonlySet<string> | null>) | null;
	},
	now = new Date(),
): Promise<MaintenanceTickResult> {
	const all = await deps.schedules.enabled();
	let started = 0;
	let failed = 0;

	for (const s of all) {
		if (!isDue(s, now)) continue;
		// Окно — атомарно и ДО постановки: не получили — его занял другой тик или процесс.
		if (!(await deps.schedules.claimRun(s.id, s.lastRunAt))) continue;

		let r: Awaited<ReturnType<typeof startBatch>>;
		try {
			const allowedServers = deps.serversOf ? await deps.serversOf(s.organizationUuid) : null;
			if (allowedServers && s.serverId && !allowedServers.has(s.serverId)) {
				r = { error: "сервер расписания не принадлежит организации расписания" };
			} else {
				r = await startBatch(deps, {
					type: s.type,
					baseKeys: s.baseKeys,
					payload: s.payload,
					organizationUuid: s.organizationUuid,
					// Сервер расписания (C10): при нескольких серверах имя базы само по себе адреса не даёт.
					serverId: s.serverId,
					allowedServers,
					// Работа сервиса, а не человека: подставлять здесь автора расписания значило бы
					// приписывать ему ночные действия, которых он не делал.
					userUuid: null,
				});
			}
		} catch (e) {
			r = { error: `сбой постановки: ${e instanceof Error ? e.message : String(e)}` };
		}

		if (isBatchError(r)) {
			// Окно уже занято: негодное расписание (например, с исчезнувшей базой) или сбой не повторяются
			// каждую минуту окна — только в следующее окно.
			failed += 1;
			deps.log.warn({ scheduleId: s.id, name: s.name, reason: r.error }, "расписание обслуживания не запущено");
			await deps.audit.write({
				event: "onec.maintenance.failed", organizationUuid: s.organizationUuid,
				details: { scheduleId: s.id, name: s.name, type: s.type, reason: r.error },
			}).catch(() => {});
			continue;
		}

		await deps.schedules.markRun(s.id, r.batchId).catch((e: unknown) =>
			deps.log.warn({ scheduleId: s.id, err: e instanceof Error ? e.message : String(e) }, "расписание: задание не записано в отметку"));
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
		}).catch(() => {});
	}

	return { started, failed };
}
