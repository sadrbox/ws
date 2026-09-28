/**
 * Организации базы 1С, как их прочитал агент (`IB_LIST_ORGANIZATIONS`, 28.09): вкладка «Организации» карточки базы.
 *
 * Ответ агента — `{ items: [{ id?, name, bin?, main?, details? }] }`: `details` — реквизиты в формате заявки на
 * подключение (bases/orgDetails.ts), `main` — основная организация, которую 1С подставляет по умолчанию.
 *
 * РАЗБОР МЯГКИЙ, КАК У РЕКВИЗИТОВ ЗАЯВКИ: длинное обрезается, мусор отбрасывается, реквизиты без пользы — `null`. Но
 * непустой список, в котором не нашлось ни одной организации, — ошибка: такой срез не должен стирать кэш (то же
 * правило, что у пользователей и расширений, OnecRegistry.syncUsers).
 */
import { normalizeOrgDetails, type OrgDetails } from "../bases/orgDetails.ts";

export type IbOrganization = {
	/** Ключ строки кэша: ссылка 1С, иначе БИН, иначе наименование. */
	key: string;
	id: string | null;
	name: string;
	bin: string | null;
	main: boolean;
	details: OrgDetails | null;
};

const text = (v: unknown, max: number): string | null => {
	if (typeof v !== "string" && typeof v !== "number") return null;
	const s = String(v).replace(/\s+/g, " ").trim();
	return s ? s.slice(0, max) : null;
};

/**
 * Разобрать список агента. Строка без наименования — не организация и пропускается; повтор ключа — тоже. «Основная» —
 * не больше одной: первая отмеченная (две основные в одной базе значили бы, что агент ошибся, а не что их две).
 */
export function normalizeIbOrganizations(items: readonly unknown[]): IbOrganization[] {
	const out: IbOrganization[] = [];
	const keys = new Set<string>();
	let mainTaken = false;
	for (const raw of items) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const o = raw as Record<string, unknown>;
		const name = text(o.name, 300);
		if (!name) continue;
		const id = text(o.id, 100);
		// БИН — как в 1С, но без пробелов: «1802 4003 7695» и «180240037695» — одна организация.
		const bin = text(o.bin, 20)?.replace(/\s/g, "") || null;
		const key = id ? `id:${id.toLowerCase()}` : bin ? `bin:${bin}` : `name:${name.toLowerCase()}`;
		if (keys.has(key)) continue;
		keys.add(key);
		const main = o.main === true && !mainTaken;
		if (main) mainTaken = true;
		out.push({ key, id, name, bin, main, details: normalizeOrgDetails(o.details) });
	}
	if (items.length && !out.length) {
		throw new Error(`Срез организаций базы не разобран: ${items.length} записей без наименования — кэш не тронут`);
	}
	return out;
}

/**
 * ОТКУДА «ОСНОВНАЯ» (ответ агента 28.09). В Бухгалтерии для Казахстана основная организация — настройка пользователя,
 * а агент входит служебным администратором, чья личная настройка про базу ничего не говорит. Поэтому агент выводит её
 * по правилу и называет источник:
 *   single    — организация в базе одна;
 *   extension — константа расширения BuhProf «организация по умолчанию» (её задаёт администратор базы, на всю базу);
 *   users     — «основная» у всех пользователей, кто её задал, одна и та же (разные — не знаем, `main` нет).
 * Незнакомое значение — `null`: подписывать отметку источником, которого мы не понимаем, хуже, чем не подписывать.
 */
export type IbOrganizationsMainSource = "single" | "extension" | "users";

/**
 * Записка агента: что он не прочитал (С7 задачи агента 28.09). `block` — `contacts | responsible | bankAccounts` —
 * блок реквизитов, который читается одним запросом на базу, поэтому его сбой снимает эту часть реквизитов у ВСЕХ
 * организаций сразу, а список уходит целиком; `main` — не прочиталась константа расширения или настройки
 * пользователей (к реквизитам отношения не имеет: отметка «Основная» просто не выводится). `null` — записка строкой,
 * без блока: что именно не прочиталось, неизвестно.
 */
export type IbOrganizationsNote = { block: string | null; message: string };

/** Корень ответа рядом с `items`: источник отметки «Основная» и записки о непрочитанном. */
export type IbOrganizationsMeta = { mainSource: IbOrganizationsMainSource | null; notes: IbOrganizationsNote[] };

export const EMPTY_IB_ORGANIZATIONS_META: IbOrganizationsMeta = { mainSource: null, notes: [] };

const MAIN_SOURCES = new Set<string>(["single", "extension", "users"]);
const MAX_NOTES = 10;

