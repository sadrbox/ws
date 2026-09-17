/**
 * ЗАПУСК ГРУППОВОЙ КОМАНДЫ — один путь для помощника и для меню «Операции».
 *
 * Помощник спрашивает базы и параметры по шагам; меню «Операции» выполняет команду сразу по ОТМЕЧЕННЫМ базам
 * (17.09) — но заводится задание и ведётся запись о работе одинаково, иначе «Прогресс» и «Задания» показывали бы
 * одно и то же двумя способами.
 *
 * Отдельным модулем: в модуле с компонентом не-компонентный экспорт ломает Fast Refresh всему файлу.
 */
import { translate } from "src/i18";
import { runBatch, type BatchType } from "src/services/onec/api";
import { attachBatch, finishOp, startOp, type OpKind } from "./progress";

export type GroupRunSpec = { type: BatchType; title: string; kind: OpKind };

/** Поставить задание по базам. Запись о работе заводится до отправки и закрывается при отказе. */
export async function runGroupCommand(
	spec: GroupRunSpec, targets: string[], payload: Record<string, unknown> = {},
) {
	const opId = startOp({
		kind: spec.kind, title: translate(spec.title),
		target: `${translate("onecBases")}: ${targets.length}`,
		total: targets.length, scope: { bases: targets },
	});
	try {
		const r = await runBatch(spec.type, targets, payload);
		attachBatch(opId, r.batchId, r.total,
			r.skipped.length ? `${translate("onecBatchSkipped")}: ${r.skipped.length}` : "");
		return r;
	} catch (e) {
		finishOp(opId, { failed: targets.length, note: e instanceof Error ? e.message : String(e), error: e });
		throw e;
	}
}
