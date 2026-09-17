/**
 * «Операции» списка баз (17.09): какие пункты доступны для отмеченных баз и какие базы помощник пропустит.
 *
 * Регламентные задания: у отмеченных баз они могут быть и запрещены, и разрешены. Пункт нужен, если он хоть одной
 * базе что-то изменит; отмечены базы в обоих состояниях — доступны оба пункта.
 */
import { describe, it, expect } from "vitest";
import { alreadyInTarget, changesNothing, isApplicable, splitTargets } from "src/models/OneCAdmin/shared";
import { GROUP_OPS } from "src/models/OneCAdmin/GroupCommandWizard";

const denied = { baseKey: "a", scheduledJobsDenied: true, published: true };
const allowed = { baseKey: "b", scheduledJobsDenied: false, published: false };
const unknown = { baseKey: "c", scheduledJobsDenied: null, published: null };

describe("пункты «Операций» по отмеченным базам", () => {
	it("все отмеченные с запрещёнными заданиями — «Запретить» ничего не изменит, «Разрешить» нужен", () => {
		expect(changesNothing([denied, { ...denied, baseKey: "d" }], GROUP_OPS.denyJobs.target)).toBe(true);
		expect(changesNothing([denied], GROUP_OPS.allowJobs.target)).toBe(false);
	});

	it("отмечены базы в обоих состояниях — доступны оба пункта", () => {
		expect(changesNothing([denied, allowed], GROUP_OPS.denyJobs.target)).toBe(false);
		expect(changesNothing([denied, allowed], GROUP_OPS.allowJobs.target)).toBe(false);
	});

	it("состояние не читали — пункт доступен: незнание не «уже»", () => {
		expect(changesNothing([unknown], GROUP_OPS.denyJobs.target)).toBe(false);
		expect(changesNothing([unknown], GROUP_OPS.publish.target)).toBe(false);
	});

	it("публикация — так же: все опубликованы → «Опубликовать» ничего не изменит", () => {
		expect(changesNothing([denied], GROUP_OPS.publish.target)).toBe(true);
		expect(changesNothing([denied], GROUP_OPS.unpublish.target)).toBe(false);
		expect(changesNothing([allowed], GROUP_OPS.unpublish.target)).toBe(true);
	});

	it("без отметок и у операций без целевого состояния пункт доступен всегда", () => {
		expect(changesNothing([], GROUP_OPS.denyJobs.target)).toBe(false);
		expect(changesNothing([denied, allowed], GROUP_OPS.info.target)).toBe(false);
	});
});

