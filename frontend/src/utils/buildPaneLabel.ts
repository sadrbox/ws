import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";

/**
 * Префикс заголовка панели формы.
 *
 * Правило: для форм используется ключ `*Form` (единственное число — «Сотрудник»,
 * Реализация товара и услуг, «Номенклатура»), с fallback на `*List` (множественное), затем
 * — переданный fallback-текст.
 *
 * Принимает имя как `*List`, так и `*Form` / `*Table` — нормализует к `*Form`.
 */
function resolveFormName(listOrFormName: string, fallback: string): string {
	const formKey = listOrFormName.endsWith("Form")
		? listOrFormName
		: listOrFormName.replace(/(List|Table)(_part)?$/, "Form");

	const fromForm = translate(formKey);
	if (fromForm && fromForm !== formKey) return fromForm;

	const fromList = translate(listOrFormName);
	if (fromList && fromList !== listOrFormName) return fromList;

	return fallback;
}

/**
 * Метка для СПРАВОЧНИКОВ: "Организация: ID 5" или "Организация: ID 5 · Рога и Копыта"
 */
export function makePaneLabel(
	listName: string,
	fallback: string,
	saved: Record<string, any>,
	displayValue?: string,
): string {
	const name = resolveFormName(listName, fallback);
	const id = saved.id;
	if (!id) return `${name}: ${translate("new")}`;
	const detail = displayValue ?? saved.name;
	return detail ? `${name}: ID ${id} · ${detail}` : `${name}: ID ${id}`;
}

/**
 * Метка для ДОКУМЕНТОВ: "Реализация товара и услуг: ID 4 · 21.04.2026"
 * dateField — имя поля даты в saved (по умолчанию "date")
 */
export function makeDocLabel(
	listName: string,
	fallback: string,
	saved: Record<string, any>,
	dateField = "date",
): string {
	const name = resolveFormName(listName, fallback);
	const id = saved.id;
	if (!id) return `${name}: ${translate("new")}`;
	// Показываем человекочитаемый номер документа, если он есть; иначе — ID.
	const ref = saved.number ? `№ ${saved.number}` : `ID ${id}`;
	const date = saved[dateField]
		? getFormatDateOnly(String(saved[dateField]))
		: undefined;
	return date ? `${name}: ${ref} · ${date}` : `${name}: ${ref}`;
}

/**
 * Метка при открытии панели из списка/таблицы (до загрузки данных).
 * Единый паттерн: "Label: ID id · detail" / "Label: ID id" / "Label: Новый"
 */
export function makePaneLabelFromData(
	listName: string,
	fallback: string,
	data?: Record<string, any> | null,
	displayValue?: string,
): string {
	const name = resolveFormName(listName, fallback);
	if (!data?.uuid && !data?.id) return `${name}: ${translate("new")}`;
	const id = data.id ?? "?";
	const detail = displayValue ?? data.name;
	return detail ? `${name}: ID ${id} · ${detail}` : `${name}: ID ${id}`;
}
