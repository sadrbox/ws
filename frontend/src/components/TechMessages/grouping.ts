/**
 * Группировка сообщений ПО НАЗНАЧЕНИЮ ОБЪЕКТА.
 *
 * ЗАЧЕМ. Плоский список из сорока строк не отвечает на вопрос, с которым в него смотрят:
 * «что не так с ЭТИМ документом». Сообщения одного объекта должны стоять вместе, а
 * заголовок группы — называть объект, а не абстрактный «источник».
 *
 * ЧТО СЧИТАЕТСЯ НАЗНАЧЕНИЕМ. Сперва `ref.endpoint` — вид объекта в системе: реализации к
 * реализациям, базы 1С к базам 1С. Это надёжнее заголовка: заголовок у нового документа
 * меняется по мере заполнения («Реализация: б/н» → «Реализация № 12»), а вид — нет.
 * Если ссылки нет (сообщение экрана, а не записи), группой служит источник — заголовок
 * пейна. И только когда нет ни того, ни другого, запись попадает в «Прочее».
 */
import { translate } from "src/i18";
import type { TechMessage } from "./store";

export type MessageGroup = {
	/** Ключ группы — для React и для запоминания свёрнутости. */
	id: string;
	/** Заголовок: вид объекта («Реализации») либо заголовок формы. */
	title: string;
	/** Сообщения группы: сперва актуальные, внутри — свежие сверху. */
	items: TechMessage[];
	/** Сколько из них актуальны сейчас — по этому числу группа и важна. */
	active: number;
};

/**
 * Подпись вида объекта по его endpoint.
 *
 * Словарь взят из навигации по уведомлениям (Navbar: NOTE_ENTITY_KEY) — он уже был и уже
 * выверен по словарю переводов; заводить второй значило бы получить два списка, которые
 * обязаны совпадать. Не нашлось — показываем сам endpoint: сырое имя честнее выдуманного.
 */
export const ENDPOINT_TITLE: Record<string, string> = {
	sales: "sale",
	purchases: "purchase",
	salereturns: "saleReturn",
	purchasereturns: "purchaseReturn",
	inventorytransfers: "inventoryTransfer",
	cashreceiptorders: "cashReceiptOrder",
	counterparties: "counterparty",
	contracts: "contract",
	organizations: "organization",
	employees: "employee",
	contacts: "contact",
	contactpersons: "contactPerson",
	bankaccounts: "bankAccount",
	"onec-bases": "onecBase",
};

/** Заголовок группы по записи: вид объекта, иначе источник, иначе «Прочее». */
export function groupTitleOf(m: TechMessage): { id: string; title: string } {
	if (m.ref?.endpoint) {
		const key = ENDPOINT_TITLE[m.ref.endpoint];
		const title = (key && translate(key)) || m.ref.endpoint;
		return { id: `ref:${m.ref.endpoint}`, title };
	}
	if (m.source) return { id: `src:${m.source}`, title: m.source };
	return { id: "other", title: translate("techMessagesOther") };
}

/**
 * Разложить по группам. Порядок групп — по важности: где есть актуальные сообщения, те
 * выше; при равенстве — где запись свежее. Список, в котором «горит» третья группа
 * сверху, заставляет искать глазами то, ради чего его и открыли.
 */
export function groupMessages(messages: TechMessage[]): MessageGroup[] {
	const map = new Map<string, MessageGroup>();
	for (const m of messages) {
		const { id, title } = groupTitleOf(m);
		const g = map.get(id) ?? { id, title, items: [], active: 0 };
		g.items.push(m);
		if (m.active) g.active += 1;
		map.set(id, g);
	}
	const freshest = (g: MessageGroup) => Math.max(...g.items.map((i) => i.lastAt));
	return [...map.values()].sort((a, b) =>
		(b.active > 0 ? 1 : 0) - (a.active > 0 ? 1 : 0) || freshest(b) - freshest(a));
}