describe("помощник пропускает базы, которым команда ничего не изменит", () => {
	it("причина — словами", () => {
		expect(alreadyInTarget(denied, GROUP_OPS.denyJobs.target)).toMatch(/уже запрещены/);
		expect(alreadyInTarget(allowed, GROUP_OPS.allowJobs.target)).toMatch(/уже разрешены/);
		expect(alreadyInTarget(denied, GROUP_OPS.publish.target)).toMatch(/уже опубликована/);
		expect(alreadyInTarget(allowed, GROUP_OPS.denyJobs.target)).toBe("");
	});

	it("регламентные задания — команда кластера: недоступная база (нет входа) для неё пригодна, без базы в СУБД — нет", () => {
		const base = { status: "ONLINE", disabled: false, published: null };
		expect(GROUP_OPS.denyJobs.needs).toBe("cluster");
		expect(isApplicable({ ...base, ibUnreachableAt: "t", ibUnreachableReason: "NO_ACCESS" }, "cluster")).toBe(true);
		expect(isApplicable({ ...base, ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" }, "cluster")).toBe(false);
	});

	it("тела команд: запрет и разрешение — поле denied; сведения — без полей и без монопольного доступа", () => {
		expect(GROUP_OPS.denyJobs).toMatchObject({ type: "CLUSTER_SET_SCHEDULED_JOBS", payload: { denied: true } });
		expect(GROUP_OPS.allowJobs).toMatchObject({ type: "CLUSTER_SET_SCHEDULED_JOBS", payload: { denied: false } });
		expect(GROUP_OPS.info).toMatchObject({ type: "IB_INFO", kind: "read", exclusive: false });
	});
});

describe("«Снять регистрацию базы в кластере 1С» — опасная команда «Операций»", () => {
	const base = { status: "ONLINE", disabled: false, published: null };

	/*
	 * Признак «в базу не войти» появляется только после «Проверить базы данных» или неудачной команды: до того панель
	 * считает базу рабочей. Требовать его — значит прятать команду ровно тогда, когда она нужна (17.09). Судит агент.
	 */
	it("пригодна любая база, пока её регистрация в кластере есть — в том числе выглядящая рабочей и скрытая", () => {
		expect(isApplicable({ ...base, ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" }, "drop")).toBe(true);
		expect(isApplicable(base, "drop")).toBe(true);
		expect(isApplicable({ ...base, status: "DISABLED", disabled: true, clusterStatus: "ONLINE" }, "drop")).toBe(true);
	});

	it("базе, которой в кластере уже нет, снимать нечего", () => {
		expect(isApplicable({ ...base, status: "MISSING" }, "drop")).toBe(false);
		expect(isApplicable({ ...base, status: "DISABLED", disabled: true, clusterStatus: "MISSING", ibUnreachableAt: "t" }, "drop")).toBe(false);
	});

	it("тело команды — confirm: true; вид операции — удаление", () => {
		expect(GROUP_OPS.dropRegistration).toMatchObject({ type: "CLUSTER_DROP_INFOBASE", needs: "drop", kind: "delete", payload: { confirm: true } });
	});
});

/**
 * «Операции» выполняют команду по ОТМЕЧЕННЫМ базам (17.09), поэтому перед запуском отмеченные делятся на те, кому
 * команда нужна, и остальные — с причиной, которую видно в подтверждении.
 */
describe("отбор целей среди отмеченных баз", () => {
	const base = (over: Record<string, unknown> = {}) => ({
		key: "b", status: "ONLINE", disabled: false, published: null, ibUnreachableAt: null,
		ibUnreachableReason: null, scheduledJobsDenied: null, ...over,
	});

	it("«Запретить регламентные задания»: базы, где уже запрещены, отсеиваются с причиной", () => {
		const rows = [base({ key: "a" }), base({ key: "b", scheduledJobsDenied: true })];
		const r = splitTargets(rows, GROUP_OPS.denyJobs.needs, GROUP_OPS.denyJobs.target);
		expect(r.targets.map((x) => x.key)).toEqual(["a"]);
		expect(r.skipped[0].reason).toMatch(/уже запрещены/);
	});

	it("«Обновить сведения»: база без входа и база вне кластера отсеиваются, рабочая остаётся", () => {
		const rows = [base({ key: "ok" }), base({ key: "nodb", ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" }), base({ key: "gone", status: "MISSING" })];
		const r = splitTargets(rows, GROUP_OPS.info.needs, GROUP_OPS.info.target);
		expect(r.targets.map((x) => x.key)).toEqual(["ok"]);
		expect(r.skipped.map((x) => x.row.key)).toEqual(["nodb", "gone"]);
	});

	it("«Снять регистрацию»: подходит и рабочая, и недоступная база; та, которой нет в кластере, — нет", () => {
		const rows = [base({ key: "ok" }), base({ key: "nodb", ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" }), base({ key: "gone", status: "MISSING" })];
		const r = splitTargets(rows, GROUP_OPS.dropRegistration.needs, GROUP_OPS.dropRegistration.target);
		expect(r.targets.map((x) => x.key)).toEqual(["ok", "nodb"]);
		expect(r.skipped.map((x) => x.row.key)).toEqual(["gone"]);
	});

	it("«Обслуживание» переехало в «Операции» и сохранило команды", () => {
		expect(GROUP_OPS.checkBase).toMatchObject({ type: "IB_CHECK", kind: "read" });
		expect(GROUP_OPS.backup).toMatchObject({ type: "IB_BACKUP", needsDir: true });
	});
});
