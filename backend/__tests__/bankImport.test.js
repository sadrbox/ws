// T8.1 — импорт банковских выписок: парсер (1С/CSV) + сервис импорта (направление,
// дедуп, резолв контрагента). HEADLESS: парсер чистый, сервис на мок-клиенте.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse1C, parseCsv, parseMT940, parseBankStatement, normalizeAccount } from "../services/bank/parseStatement.js";
import { importBankStatements, matchDocuments } from "../services/bank/importBankStatements.js";

const ORG_IBAN = "KZ1234567890";

const SAMPLE_1C = `1CClientBankExchange
ВерсияФормата=1.03
Кодировка=Windows
Отправитель=Банк
РасчСчет=KZ12 3456 7890
ДатаНачала=01.08.2026
ДатаКонца=31.08.2026
СекцияДокумент=Платежное поручение
Номер=101
Дата=05.08.2026
Сумма=15000,50
ПлательщикСчет=KZ1234567890
Плательщик=ТОО Наша Компания
ПлательщикБИН=111111111111
ПолучательСчет=KZ9999888877
Получатель=ТОО Поставщик
ПолучательБИН=222222222222
НазначениеПлатежа=Оплата за товар
КонецДокумента
СекцияДокумент=Платежное поручение
Номер=102
Дата=06.08.2026
Сумма=8000.00
ПлательщикСчет=KZ5555444433
Плательщик=ТОО Покупатель
ПлательщикБИН=333333333333
ПолучательСчет=KZ1234567890
Получатель=ТОО Наша Компания
ПолучательБИН=111111111111
НазначениеПлатежа=Поступление оплаты
КонецДокумента
КонецФайла`;

test("parse1C: секции документов → нормализованные движения", () => {
	const { format, ownerAccount, movements } = parse1C(SAMPLE_1C);
	assert.equal(format, "1c");
	assert.equal(ownerAccount, "KZ1234567890"); // пробелы срезаны
	assert.equal(movements.length, 2);
	const [a, b] = movements;
	assert.equal(a.number, "101");
	assert.equal(a.date, "2026-08-05T00:00:00.000Z");
	assert.equal(a.amount, 15000.5); // «15000,50» → число
	assert.equal(a.payerAccount, "KZ1234567890");
	assert.equal(a.payeeBin, "222222222222");
	assert.equal(a.purpose, "Оплата за товар");
	assert.equal(b.number, "102");
	assert.equal(b.amount, 8000);
});

test("parseBankStatement: сигнатура 1CClientBankExchange распознаётся", () => {
	assert.equal(parseBankStatement(SAMPLE_1C).format, "1c");
	assert.equal(parseBankStatement("дата;сумма\n01.08.2026;100").format, "csv");
});

test("parseCsv: заголовки-синонимы + явное направление", () => {
	const csv = `Дата;Номер;Сумма;Плательщик;ПлательщикБИН;Получатель;ПолучательБИН;Назначение;Направление
05.08.2026;7;1000,00;ТОО А;111;ТОО Б;222;За услуги;расход`;
	const { movements } = parseCsv(csv);
	assert.equal(movements.length, 1);
	const m = movements[0];
	assert.equal(m.number, "7");
	assert.equal(m.date, "2026-08-05T00:00:00.000Z");
	assert.equal(m.amount, 1000);
	assert.equal(m.payerBin, "111");
	assert.equal(m.payeeName, "ТОО Б");
	assert.equal(m.explicitDirection, "out");
});

test("normalizeAccount: пробелы срезаются, верхний регистр", () => {
	assert.equal(normalizeAccount("kz12 3456 7890"), "KZ1234567890");
});

const SAMPLE_MT940 = `{1:F01BANKKZKAXXX0000000000}{4:
:20:STMT001
:25:KZ1234567890
:28C:1/1
:60F:C260801KZT10000,00
:61:2608050805D15000,50NTRFNONREF//REF101
:86:ТОО Поставщик оплата за товар
:61:2608060806C8000,00NTRFNONREF//REF102
:86:ТОО Покупатель поступление
:62F:C260831KZT3000,00
-}`;

test("parseMT940: теги :25:/:61:/:86: → движения, направление из D/C", () => {
	const { format, ownerAccount, movements } = parseMT940(SAMPLE_MT940);
	assert.equal(format, "mt940");
	assert.equal(ownerAccount, "KZ1234567890");
	assert.equal(movements.length, 2);
	const [a, b] = movements;
	assert.equal(a.date, "2026-08-05T00:00:00.000Z");
	assert.equal(a.amount, 15000.5);
	assert.equal(a.explicitDirection, "out"); // D
	assert.equal(a.number, "REF101");
	assert.match(a.purpose, /Поставщик/);
	assert.equal(b.explicitDirection, "in"); // C
	assert.equal(b.amount, 8000);
});

test("parseBankStatement: MT940 распознаётся по :61: / {1:", () => {
	assert.equal(parseBankStatement(SAMPLE_MT940).format, "mt940");
});

test("import MT940: направление из D/C, контрагент из :86:", async () => {
	const client = makeClient();
	const r = await importBankStatements(client, {
		text: SAMPLE_MT940, organizationUuid: "org1", bankAccountUuid: "acc1", authorUuid: "user1",
	});
	assert.equal(r.imported, 2);
	assert.equal(r.unresolved, 0);
	assert.equal(client.created[0].direction, "bankStatementOut");
	assert.match(client.created[0].comment, /Поставщик/);
	assert.equal(client.created[1].direction, "bankStatementIn");
});

