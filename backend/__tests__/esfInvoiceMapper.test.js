// Юнит-тесты маппера ЭСФ (buildInvoiceV2Xml) и валидатора (validateEsfInvoice) —
// чистые функции, без БД. Проверяем: обязательный минимум, порядок элементов по
// InvoiceV2.xsd (xs:sequence), товарные поля (Э2), категории (Э1), условия
// поставки (Э3), корректировочные ЭСФ (Э4) и бизнес-правила валидации (Э6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceV2Xml } from "../services/esf/invoiceMapper.js";
import { validateEsfInvoice } from "../services/esf/validateInvoice.js";

/** Базовый валидный OutgoingInvoice для маппинга. */
function baseInvoice(over = {}) {
	return {
		number: "СФ-1", date: new Date("2026-07-08"),
		amount: 1120, amountWithoutVat: 1000, vatAmount: 120,
		organization: { name: "ТОО Тест", legalName: "ТОО Тест", bin: "123456789012", bankAccounts: [] },
		counterparty: { name: "Покупатель", bin: "210987654321", countryCode: "KZ" },
		author: { username: "Иванов" },
		outgoingInvoiceItems: [{
			quantity: 2, amount: 1120, amountWithoutVat: 1000, vatAmount: 120, vatRate: 12,
			unitOfMeasure: { code: "796", name: "шт" },
			product: { name: "Товар А", tnvedCode: "0101210000", truOriginCode: "3", barcode: "4870123456789" },
		}],
		...over,
	};
}

/** Индексы тегов идут строго возрастающе (порядок xs:sequence). */
function assertOrder(xml, tags) {
	const idx = tags.map((t) => ({ t, i: xml.indexOf(t) }));
	for (const { t, i } of idx) assert.ok(i !== -1, `нет тега ${t}`);
	for (let k = 1; k < idx.length; k++) {
		assert.ok(idx[k].i > idx[k - 1].i, `порядок нарушен: ${idx[k - 1].t} должен идти до ${idx[k].t}`);
	}
}

test("ORDINARY: обязательный минимум и порядок базовых полей", () => {
	const xml = buildInvoiceV2Xml(baseInvoice());
	assert.match(xml, /<invoiceType>ORDINARY_INVOICE<\/invoiceType>/);
	assert.match(xml, /<num>СФ-1<\/num>/);
	assert.match(xml, /<date>08\.07\.2026<\/date>/);
	// AbstractInvoice: date < invoiceType < num < operatorFullname < turnoverDate
	assertOrder(xml, ["<date>", "<invoiceType>", "<num>", "<operatorFullname>", "<turnoverDate>"]);
	// InvoiceV2: customers < productSet < sellers
	assertOrder(xml, ["<customers>", "<productSet>", "<sellers>"]);
	// обычный ЭСФ не содержит relatedInvoice/deliveryTerm/statuses
	assert.doesNotMatch(xml, /<relatedInvoice>/);
	assert.doesNotMatch(xml, /<deliveryTerm>/);
	assert.doesNotMatch(xml, /<statuses>/);
});

test("Э2: товарные поля — unitCode=ТН ВЭД, truOriginCode из товара, gtinCode из штрихкода", () => {
	const xml = buildInvoiceV2Xml(baseInvoice());
	const product = xml.match(/<product>[\s\S]*?<\/product>/)[0];
	assert.match(product, /<unitCode>0101210000<\/unitCode>/);      // G4 = ТН ВЭД (не код ед.изм!)
	assert.match(product, /<truOriginCode>3<\/truOriginCode>/);      // G2 из товара
	assert.match(product, /<gtinCode>4870123456789<\/gtinCode>/);    // G17.1 из штрихкода
	assert.match(product, /<unitNomenclature>шт<\/unitNomenclature>/);
	// Порядок Product: catalogTruId < description < gtinCode < ndsAmount < ... < truOriginCode < ... < unitCode
	assertOrder(product, ["<catalogTruId>", "<description>", "<gtinCode>", "<ndsAmount>", "<truOriginCode>", "<unitCode>"]);
});

test("Э2: услуга без ТН ВЭД/штрихкода — поля опущены, truOriginCode дефолт 1", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 0, amountWithoutVat: 0, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "усл" }, product: { name: "Услуга" },
	}] });
	const product = buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0];
	assert.doesNotMatch(product, /<unitCode>/);
	assert.doesNotMatch(product, /<gtinCode>/);
	assert.match(product, /<truOriginCode>1<\/truOriginCode>/);
});

