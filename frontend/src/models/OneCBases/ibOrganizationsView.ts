/**
 * Строки вкладки «Организации» карточки базы 1С (IbOrganizations) — без React, отдельным модулем: в модуле-компоненте
 * только компоненты (Fast Refresh, памятка reference_fast_refresh_hubs), а правила показа проверяются тестами.
 *
 * Организации — как их прочитал агент у самой базы (`IB_LIST_ORGANIZATIONS`, 28.09): полный набор реквизитов в
 * формате заявки на подключение, «Основная» — та, что 1С подставляет по умолчанию, связь со справочником
 * «Организации» ERP — по БИН.
 */
import { translate } from "src/i18";
import { getFormatDate } from "src/utils/datetime";
import type { TDataItem } from "src/components/Table/types";
import { withStableIds } from "src/utils/stableRowId";
import type { IbOrganization, IbOrganizationsMainSource, IbOrganizationsNote } from "src/services/onec/api";

export type IbOrgRow = TDataItem & {
	/** Ключ строки: ссылка 1С, иначе БИН, иначе наименование. */
	uuid: string;
	/**
	 * Основная организация базы. Не колонкой (28.09): строка полужирная (Table.highlightPrimary), а звёздочка на
	 * панели таблицы горит, когда курсор на ней, — как у основной записи во вложенных «Контактах».
	 */
	isPrimary: boolean;
	/** Организация ERP, с которой связана строка (для открытия её карточки); `null` — связи нет. */
	__erpUuid: string | null;
	/** БИН без «—»: пустой — организацию ERP по этой строке не создать и не найти. */
	__bin: string | null;
	/** ERP ответила, и организации с этим БИН в ней нет — её можно создать из реквизитов 1С. */
	__erpMissing: boolean;
};

/** В ERP организации с этим БИН нет. Поля `erp` нет вовсе — ERP не ответила: «не знаем» не выдаём за «нет». */
export const erpMissing = (o: Pick<IbOrganization, "bin" | "erp">): boolean => o.erp === null && !!o.bin?.trim();

/** Колонка «Организация ERP»: имя связанной, «нет в ERP» — если такой нет; без БИН связи не бывает. */
export function erpText(o: Pick<IbOrganization, "bin" | "erp">): string {
	if (o.erp) return o.erp.name;
	return erpMissing(o) ? translate("onecReqOrgMissing") : "—";
}

/**
 * Организации в порядке таблицы — с ключом строки (ссылка 1С, иначе БИН, иначе наименование и место). Порядок:
 * основная первой, дальше по наименованию — ради неё вкладку чаще всего и открывают. Одна функция и для строк, и для
 * поиска исходной записи по активной строке: ключи обязаны совпадать.
 */
export function keyedOrganizations(items: readonly IbOrganization[]): { key: string; org: IbOrganization }[] {
	const ordered = [...items].sort((a, b) => Number(b.main === true) - Number(a.main === true)
		|| (a.name || "").localeCompare(b.name || "", "ru"));
	return ordered.map((org, i) => ({ key: org.id?.trim() || org.bin?.trim() || `${org.name}#${i}`, org }));
}

/**
 * Строки таблицы: значения колонок — текстом, как их видят поиск и сортировка; признаки для действий — отдельно.
 *
 * ТОЛЬКО ТО, ПО ЧЕМУ ОРГАНИЗАЦИЮ УЗНАЮТ (28.09): наименование, БИН, организация ERP, полное наименование, когда
 * прочитано. Счета, ответственные лица, контакты, НДС и ОКЭД — в карточке «Организация базы 1С» (двойной щелчок):
 * в строке таблицы они растягивали её на три экрана и всё равно читались обрезанными.
 */
export function ibOrganizationRows(items: readonly IbOrganization[]): IbOrgRow[] {
	// Ключ — до раздачи номеров: withStableIds кладёт номер строки в `id`, а у организации `id` — ссылка 1С.
	return withStableIds(keyedOrganizations(items), (x) => x.key).map(({ id, key, org: o }) => {
		const dash = (v: string | null | undefined) => v || "—";
		return {
			id,
			uuid: key,
			isPrimary: o.main === true,
			name: dash(o.name),
			binIin: dash(o.bin?.trim()),
			onecReqErpOrg: erpText(o),
			legalName: dash(o.details?.legalName),
			seenAtLabel: o.seenAt ? getFormatDate(o.seenAt) : "—",
			__erpUuid: o.erp?.uuid ?? null,
			__bin: o.bin?.trim() || null,
			__erpMissing: erpMissing(o),
		};
	});
}

const MAIN_SOURCE_TEXT: Record<IbOrganizationsMainSource, string> = {
	single: "onecOrgMainSourceSingle",
	extension: "onecOrgMainSourceExtension",
	users: "onecOrgMainSourceUsers",
};

/**
 * Строка под подсказкой вкладки: откуда отметка «Основная» (ответ агента 28.09). Основная организация в Бухгалтерии
 * для Казахстана — настройка пользователя, и агент выводит её по правилу; выведенное из настроек пользователей не
 * должно читаться как свойство базы, поэтому источник называем словами.
 *
 * Отметки нет при нескольких организациях — так и говорим: иначе пустая колонка выглядит как недочитанная. Отметка
 * есть, а источник не назван (сервис или агент старее) — молчим, а не выдумываем источник.
 */
export function mainSourceText(items: readonly Pick<IbOrganization, "main">[], mainSource: IbOrganizationsMainSource | null | undefined): string | null {
	const hasMain = items.some((o) => o.main === true);
	if (hasMain) return mainSource ? translate(MAIN_SOURCE_TEXT[mainSource]) : null;
	return items.length > 1 ? translate("onecOrgMainSourceNone") : null;
}

const BLOCK_LABEL: Record<string, string> = {
	contacts: "onecOrgNoteContacts",
	responsible: "onecOrgNoteResponsible",
	bankAccounts: "onecOrgNoteBankAccounts",
	contracts: "onecOrgNoteContracts",
};

const noteLine = (n: IbOrganizationsNote): string => {
	const block = n.block && BLOCK_LABEL[n.block] ? translate(BLOCK_LABEL[n.block]) : n.block && n.block !== "main" ? n.block : "";
	// Агент может назвать блок сам («договоры: <текст платформы>», ответ агента 28.09 18:27) — второй раз не повторяем.
	if (block && n.message.toLowerCase().startsWith(`${block.toLowerCase()}:`)) return n.message;
	return [block, n.message].filter(Boolean).join(": ");
};

/**
 * Записки агента о непрочитанном (С7): реквизиты — отдельно от источника «Основной». Блок реквизитов не прочитался —
 * вкладка предупреждает, что часть реквизитов по прошлому чтению; `main` — только поясняет, почему отметки нет, и
 * реквизиты при этом полные. Записка без блока — к реквизитам: что не прочиталось, неизвестно.
 */
export function organizationNotes(notes: readonly IbOrganizationsNote[] | undefined): { details: string | null; main: string | null } {
	const list = notes ?? [];
	const details = list.filter((n) => n.block !== "main").map(noteLine).filter(Boolean);
	const main = list.filter((n) => n.block === "main").map((n) => n.message).filter(Boolean);
	return { details: details.length ? details.join("; ") : null, main: main.length ? main.join("; ") : null };
}
