/**
 * Итог постановки заданий — чистые правила (И26 аудита 26.09).
 *
 * «queued: 0» — сервис принял запрос (202), но ни одна команда не встала в очередь: агент не на
 * связи или не умеет команду. Раньше «Пользователь базы», его команды и помощник показывали на это
 * зелёное «Поставлено в очередь», стирали черновик ролей и пароль и закрывали окно — человек уходил
 * ждать того, что не начиналось. Теперь при нуле ввод остаётся, а итог говорит reportBatchStart.
 *
 * Отдельным модулем: в модуле с компонентами не-компонентный экспорт ломает Fast Refresh.
 */
import type { BatchStart } from "src/services/onec/api";

/** Несколько постановок (по базе или по группе баз) — одним итогом для сообщения. */
export function sumBatchStarts(list: readonly BatchStart[]): BatchStart {
	return {
		batchId: list.length === 1 ? list[0].batchId : "",
		total: list.reduce((n, r) => n + r.total, 0),
		queued: list.reduce((n, r) => n + r.queued, 0),
		skipped: list.flatMap((r) => r.skipped),
	};
}

/** Ничего не встало в очередь: ввод не стираем, окно не закрываем. */
export const nothingQueued = (r: Pick<BatchStart, "queued">): boolean => !(r.queued > 0);