test("truOrigin fallback: услуга (isService) без признака → «5»", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "усл" }, product: { name: "Услуга", isService: true },
	}] });
	const product = buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0];
	assert.match(product, /<truOriginCode>5<\/truOriginCode>/);
	// явно заданный признак приоритетнее fallback
	const inv2 = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "усл" }, product: { name: "Услуга", isService: true, truOriginCode: "3" },
	}] });
	assert.match(buildInvoiceV2Xml(inv2).match(/<product>[\s\S]*?<\/product>/)[0], /<truOriginCode>3<\/truOriginCode>/);
});

test("Э2: невалидный ТН ВЭД (буквы) и штрихкод неверной длины — опускаются", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "шт" }, product: { name: "Т", tnvedCode: "ABC", truOriginCode: "9", barcode: "123" },
	}] });
	const product = buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0];
	assert.doesNotMatch(product, /<unitCode>/);
	assert.doesNotMatch(product, /<gtinCode>/);
	assert.match(product, /<truOriginCode>1<\/truOriginCode>/); // невалидный «9» → дефолт
});

test("пер-строчное переопределение: item.tnvedCode/truOriginCode приоритетнее товара", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "шт" }, tnvedCode: "0202100000", truOriginCode: "4",
		tnvedName: "Мясо КРС", product: { name: "Т", tnvedCode: "0101210000", truOriginCode: "1" },
	}] });
	const product = buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0];
	assert.match(product, /<unitCode>0202100000<\/unitCode>/);    // item, не товар (0101210000)
	assert.match(product, /<truOriginCode>4<\/truOriginCode>/);    // item, не товар (1)
	assert.match(product, /<tnvedName>Мясо КРС<\/tnvedName>/);
});

test("Э1: категории продавца/получателя — statuses перед tin", () => {
	const xml = buildInvoiceV2Xml(baseInvoice({ esfSellerType: "EXPORTER", esfCustomerType: "RETAIL" }));
	const seller = xml.match(/<seller>[\s\S]*?<\/seller>/)[0];
	const customer = xml.match(/<customer>[\s\S]*?<\/customer>/)[0];
	assert.match(seller, /<statuses><status>EXPORTER<\/status><\/statuses>/);
	assert.match(customer, /<statuses><status>RETAIL<\/status><\/statuses>/);
	assertOrder(seller, ["<name>", "<statuses>", "<tin>"]);
	assertOrder(customer, ["<name>", "<statuses>", "<tin>"]);
});

test("Э1: невалидная/пустая категория — блок statuses опущен", () => {
	const xml = buildInvoiceV2Xml(baseInvoice({ esfSellerType: "WRONG", esfCustomerType: "" }));
	assert.doesNotMatch(xml, /<statuses>/);
});

test("Э3: условия поставки из договора (deliveryTerm между customers и productSet)", () => {
	const xml = buildInvoiceV2Xml(baseInvoice({
		contract: { contractNumber: "Д-77", name: "Договор", startDate: new Date("2026-01-15") },
	}));
	const dt = xml.match(/<deliveryTerm>[\s\S]*?<\/deliveryTerm>/)[0];
	assert.match(dt, /<contractDate>15\.01\.2026<\/contractDate>/);
	assert.match(dt, /<contractNum>Д-77<\/contractNum>/);
	assert.match(dt, /<hasContract>true<\/hasContract>/);
	assertOrder(dt, ["<contractDate>", "<contractNum>", "<hasContract>"]);
	assertOrder(xml, ["</customers>", "<deliveryTerm>", "<productSet>"]);
});

test("Э3: без договора deliveryTerm опущен", () => {
	assert.doesNotMatch(buildInvoiceV2Xml(baseInvoice()), /<deliveryTerm>/);
});

test("Э4: FIXED_INVOICE — invoiceType + relatedInvoice между operatorFullname и turnoverDate", () => {
	const xml = buildInvoiceV2Xml(baseInvoice(), {
		invoiceType: "FIXED_INVOICE",
		related: { date: new Date("2026-06-01"), num: "СФ-0", registrationNumber: "ESF-1-20260601-0001" },
	});
	assert.match(xml, /<invoiceType>FIXED_INVOICE<\/invoiceType>/);
	const rel = xml.match(/<relatedInvoice>[\s\S]*?<\/relatedInvoice>/)[0];
	assert.match(rel, /<date>01\.06\.2026<\/date>/);
	assert.match(rel, /<num>СФ-0<\/num>/);
	assert.match(rel, /<registrationNumber>ESF-1-20260601-0001<\/registrationNumber>/);
	assertOrder(xml, ["<operatorFullname>", "<relatedInvoice>", "<turnoverDate>"]);
});

