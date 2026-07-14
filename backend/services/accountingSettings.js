// ─────────────────────────────────────────────────────────────────────────────
// Параметры учёта организации: какая ВЕРСИЯ действовала на дату.
//
// Настройки версионируются: каждое сохранение — новая запись со своим startDate.
// Так и должно быть: от них зависят уже проведённые документы. Метод себестоимости,
// ставка и признак НДС берутся не «текущие», а ДЕЙСТВОВАВШИЕ НА ДАТУ ДОКУМЕНТА —
// иначе переключение на ФИФО переписало бы себестоимость всей истории, включая
// закрытые периоды, а снятие галки «плательщик НДС» задним числом убрало бы НДС из
// прошлых реализаций.
//
// ЧТО БЫЛО СЛОМАНО: сохранение помечало прошлые версии `deletedAt`, а resolveCostingMethod/
// resolveUseVat фильтровали `deletedAt: null` — история вычищалась из выборки, и на дату
// документа не находилось НИ ОДНОЙ версии → возвращался дефолт. То самое переписывание
// истории, которое версионирование и должно было предотвратить.
//
// ТЕПЕРЬ два смысла разделены:
//   • прошлая версия — АРХИВ: живёт в истории, deletedAt не ставится;
//   • deletedAt — только настоящее удаление записи (её не должно быть в расчётах).
//
// Тай-брейк по id: версий с ОДНИМ startDate бывает несколько (правку сделали в тот же
// день). Порядок между ними по startDate не определён — берём последнюю созданную.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/**
 * Версия параметров учёта, действовавшая на дату.
 *
 * @param {string|null} orgUuid
 * @param {Date|string|null} date — дата документа; null → последняя версия.
 * @param {object} [client] — prisma или tx.
 * @returns {Promise<object|null>}
 */
export async function getSettingsAt(orgUuid, date = null, client = prisma) {
	if (!orgUuid) return null;

	const at = date ? new Date(date) : null;
	const dated = at && !Number.isNaN(at.getTime());

	const where = { organizationUuid: orgUuid, deletedAt: null };
	if (dated) where.startDate = { lte: at };

	const found = await client.organizationAccountingSetting.findFirst({
		where,
		orderBy: [{ startDate: "desc" }, { id: "desc" }],
	});
	if (found) return found;

	// На дату документа настроек ещё не было (документ старше первой версии) — берём
	// САМУЮ РАННЮЮ. Это ближе к истине, чем «дефолт»: организация вела учёт как-то и
	// до того, как параметры завели в системе, и первая версия описывает именно её.
	if (dated) {
		return client.organizationAccountingSetting.findFirst({
			where: { organizationUuid: orgUuid, deletedAt: null },
			orderBy: [{ startDate: "asc" }, { id: "asc" }],
		});
	}
	return null;
}

export default { getSettingsAt };
