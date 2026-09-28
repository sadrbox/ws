/**
 * Организации базы 1С, как их прочитал агент (IB_LIST_ORGANIZATIONS, 28.09): разбор ответа и кэш реестра — вкладка
 * «Организации» карточки базы.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ibOrganizationsMeta, mergeOrgDetails, normalizeIbOrganizations, unreadDetailFields, withErpLinks } from "../src/onec/ibOrganizations.ts";
import { normalizeOrgDetails } from "../src/bases/orgDetails.ts";
import { OnecRegistry } from "../src/onec/registry.ts";
import { commandRequestId, findAdminCommand } from "../src/commands/admin.ts";

describe("разбор ответа IB_LIST_ORGANIZATIONS", () => {
	it("реквизиты — в формате заявки, «Основная» — как прислала 1С, БИН без пробелов", () => {
		const [org] = normalizeIbOrganizations([{
			id: "7f3c-01", name: "ТОО Nord Beer", bin: "1802 4003 7695", main: true,
			details: {
				legalName: "Товарищество с ограниченной ответственностью «Nord Beer»", kind: "legal", kbe: "17",
				phones: ["+7 701 000 00 00"], bankAccounts: [{ iban: "KZ12 3456 7890 1234 5678", bik: "halykzka", currency: "kzt", isPrimary: true }],
				unknownField: "мусор",
			},
		}]);
		assert.equal(org.key, "id:7f3c-01");
		assert.equal(org.bin, "180240037695");
		assert.equal(org.main, true);
		assert.equal(org.details?.kind, "legal");
		assert.equal(org.details?.kbe, "17");
		assert.deepEqual(org.details?.bankAccounts, [{ iban: "KZ123456789012345678", bik: "HALYKZKA", bankName: null, currency: "KZT", isPrimary: true }]);
		assert.equal("unknownField" in (org.details ?? {}), false);
	});

	it("ключ строки: ссылка 1С, иначе БИН, иначе наименование; повтор ключа отбрасывается", () => {
		const orgs = normalizeIbOrganizations([
			{ name: "Альфа", bin: "180240037695" },
			{ name: "Альфа (дубль)", bin: "180240037695" },
			{ name: "Без БИН" },
			{ id: "", name: "Бета", bin: "" },
		]);
		assert.deepEqual(orgs.map((o) => o.key), ["bin:180240037695", "name:без бин", "name:бета"]);
		assert.equal(orgs[1].bin, null);
	});

	it("основная — не больше одной: первая отмеченная", () => {
		const orgs = normalizeIbOrganizations([
			{ id: "a", name: "Альфа", main: true },
			{ id: "b", name: "Бета", main: true },
			{ id: "c", name: "Гамма", main: "да" },
		]);
		assert.deepEqual(orgs.map((o) => o.main), [true, false, false]);
	});

	it("строки без наименования пропускаются; реквизиты без пользы — null", () => {
		const orgs = normalizeIbOrganizations([{ name: "  " }, "мусор", null, { name: "Альфа", details: { kind: "legal" } }]);
		assert.equal(orgs.length, 1);
		assert.equal(orgs[0].details, null);
	});

	it("непустой список без единой организации — ошибка (кэш не трогаем); пустой — законен", () => {
		assert.throws(() => normalizeIbOrganizations([{}, { id: "x" }]), /не разобран/);
		assert.deepEqual(normalizeIbOrganizations([]), []);
	});
});

describe("корень ответа: откуда «Основная» и что не дочитано (ответ агента 28.09)", () => {
	it("источник отметки — только известный; незнакомый и пустой — null", () => {
		for (const src of ["single", "extension", "users"]) assert.equal(ibOrganizationsMeta({ items: [], mainSource: src }).mainSource, src);
		assert.equal(ibOrganizationsMeta({ items: [], mainSource: "admin" }).mainSource, null);
		assert.equal(ibOrganizationsMeta({ items: [], mainSource: null }).mainSource, null);
		assert.deepEqual(ibOrganizationsMeta([{ name: "Альфа" }]), { mainSource: null, notes: [] });
	});

	it("записки — объектами {block, message}, строками или одной строкой; повторы и пустые отбрасываются, не больше десяти", () => {
		assert.deepEqual(ibOrganizationsMeta({ notes: "контакты: таймаут" }).notes, [{ block: null, message: "контакты: таймаут" }]);
		assert.deepEqual(ibOrganizationsMeta({ notes: [
			{ block: "responsible", message: "срез не прочитан" }, "счета: нет прав", "счета: нет прав", "  ", { error: "без блока" },
			{ block: "responsible", message: "срез не прочитан" },
		] }).notes, [
			{ block: "responsible", message: "срез не прочитан" }, { block: null, message: "счета: нет прав" }, { block: null, message: "без блока" },
		]);
		assert.equal(ibOrganizationsMeta({ notes: Array.from({ length: 15 }, (_, i) => `n${i}`) }).notes.length, 10);
	});

	it("недочитанные поля: по блокам; «main» реквизитов не касается; записка без блока — всё", () => {
		const meta = (notes: unknown[]) => ibOrganizationsMeta({ notes });
		assert.equal(unreadDetailFields(meta([])), null);
		assert.equal(unreadDetailFields(meta([{ block: "main", message: "константа не прочитана" }])), null);
		assert.deepEqual([...(unreadDetailFields(meta([{ block: "responsible", message: "x" }, { block: "bankAccounts", message: "y" }])) as Set<string>)],
			["director", "chiefAccountant", "bankAccounts"]);
		assert.equal(unreadDetailFields(meta(["что-то не прочиталось"])), "all");
		assert.equal(unreadDetailFields(meta([{ block: "newBlock", message: "z" }])), "all");
	});
});

describe("реквизиты неполного чтения поверх прежних", () => {
	const prev = normalizeOrgDetails({
		legalName: "ТОО Альфа", phones: ["+7 701 000 00 00"], director: { fullName: "Иванов И.И.", position: "Директор" },
		bankAccounts: [{ iban: "KZ123456789012345678" }],
	});

	it("недочитанный блок — прежние значения; прочитанный — как есть, даже пустой («в 1С стёрли»)", () => {
		// Агент не дочитал ответственных лиц; контакты прочитаны, и телефонов в 1С больше нет.
		const next = normalizeOrgDetails({ legalName: "ТОО «Альфа»", bankAccounts: [{ iban: "KZ999999999999999999" }] });
		const merged = mergeOrgDetails(prev, next, new Set(["director", "chiefAccountant"] as const))!;
		assert.equal(merged.legalName, "ТОО «Альфа»");
		assert.equal(merged.director?.fullName, "Иванов И.И.");
		assert.deepEqual(merged.phones, []);
		assert.equal(merged.bankAccounts[0].iban, "KZ999999999999999999");
	});

	it("что не дочитано — неизвестно («all»): незаполненное — прежнее, заполненное — новое", () => {
		const next = normalizeOrgDetails({ legalName: "ТОО «Альфа»", bankAccounts: [{ iban: "KZ999999999999999999" }] });
		const merged = mergeOrgDetails(prev, next)!;
		assert.equal(merged.legalName, "ТОО «Альфа»");
		assert.deepEqual(merged.phones, ["+7 701 000 00 00"]);
		assert.equal(merged.director?.fullName, "Иванов И.И.");
		assert.equal(merged.bankAccounts[0].iban, "KZ999999999999999999");
	});

	it("нового нет — прежнее; прежнего нет — новое", () => {
		assert.equal(mergeOrgDetails(prev, null), prev);
		assert.equal(mergeOrgDetails(null, prev), prev);
	});
});

describe("кэш организаций в реестре", () => {
	/** Заглушка пула: запоминает запросы и параметры; на SELECT отдаёт заготовленные строки. */
	const fakeDb = (selectRows: unknown[] = []) => {
		const calls: { sql: string; params: unknown[] }[] = [];
		const db = {
			query: async (sql: string, params: unknown[] = []) => {
				calls.push({ sql, params });
				return /^\s*SELECT/.test(sql) ? { rows: selectRows, rowCount: selectRows.length } : { rows: [], rowCount: 0 };
			},
		};
		return { db: db as unknown as import("../src/db/pool.ts").Db, calls };
	};

	it("срез заменяет кэш целиком: запись каждой организации, затем удаление отсутствующих", async () => {
		const { db, calls } = fakeDb();
		await new OnecRegistry(db).syncOrganizations("base-1", [
			{ id: "a", name: "Альфа", bin: "180240037695", main: true, details: { legalName: "ТОО Альфа" } },
			{ name: "Бета" },
		]);
		assert.equal(calls.length, 3);
		assert.match(calls[0].sql, /INSERT INTO base_ib_organizations/);
		// Не присланные на этот раз реквизиты остаются прежними — сбой чтения не стирает прочитанное раньше.
		assert.match(calls[0].sql, /details = COALESCE\(EXCLUDED\.details, base_ib_organizations\.details\)/);
		assert.deepEqual(calls[0].params.slice(1, 7), ["base-1", "id:a", "a", "Альфа", "180240037695", true]);
		assert.equal(JSON.parse(String(calls[0].params[7])).legalName, "ТОО Альфа");
		assert.equal(calls[1].params[7], null);
		assert.match(calls[2].sql, /DELETE FROM base_ib_organizations/);
		assert.deepEqual(calls[2].params, ["base-1", ["id:a", "name:бета"]]);
	});

	it("полный срез: реквизиты заменяются как есть (пустое поле — «в 1С стёрли»), кэш не читается", async () => {
		const { db, calls } = fakeDb();
		await new OnecRegistry(db).syncOrganizations("base-1", [{ id: "a", name: "Альфа", main: true, details: { legalName: "ТОО Альфа" } }],
			{ mainSource: "extension", notes: [] });
		assert.equal(calls.some((c) => /^\s*SELECT/.test(c.sql)), false);
		assert.equal(JSON.parse(String(calls[0].params[7])).phones.length, 0);
		// Источник отметки — свойство среза; записок нет — null, а не пустой массив.
		assert.deepEqual(calls[0].params.slice(8), ["extension", null]);
	});

	it("неполный срез (есть записки): незаполненные реквизиты берутся из кэша по одному, записки пишутся", async () => {
		const cached = normalizeOrgDetails({ legalName: "ТОО Альфа", phones: ["+7 701 000 00 00"] });
		const { db, calls } = fakeDb([{ org_key: "id:a", details: cached }]);
		await new OnecRegistry(db).syncOrganizations("base-1", [
			{ id: "a", name: "Альфа", details: { legalName: "ТОО «Альфа»" } },
			{ id: "b", name: "Бета", details: { legalName: "ТОО Бета" } },
		], { mainSource: null, notes: [{ block: "contacts", message: "таймаут" }] });
		assert.match(calls[0].sql, /SELECT org_key, details FROM base_ib_organizations/);
		const alpha = JSON.parse(String(calls[1].params[7]));
		assert.equal(alpha.legalName, "ТОО «Альфа»");
		assert.deepEqual(alpha.phones, ["+7 701 000 00 00"]);
		// Новой организации нечего подставлять — её реквизиты как есть.
		assert.deepEqual(JSON.parse(String(calls[2].params[7])).phones, []);
		assert.deepEqual(calls[1].params.slice(8), [null, JSON.stringify([{ block: "contacts", message: "таймаут" }])]);
	});

	it("записка только «main» — реквизиты заменяются как при полном чтении, кэш не читается", async () => {
		const { db, calls } = fakeDb([{ org_key: "id:a", details: normalizeOrgDetails({ legalName: "ТОО Альфа", phones: ["+7 701 000 00 00"] }) }]);
		await new OnecRegistry(db).syncOrganizations("base-1", [{ id: "a", name: "Альфа", details: { legalName: "ТОО Альфа" } }],
			{ mainSource: null, notes: [{ block: "main", message: "настройки пользователей не прочитаны" }] });
		assert.equal(calls.some((c) => /^\s*SELECT/.test(c.sql)), false);
		assert.deepEqual(JSON.parse(String(calls[0].params[7])).phones, []);
	});

	it("чтение кэша: строки и свойства среза из первой строки, незнакомое отсекается", async () => {
		const row = (name: string, main: boolean) => ({
			onec_id: name, name, bin: null, is_main: main, details: null, seen_at: new Date("2026-09-28T06:20:00Z"),
			main_source: "users", read_notes: [{ block: "bankAccounts", message: "нет прав" }],
		});
		const cache = await new OnecRegistry(fakeDb([row("Альфа", true), row("Бета", false)]).db).organizationsOfBase("base-1");
		assert.deepEqual(cache.items.map((o) => [o.name, o.main]), [["Альфа", true], ["Бета", false]]);
		assert.equal(cache.mainSource, "users");
		assert.deepEqual(cache.notes, [{ block: "bankAccounts", message: "нет прав" }]);
		const odd = await new OnecRegistry(fakeDb([{ ...row("Альфа", true), main_source: "admin", read_notes: null }]).db).organizationsOfBase("base-1");
		assert.deepEqual([odd.mainSource, odd.notes], [null, []]);
		const empty = await new OnecRegistry(fakeDb([]).db).organizationsOfBase("base-1");
		assert.deepEqual(empty, { items: [], mainSource: null, notes: [] });
	});

	it("неразобранный срез — отказ, и ни одного запроса к базе", async () => {
		const { db, calls } = fakeDb();
		await assert.rejects(() => new OnecRegistry(db).syncOrganizations("base-1", [{ id: "a" }]), /не разобран/);
		assert.deepEqual(calls, []);
	});

	it("честно пустой срез очищает кэш: организаций в базе нет", async () => {
		const { db, calls } = fakeDb();
		await new OnecRegistry(db).syncOrganizations("base-1", []);
		assert.equal(calls.length, 1);
		assert.match(calls[0].sql, /DELETE FROM base_ib_organizations/);
	});
});