test("Э4: невалидный invoiceType → ORDINARY; related без num/regNum опускается", () => {
	const xml = buildInvoiceV2Xml(baseInvoice(), { invoiceType: "GARBAGE", related: { date: new Date() } });
	assert.match(xml, /<invoiceType>ORDINARY_INVOICE<\/invoiceType>/);
	assert.doesNotMatch(xml, /<relatedInvoice>/);
});

test("Э3b: грузоотправитель/получатель — consignee и consignor перед customers", () => {
	const xml = buildInvoiceV2Xml(baseInvoice(), {
		consignor: { name: "Отправитель", bin: "111111111111", address: "Адрес1" },
		consignee: { name: "Получатель груза", bin: "222222222222", address: "Адрес2", countryCode: "RU" },
	});
	const consignor = xml.match(/<consignor>[\s\S]*?<\/consignor>/)[0];
	const consignee = xml.match(/<consignee>[\s\S]*?<\/consignee>/)[0];
	assert.match(consignor, /<name>Отправитель<\/name>/);
	assert.match(consignor, /<tin>111111111111<\/tin>/);
	assert.match(consignee, /<countryCode>RU<\/countryCode>/); // D26 countryCode обязателен
	assert.match(consignee, /<name>Получатель груза<\/name>/);
	// Порядок: turnoverDate < consignee < consignor < customers
	assertOrder(xml, ["<turnoverDate>", "<consignee>", "<consignor>", "<customers>"]);
});

test("Э3b: без грузоотправителя/получателя блоки опущены", () => {
	const xml = buildInvoiceV2Xml(baseInvoice());
	assert.doesNotMatch(xml, /<consignor>/);
	assert.doesNotMatch(xml, /<consignee>/);
});

test("Э5: поверенный (I/J) и госучреждение (F) — блоки и позиции", () => {
	const xml = buildInvoiceV2Xml(
		baseInvoice({
			esfCustomerAgentDocNum: "Д-1", esfSellerAgentDocNum: "Д-2",
			esfPoBik: "HSBKKZKX", esfPoPayPurpose: "Оплата ГЗ", esfPoProductCode: "44000000",
		}),
		{
			customerAgent: { name: "Оператор П", bin: "111111111111", address: "Адрес П" },
			sellerAgent: { name: "Оператор С", bin: "222222222222", address: "Адрес С" },
		},
	);
	assert.match(xml, /<customerAgentName>Оператор П<\/customerAgentName>/);
	assert.match(xml, /<customerAgentTin>111111111111<\/customerAgentTin>/);
	assert.match(xml, /<customerAgentDocNum>Д-1<\/customerAgentDocNum>/);
	assert.match(xml, /<sellerAgentName>Оператор С<\/sellerAgentName>/);
	const po = xml.match(/<publicOffice>[\s\S]*?<\/publicOffice>/)[0];
	assert.match(po, /<bik>HSBKKZKX<\/bik>/);
	assert.match(po, /<payPurpose>Оплата ГЗ<\/payPurpose>/);
	assert.doesNotMatch(po, /<iik>/); // пустой iik опущен
	// Порядок: customerAgent < customers < productSet < publicOffice < sellerAgent < sellers
	assertOrder(xml, ["<customerAgentTin>", "<customers>", "<productSet>", "<publicOffice>", "<sellerAgentTin>", "<sellers>"]);
});

test("Э5: без данных поверенного/госучреждения блоки опущены", () => {
	const xml = buildInvoiceV2Xml(baseInvoice());
	assert.doesNotMatch(xml, /Agent/);
	assert.doesNotMatch(xml, /<publicOffice>/);
});

test("узкие поля: акциз (G9/10), tnvedName (G3.1), addInf (K43)", () => {
	const inv = baseInvoice({ comment: "Доп. сведения" });
	inv.outgoingInvoiceItems[0].exciseRate = 15.5;
	inv.outgoingInvoiceItems[0].exciseAmount = 31;
	inv.outgoingInvoiceItems[0].product.tnvedName = "Лошади живые";
	const xml = buildInvoiceV2Xml(inv);
	assert.match(xml, /<addInf>Доп\. сведения<\/addInf>/);
	const product = xml.match(/<product>[\s\S]*?<\/product>/)[0];
	assert.match(product, /<exciseAmount>31\.00<\/exciseAmount>/);
	assert.match(product, /<exciseRate>15\.5<\/exciseRate>/);
	assert.match(product, /<tnvedName>Лошади живые<\/tnvedName>/);
	assertOrder(product, ["<description>", "<exciseAmount>", "<exciseRate>", "<ndsAmount>", "<quantity>", "<tnvedName>", "<truOriginCode>"]);
	// addInf — перед грузополучателем/покупателем
	assertOrder(xml, ["<turnoverDate>", "<addInf>", "<customers>"]);
});

