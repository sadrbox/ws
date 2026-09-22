import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Структурный тест меню: проверяет таксономию БЕЗ рендеринга (NavList тянет
 * тяжёлые ленивые импорты).
 *
 * Группы вынесены в блоки <Секция>Groups — раздел «Все разделы» ПЕРЕИСПОЛЬЗУЕТ их,
 * поэтому меню не может разойтись с разделами: пункт добавляется в одном месте.
 * Отсюда и якоря теста: границы этих блоков, а не текст подписей (меню
 * интернационализировано — пункты заданы через translate(ключ)).
 */
const SRC = readFileSync(resolve(__dirname, "../components/UI/NavList.tsx"), "utf-8");

/** Тело блока `const XGroups = () => (...)` — до начала следующего блока/секции. */
const groupsOf = (section: string) => {
	const start = SRC.indexOf(`const ${section}Groups = () => (`);
	expect(start, `блок ${section}Groups не найден`).toBeGreaterThan(0);
	const rest = SRC.slice(start + 10);
	const end = rest.search(/const \w+Groups = \(\) => \(|if \(label\.toLocaleLowerCase/);
	return rest.slice(0, end === -1 ? undefined : end);
};

describe("NavList structure", () => {
	it("«Все разделы» переиспользует группы ВСЕХ разделов — меню не разойдётся", () => {
		const all = SRC.slice(SRC.indexOf('"All".toLocaleLowerCase()'));
		for (const s of ["Trade", "Accounting", "HR", "CRM", "Administration", "Settings"]) {
			expect(all, `в «Все разделы» нет группы ${s}`).toContain(`<${s}Groups />`);
		}
	});

	it("Торговля: документы разбиты по бизнес-цепочке, а не свалены в один список", () => {
		const trade = groupsOf("Trade");
		// 21 документ одним списком читать невозможно: «возврат» — покупателю или
		// поставщику? — станет ясно только после вчитывания.
		for (const g of ["sales", "purchase", "warehouse", "cash"]) {
			expect(trade, `нет группы «${g}»`).toContain(`translate("${g}")`);
		}
		expect(trade).not.toContain('translate("documents")');
		// Продажи и закупки не перемешаны.
		expect(trade.indexOf('translate("sales")')).toBeLessThan(trade.indexOf('translate("purchase")'));
	});

	it("Торговля → Справочники: без единиц/налогов/параметров учёта — это Настройки", () => {
		const trade = groupsOf("Trade");
		expect(trade).toContain("ProductsList");
		expect(trade).toContain("BrandsList");
		expect(trade).not.toContain("UnitOfMeasuresList");
		expect(trade).not.toContain("TaxesList");
		expect(trade).not.toContain("OrganizationAccountingSettingsList");
	});

	it("Настройки: параметры учёта, единицы, налоги", () => {
		const settings = groupsOf("Settings");
		expect(settings).toContain("OrganizationAccountingSettingsList");
		expect(settings).toContain("UnitOfMeasuresList");
		expect(settings).toContain("TaxesList");
	});

	it("Обработки — своя группа: это НЕ справочники (там же терминал продаж)", () => {
		const trade = groupsOf("Trade");
		expect(trade).toContain('translate("processings")');
		// Терминал раньше висел в «голом» <ul> вне NavGroup и ломал сетку раздела.
		expect(trade).toContain("SalesTerminal");
		expect(trade.indexOf("SalesTerminal")).toBeGreaterThan(trade.indexOf('translate("processings")'));
	});
});

it("Администрирование: кластеры и агенты — разные пункты, оба под правом OneCAdmin", () => {
	const admin = groupsOf("Administration");
	// Разделение по предмету: сервер 1С с его базами — одно, службы-агенты — другое.
	expect(admin).toContain('translate("OneCClusters")');
	expect(admin).toContain('translate("OneCAgents")');
	expect(admin).toContain('component: OneCClustersList');
	expect(admin).toContain('component: OneCAgentsList');
	// Прежний объединённый пункт из меню убран: он остался только для восстановления панелей.
	expect(admin).not.toContain('component: OneCAdminList');
	expect(SRC).not.toContain('component: OneCAdminList');
	// Право одно на оба пункта; внутри действуют вложенные разрешения.
	expect(admin.match(/can\("OneCAdmin"\)/g)?.length).toBe(2);
});

it("раздел «Администрирование» есть в навбаре и отвечает на свой label", () => {
	expect(SRC).toContain('"Administration".toLocaleLowerCase()');
	const app = readFileSync(resolve(__dirname, "../app/index.tsx"), "utf-8");
	expect(app).toContain('<NavList label="Administration" />');
	expect(app).toContain('translate("administration")');
});