describe("команда IB_LIST_ORGANIZATIONS", () => {
	it("повторные чтения одной базы склеиваются, как у пользователей", () => {
		const spec = findAdminCommand("IB_LIST_ORGANIZATIONS")!;
		assert.equal(commandRequestId(spec, { baseKey: "buh_alma" }, "buh_alma"), "IB_LIST_ORGANIZATIONS:buh_alma");
	});
});

describe("связь с «Организациями» ERP", () => {
	const erp = [{ uuid: "o-1", name: "ТОО Nord Beer", bin: "180240037695" }];

	it("по БИН: нашлась — связь, не нашлась — null; без БИН связи не бывает", async () => {
		const items = await withErpLinks(
			[{ name: "Nord", bin: "180240037695" }, { name: "Другая", bin: "990140000123" }, { name: "Без БИН", bin: null }],
			async (bins) => {
				assert.deepEqual(bins, ["180240037695", "990140000123"]);
				return erp;
			},
		);
		assert.deepEqual(items.map((o) => o.erp), [erp[0], null, null]);
	});

	it("ERP не ответила — поля erp нет вовсе, причина уходит в журнал", async () => {
		const errors: unknown[] = [];
		const items = await withErpLinks([{ name: "Nord", bin: "180240037695" }], async () => { throw new Error("ERP недоступна"); }, (e) => errors.push(e));
		assert.equal("erp" in items[0], false);
		assert.equal(errors.length, 1);
	});

	it("ни одного БИН — ERP не спрашиваем", async () => {
		let asked = false;
		const items = await withErpLinks([{ name: "Без БИН", bin: null }], async () => { asked = true; return []; });
		assert.equal(asked, false);
		assert.equal(items[0].erp, null);
	});
});