/**
 * Разобрать корень ответа. `notes` — мягко: объекты `{ block, message }` (с агента 2026-09-28 13:57), строки или
 * одна строка — потерять записку значит показать неполные реквизиты как полные.
 */
export function ibOrganizationsMeta(raw: unknown): IbOrganizationsMeta {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_IB_ORGANIZATIONS_META;
	const o = raw as Record<string, unknown>;
	const mainSource = typeof o.mainSource === "string" && MAIN_SOURCES.has(o.mainSource)
		? o.mainSource as IbOrganizationsMainSource : null;
	const list = Array.isArray(o.notes) ? o.notes : o.notes === undefined || o.notes === null ? [] : [o.notes];
	const notes: IbOrganizationsNote[] = [];
	for (const n of list) {
		const rec = n && typeof n === "object" && !Array.isArray(n) ? n as Record<string, unknown> : null;
		const note: IbOrganizationsNote = rec
			? { block: text(rec.block, 40), message: text(rec.message ?? rec.error ?? rec.text, 300) ?? "" }
			: { block: null, message: text(n, 300) ?? "" };
		if (!note.block && !note.message) continue;
		if (!notes.some((x) => x.block === note.block && x.message === note.message)) notes.push(note);
		if (notes.length >= MAX_NOTES) break;
	}
	return { mainSource, notes };
}

/** Поля реквизитов по блокам чтения агента; шапка справочника (наименование, КБе, НДС, ОКЭД) — не блок, она читается всегда. */
const BLOCK_FIELDS: Record<string, readonly (keyof OrgDetails)[]> = {
	contacts: ["legalAddress", "actualAddress", "phones", "emails", "website"],
	responsible: ["director", "chiefAccountant"],
	bankAccounts: ["bankAccounts"],
	// Договоры (28.09): блок читается отдельным запросом; сбой — прежние договоры остаются.
	contracts: ["contracts"],
};

/**
 * Какие поля реквизитов агент на этот раз не дочитал: `null` — дочитал всё; `"all"` — есть записка без известного
 * блока, и незаполненное надёжнее считать недочитанным, чем стёртым. Записка `main` реквизитов не касается.
 */
export function unreadDetailFields(meta: IbOrganizationsMeta): ReadonlySet<keyof OrgDetails> | "all" | null {
	const blocks = meta.notes.map((n) => n.block).filter((b) => b !== "main");
	if (!blocks.length) return null;
	if (blocks.some((b) => !b || !BLOCK_FIELDS[b])) return "all";
	return new Set(blocks.flatMap((b) => BLOCK_FIELDS[b!]!));
}

const filled = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined);

/**
 * Реквизиты неполного чтения поверх прежних: в недочитанных полях (`unread`) незаполненное берётся из прежнего, всё
 * остальное — из нового среза как есть. Только недочитанные: пустое поле прочитанного блока значит «в 1С стёрли», и
 * прежнее значение держать нельзя. Разобранные реквизиты всегда несут все поля (пустые — null и []), поэтому сливаем
 * по заполненности, а не по наличию ключа.
 */
export function mergeOrgDetails(
	prev: OrgDetails | null, next: OrgDetails | null, unread: ReadonlySet<keyof OrgDetails> | "all" = "all",
): OrgDetails | null {
	if (!next) return prev;
	if (!prev) return next;
	const out = { ...next } as Record<string, unknown>;
	for (const k of Object.keys(prev) as (keyof OrgDetails)[]) {
		if ((unread === "all" || unread.has(k)) && !filled(next[k])) out[k] = prev[k];
	}
	return out as OrgDetails;
}

/**
 * Связь с «Организациями» ERP — по БИН, при каждом показе: заведённая в ERP позже связывается без нового входа в базу.
 * `erp: null` — в ERP такой нет (или у организации нет БИН). ERP не ответила (`lookup` бросил) — поля `erp` нет вовсе:
 * «не знаем» не должно выглядеть как «в ERP такой нет».
 */
export async function withErpLinks<T extends { bin: string | null }, E extends { bin: string | null }>(
	items: readonly T[],
	lookup: (bins: string[]) => Promise<E[]>,
	onError?: (e: unknown) => void,
): Promise<(T & { erp?: E | null })[]> {
	const bins = [...new Set(items.map((o) => o.bin).filter((b): b is string => !!b))];
	if (!bins.length) return items.map((o) => ({ ...o, erp: null }));
	try {
		const byBin = new Map((await lookup(bins)).flatMap((o) => (o.bin ? [[o.bin, o] as const] : [])));
		return items.map((o) => ({ ...o, erp: (o.bin && byBin.get(o.bin)) || null }));
	} catch (e) {
		onError?.(e);
		return [...items];
	}
}
