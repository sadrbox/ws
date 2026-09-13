/**
 * Группировка сообщений — ТРИ РЕЖИМА НА ВЫБОР: по объекту, по дате, без группировки.
 *
 * ЗАЧЕМ ВЫБОР. В список смотрят с двумя разными вопросами. «Что не так с ЭТИМ документом» —
 * тогда сообщения одного объекта должны стоять вместе. «Что вообще происходило, и что было
 * раньше чего» — тогда важен порядок во времени, а группа по объекту его рвёт: отказ в
 * 14:02 и замолчавший агент в 14:07 оказываются в разных местах списка. Один режим не
 * отвечает на оба вопроса, поэтому режимов три, а выбор — за человеком.
 *
 * ЧТО СЧИТАЕТСЯ ОБЪЕКТОМ. Сперва `ref.endpoint` — вид объекта в системе: реализации к
 * реализациям, базы 1С к базам 1С. Это надёжнее заголовка: заголовок у нового документа
 * меняется по мере заполнения («Реализация: б/н» → «Реализация № 12»), а вид — нет.
 * Если ссылки нет (сообщение экрана, а не записи), группой служит источник — заголовок
 * пейна. И только когда нет ни того, ни другого, запись попадает в «Прочее».
 *
 * ЧТО СЧИТАЕТСЯ ДНЁМ. День ПЕРВОГО появления записи (`firstAt`), а не последнего
 * подтверждения: «висит с утра» — это про утро, даже если источник подтвердил ошибку
 * минуту назад. День берётся в настроенном часовом поясе — через общий форматировщик дат,
 * иначе у полуночных записей день расходился бы с тем, что показано в самой строке.
 */
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import type { TechMessage } from "./store";
import { getByEndpoint } from "src/registry/modelRegistry";

/** Чем список разложен на группы. «none» — сплошная лента, свежие сверху. */
export type GroupMode = "object" | "date" | "none";

export const GROUP_MODES: GroupMode[] = ["object", "date", "none"];

/** Подписи режимов — в одном месте: их показывает переключатель, и он один. */
export const GROUP_MODE_LABEL: Record<GroupMode, string> = {
	object: "techMsgGroupObject",
	date: "techMsgGroupDate",
	none: "techMsgGroupNone",
};

export type MessageGroup = {
	/** Ключ группы — для React и для запоминания свёрнутости. */
	id: string;
	/** Заголовок: вид объекта («Реализации»), день («Сегодня») либо пусто без группировки. */
	title: string;
	/** Чем группа образована: заголовок дня и заголовок объекта выглядят по-разному. */
	kind: GroupMode;
	/** Сообщения группы: порядок хранилища, то есть свежие сверху. */
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
	"onec-base-users": "onecBaseUserCard",
	"onec-agents": "onecTabAgents",
};

/** Заголовок группы по записи: вид объекта, иначе источник, иначе «Прочее». */
export function groupTitleOf(m: TechMessage): { id: string; title: string } {
	if (m.ref?.endpoint) {
		const key = ENDPOINT_TITLE[m.ref.endpoint];
		// Вида нет в словаре — подпись из реестра моделей («Номенклатура»), и лишь затем сам endpoint.
		const title = (key && translate(key)) || getByEndpoint(m.ref.endpoint)?.label || m.ref.endpoint;
		return { id: `ref:${m.ref.endpoint}`, title };
	}
	if (m.source) return { id: `src:${m.source}`, title: m.source };
	return { id: "other", title: translate("techMessagesOther") };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** День записи в настроенном часовом поясе — он же ключ группы и её заголовок. */
export function dayTitleOf(ts: number, now = Date.now()): { id: string; title: string } {
	const day = getFormatDateOnly(new Date(ts).toISOString());
	// «Сегодня» и «Вчера» — то, как о днях говорят; остальные дни называются датой.
	if (day === getFormatDateOnly(new Date(now).toISOString())) {
		return { id: `day:${day}`, title: translate("techMsgToday") };
	}
	if (day === getFormatDateOnly(new Date(now - DAY_MS).toISOString())) {
		return { id: `day:${day}`, title: translate("techMsgYesterday") };
	}
	return { id: `day:${day}`, title: day };
}

/**
 * Разложить по группам.
 *
 * ПОРЯДОК ГРУПП зависит от режима, и это не прихоть. По объекту — по важности: где есть
 * актуальные сообщения, те выше; список, в котором «горит» третья группа сверху,
 * заставляет искать глазами то, ради чего его и открыли. По дате — строго от свежего дня
 * к старому: здесь спрашивают о ходе событий, и переставлять дни по важности значило бы
 * врать о порядке. Без группировки — одна пачка в порядке хранилища (свежие сверху).
 */
export function groupMessages(messages: TechMessage[], mode: GroupMode = "object"): MessageGroup[] {
	const countActive = (items: TechMessage[]) => items.filter((m) => m.active).length;

	if (mode === "none") {
		if (!messages.length) return [];
		return [{ id: "all", title: "", kind: "none", items: messages, active: countActive(messages) }];
	}

	const map = new Map<string, MessageGroup>();
	for (const m of messages) {
		const { id, title } = mode === "date" ? dayTitleOf(m.firstAt) : groupTitleOf(m);
		const g = map.get(id) ?? { id, title, kind: mode, items: [], active: 0 };
		g.items.push(m);
		if (m.active) g.active += 1;
		map.set(id, g);
	}
	const groups = [...map.values()];
	const freshest = (g: MessageGroup) => Math.max(...g.items.map((i) => i.lastAt));

	// Дни сортируются по ПЕРВОМУ появлению — тому же полю, по которому и собраны. Иначе
	// вчерашняя запись, подтверждённая источником минуту назад, поднимала бы вчерашний
	// день над сегодняшним: группировка говорила бы одно, а порядок — другое.
	if (mode === "date") {
		const started = (g: MessageGroup) => Math.max(...g.items.map((i) => i.firstAt));
		return groups.sort((a, b) => started(b) - started(a));
	}
	return groups.sort((a, b) =>
		(b.active > 0 ? 1 : 0) - (a.active > 0 ? 1 : 0) || freshest(b) - freshest(a));
}
