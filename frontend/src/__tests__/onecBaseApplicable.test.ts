import { describe, it, expect } from "vitest";
import { isApplicable, unreachableReason } from "src/models/OneCAdmin/shared";
import { translate } from "src/i18";

// Живой случай (2026-09-11): человек нажал «Обновить» на базе `shahs_backup` и получил
// «Проверено баз: 0/1. Не удалось: … база «shahs_backup» не найдена на сервере SERVER».
//
// Ответ агента был верен: срез кластера базу ПЕРЕЧИСЛЯЕТ (запись в кластере есть), а войти
// в неё нельзя — самой базы на СУБД уже нет. Это два разных факта, и знают их разные
// источники: `rac` отвечает «зарегистрирована ли», вход в базу — «можно ли с ней работать».
// Пока оба жили в одном поле `status`, срез затирал знание, добытое входом, и всё шло по
// кругу: база выглядит рабочей → команда → полминуты ожидания → та же ошибка.

const base = (over: Partial<Parameters<typeof isApplicable>[0]> = {}) => ({
	status: "ONLINE",
	disabled: false,
	published: null as boolean | null,
	...over,
});

describe("применимость базы: «числится в кластере» и «можно войти» — разные вещи", () => {
	it("обычная живая база годится для операций внутри неё", () => {
		expect(isApplicable(base(), "ib")).toBe(true);
	});

	it("база, в которую не удалось войти, целью для операций ВНУТРИ неё не считается", () => {
		const phantom = base({ ibUnreachableAt: "2026-09-11T10:01:46.000Z" });
		expect(isApplicable(phantom, "ib")).toBe(false);
	});

	it("но для команд УРОВНЯ КЛАСТЕРА она по-прежнему цель: они в базу не заходят", () => {
		const phantom = base({ ibUnreachableAt: "2026-09-11T10:01:46.000Z" });
		// Публикация и снятие делаются настройкой веб-сервера, а не соединением с базой.
		expect(isApplicable(phantom, "publish")).toBe(true);
		expect(isApplicable(phantom, "unpublish")).toBe(true);
	});

	it("причина отказа названа словами, а не кодом ошибки агента", () => {
		expect(unreachableReason(base({ disabled: true }))).toBe(translate("onecBaseDisabled"));
		expect(unreachableReason(base({ status: "MISSING" }))).toBe(translate("onecBaseMissing"));
		expect(unreachableReason(base({ ibUnreachableAt: "2026-09-11T10:01:46.000Z" })))
			.toBe(translate("onecBaseIbUnreachable"));
	});

	it("отключённая и пропавшая из кластера база не годится ни для чего", () => {
		expect(isApplicable(base({ disabled: true }), "ib")).toBe(false);
		expect(isApplicable(base({ disabled: true }), "publish")).toBe(false);
		expect(isApplicable(base({ status: "MISSING" }), "ib")).toBe(false);
		expect(isApplicable(base({ status: "MISSING" }), "publish")).toBe(false);
	});
});

// ── База-фантом: запись в кластере есть, самой базы нет ─────────────────────
//
// Живой случай: `aibek` числится ONLINE, а ibcmd отвечает «База данных отсутствует в
// сервере баз данных». Такой базе неприменимо НИЧЕГО, включая публикацию: та не соединяется
// с базой и формально «сработала бы», но на веб-сервере появилась бы ссылка на пустоту — по
// ней потом придут и получат «База данных не обнаружена».
describe("база, которой нет в СУБД", () => {
	const phantom = (reason: string) => base({
		ibUnreachableAt: "2026-09-12T05:39:41.996Z",
		ibUnreachableReason: reason,
	});

	it("неприменима ни к одной операции", () => {
		for (const op of ["ib", "http", "publish", "unpublish"] as const) {
			expect(isApplicable(phantom("NO_DB"), op)).toBe(false);
			expect(isApplicable(phantom("NO_INFOBASE"), op)).toBe(false);
		}
	});

	it("«не пускают» запрещает только команды внутрь базы", () => {
		// Права чинятся настройкой учётных данных, а не исключением базы из работы.
		expect(isApplicable(phantom("NO_ACCESS"), "ib")).toBe(false);
		expect(isApplicable(phantom("NO_ACCESS"), "publish")).toBe(true);
	});

	it("причина названа словами, а не кодом", () => {
		expect(unreachableReason(phantom("NO_DB"))).toBe(translate("onecBaseNoDb"));
		expect(unreachableReason(phantom("NO_ACCESS"))).toBe(translate("onecBaseNoAccess"));
		// Причину не разобрали — остаётся прежнее общее объяснение.
		expect(unreachableReason(phantom("UNKNOWN"))).toBe(translate("onecBaseIbUnreachable"));
	});
});