test("узкие поля: нулевой акциз / пустой комментарий — опущены", () => {
	const xml = buildInvoiceV2Xml(baseInvoice());
	assert.doesNotMatch(xml, /<exciseAmount>/);
	assert.doesNotMatch(xml, /<exciseRate>/);
	assert.doesNotMatch(xml, /<addInf>/);
	assert.doesNotMatch(xml, /<tnvedName>/);
});

test("catalogTruId (G18) — из карточки товара (ГС ВС), иначе дефолт «1»", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "шт" }, product: { name: "Т", catalogTruId: "01.11.11" },
	}] });
	assert.match(buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0], /<catalogTruId>01\.11\.11<\/catalogTruId>/);
	assert.match(buildInvoiceV2Xml(baseInvoice()).match(/<product>[\s\S]*?<\/product>/)[0], /<catalogTruId>1<\/catalogTruId>/);
});

test("КПВЭД (kpvedCode) — из позиции ГС ВС товара (catalogTruId)", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "шт" }, product: { name: "Т", catalogTruId: "01.11.11" },
	}] });
	const product = buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0];
	assert.match(product, /<kpvedCode>01\.11\.11<\/kpvedCode>/);
});

test("ГТД (productDeclaration/productNumberInDeclaration) — из позиции, порядок по XSD", () => {
	const inv = baseInvoice({ outgoingInvoiceItems: [{
		quantity: 1, amount: 100, amountWithoutVat: 100, vatAmount: 0, vatRate: 0,
		unitOfMeasure: { name: "шт" }, productDeclaration: "56004/010124/0001234", productNumberInDeclaration: "3",
		product: { name: "Т" },
	}] });
	const product = buildInvoiceV2Xml(inv).match(/<product>[\s\S]*?<\/product>/)[0];
	assert.match(product, /<productDeclaration>56004\/010124\/0001234<\/productDeclaration>/);
	assert.match(product, /<productNumberInDeclaration>3<\/productNumberInDeclaration>/);
	assertOrder(product, ["<priceWithoutTax>", "<productDeclaration>", "<productNumberInDeclaration>", "<quantity>"]);
});

test("итоги productSet и валюта по умолчанию", () => {
	const xml = buildInvoiceV2Xml(baseInvoice());
	assert.match(xml, /<currencyCode>KZT<\/currencyCode>/);
	assert.match(xml, /<totalNdsAmount>120\.00<\/totalNdsAmount>/);
	assert.match(xml, /<totalPriceWithTax>1120\.00<\/totalPriceWithTax>/);
});

// ── validateEsfInvoice (Э6) ──────────────────────────────────────────────────
test("Э6: валидный документ → нет ошибок", () => {
	assert.deepEqual(validateEsfInvoice(baseInvoice()), []);
});

test("Э6: нет БИН / неверный БИН продавца", () => {
	assert.ok(validateEsfInvoice(baseInvoice({ organization: { name: "ТОО" } })).some((e) => /БИН/.test(e)));
	assert.ok(validateEsfInvoice(baseInvoice({ organization: { name: "ТОО", bin: "123" } })).some((e) => /12 цифр/.test(e)));
});

test("Э6: нет позиций / нет получателя", () => {
	assert.ok(validateEsfInvoice(baseInvoice({ outgoingInvoiceItems: [] })).some((e) => /позиц/.test(e)));
	assert.ok(validateEsfInvoice(baseInvoice({ counterparty: null })).some((e) => /получател/.test(e)));
});

test("Э6: FIXED без основного / основной без рег.№", () => {
	assert.ok(validateEsfInvoice(baseInvoice({ esfInvoiceType: "FIXED_INVOICE" }))
		.some((e) => /основной/.test(e)));
	const withRel = validateEsfInvoice(
		baseInvoice({ esfInvoiceType: "ADDITIONAL_INVOICE", esfRelatedInvoiceUuid: "u1" }),
		{ related: { found: true, registrationNumber: null } },
	);
	assert.ok(withRel.some((e) => /не зарегистрирован/.test(e)));
});

test("Э6: нерезидент с countryCode=KZ", () => {
	assert.ok(validateEsfInvoice(baseInvoice({ esfCustomerType: "NONRESIDENT" }))
		.some((e) => /нерезидент/.test(e)));
	// нерезидент с иностранной страной — ок
	assert.deepEqual(
		validateEsfInvoice(baseInvoice({ esfCustomerType: "NONRESIDENT", counterparty: { name: "Foreign", countryCode: "RU" } })),
		[],
	);
});