// ── Сервис импорта на мок-клиенте ──────────────────────────────────────────────
function makeClient({ existingDup = false } = {}) {
	const created = [];
	let n = 0;
	return {
		created,
		bankAccount: { findUnique: async () => ({ uuid: "acc1", iban: ORG_IBAN }) },
		bankStatement: {
			findFirst: async () => (existingDup ? { uuid: "dup" } : null),
			create: async ({ data }) => { created.push(data); return { uuid: `bs-${++n}`, ...data }; },
		},
		counterparty: {
			findFirst: async ({ where }) => (where.bin === "222222222222" ? { uuid: "cp-existing" } : null),
			create: async ({ data }) => ({ uuid: `cp-${++n}`, ...data }),
		},
		// Z10-автопривязка: по умолчанию совпадений нет.
		contract: { findFirst: async () => null },
		paymentInvoice: { findMany: async () => [] },
	};
}

test("import: направление по IBAN счёта, контрагент = другая сторона", async () => {
	const client = makeClient();
	const r = await importBankStatements(client, {
		text: SAMPLE_1C, organizationUuid: "org1", bankAccountUuid: "acc1", authorUuid: "user1",
	});
	assert.equal(r.total, 2);
	assert.equal(r.imported, 2);
	assert.equal(r.skipped, 0);
	assert.equal(r.unresolved, 0);
	// Док 1: плательщик = наш счёт → расход, контрагент = получатель (найден по БИН).
	assert.equal(client.created[0].direction, "bankStatementOut");
	assert.equal(client.created[0].counterpartyUuid, "cp-existing");
	assert.equal(client.created[0].posted, false);
	// Док 2: получатель = наш счёт → приход.
	assert.equal(client.created[1].direction, "bankStatementIn");
});

test("import: дубли пропускаются (повторный импорт)", async () => {
	const client = makeClient({ existingDup: true });
	const r = await importBankStatements(client, {
		text: SAMPLE_1C, organizationUuid: "org1", bankAccountUuid: "acc1", authorUuid: "user1",
	});
	assert.equal(r.imported, 0);
	assert.equal(r.skipped, 2);
	assert.equal(client.created.length, 0);
});

test("import: движение без совпадения счёта → unresolved (не создаём)", async () => {
	const client = makeClient(); // счёт орг = KZ1234567890
	// Ни счёт орг, ни owner-счёт файла не совпадают со сторонами документов.
	const text = SAMPLE_1C
		.replace(/KZ1234567890/g, "KZ7777666655")           // бывший «наш» счёт → чужой
		.replace("РасчСчет=KZ12 3456 7890", "РасчСчет=KZ8888000011"); // owner-счёт тоже чужой
	const r = await importBankStatements(client, {
		text, organizationUuid: "org1", bankAccountUuid: "acc1", authorUuid: "user1",
	});
	assert.equal(r.imported, 0);
	assert.equal(r.unresolved, 2);
});

// ── Z10: автопривязка (договор + счёт по сумме) ────────────────────────────────
test("matchDocuments: договор контрагента + счёт по точной сумме (однозначно)", async () => {
	const client = {
		contract: { findFirst: async ({ where }) => (where.counterpartyUuid === "cp1" ? { uuid: "ctr1" } : null) },
		paymentInvoice: { findMany: async ({ where }) => (where.amount === 15000.5 ? [{ uuid: "pi1", number: "77" }] : []) },
	};
	const m = await matchDocuments(client, { counterpartyUuid: "cp1", organizationUuid: "org1", amount: 15000.5 });
	assert.equal(m.contractUuid, "ctr1");
	assert.deepEqual(m.basis, { basisDocumentType: "payment_invoice", basisDocumentUuid: "pi1", basisDocumentLabel: "№ 77" });
});

test("matchDocuments: несколько счётов с той же суммой → не привязываем (неоднозначно)", async () => {
	const client = {
		contract: { findFirst: async () => null },
		paymentInvoice: { findMany: async () => [{ uuid: "a" }, { uuid: "b" }] },
	};
	const m = await matchDocuments(client, { counterpartyUuid: "cp1", amount: 100 });
	assert.equal(m.basis, null);
	assert.equal(m.contractUuid, null);
});

test("import: автопривязка проставляет contractUuid и основание, считает matched", async () => {
	const client = makeClient();
	client.contract.findFirst = async () => ({ uuid: "ctr1" });
	client.paymentInvoice.findMany = async () => [{ uuid: "pi1", number: "77" }];
	const r = await importBankStatements(client, { text: SAMPLE_1C, organizationUuid: "org1", bankAccountUuid: "acc1", authorUuid: "u1" });
	assert.equal(r.imported, 2);
	assert.equal(r.matched, 2);
	assert.equal(client.created[0].contractUuid, "ctr1");
	assert.equal(client.created[0].basisDocumentType, "payment_invoice");
	assert.equal(client.created[0].basisDocumentUuid, "pi1");
});

test("import: match=false отключает автопривязку", async () => {
	const client = makeClient();
	client.contract.findFirst = async () => ({ uuid: "ctr1" });
	const r = await importBankStatements(client, { text: SAMPLE_1C, organizationUuid: "org1", bankAccountUuid: "acc1", authorUuid: "u1", match: false });
	assert.equal(r.matched, 0);
	assert.equal(client.created[0].contractUuid ?? null, null);
});

test("import: authorUuid и bankAccountUuid обязательны", async () => {
	const client = makeClient();
	await assert.rejects(() => importBankStatements(client, { text: SAMPLE_1C, bankAccountUuid: "acc1" }), /authorUuid/);
	await assert.rejects(() => importBankStatements(client, { text: SAMPLE_1C, authorUuid: "u1" }), /bankAccountUuid/);
});
