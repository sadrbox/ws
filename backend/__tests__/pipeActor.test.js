// ─────────────────────────────────────────────────────────────────────────────
// События 1С ссылаются на РЕАЛЬНЫЕ объекты системы, а не хранят их имена строками.
//
// Раньше событие знало только «Наша организация» / «support» — по такой строке нельзя
// открыть карточку, нельзя связать события с организацией, а при переименовании связь
// теряется. Теперь организация ищется по БИН, пользователь — по имени; если объекта
// нет, он создаётся.
// ─────────────────────────────────────────────────────────────────────────────
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";
import { resolveActors, resolveOrganization, resolveUser } from "../services/pipeActor.js";

const trash = { orgs: [], users: [] };

after(async () => {
	await prisma.pipeActivity.deleteMany({ where: { organizationUuid: { in: trash.orgs } } }).catch(() => {});
	await prisma.organization.deleteMany({ where: { uuid: { in: trash.orgs } } }).catch(() => {});
	await prisma.user.deleteMany({ where: { uuid: { in: trash.users } } }).catch(() => {});
	await prisma.$disconnect();
});

const bin12 = () => String(Math.floor(1e11 + Math.random() * 8e11));

test("организации нет → создаётся по БИН и подставляется ссылкой", async () => {
	const bin = bin12();
	const r = await resolveOrganization({ organization: { bin, shortName: "ТОО Из 1С" } });
	trash.orgs.push(r.uuid);

	assert.equal(r.created, true);
	const org = await prisma.organization.findUnique({ where: { uuid: r.uuid } });
	assert.equal(org.bin, bin);
	assert.equal(org.name, "ТОО Из 1С");
	assert.equal(org.externalSource, "1C", "помечаем происхождение — иначе не отличить от заведённой вручную");
});

test("организация есть → ПРИВЯЗЫВАЕМСЯ, а не создаём вторую с тем же БИН", async () => {
	const bin = bin12();
	const first = await resolveOrganization({ organization: { bin, shortName: "Первая" } });
	trash.orgs.push(first.uuid);

	const again = await resolveOrganization({ organization: { bin, shortName: "Как-то иначе названа в 1С" } });
	assert.equal(again.created, false);
	assert.equal(again.uuid, first.uuid, "тот же БИН — тот же объект");
});

test("БИН не пришёл → организацию НЕ выдумываем (она обязана иметь БИН)", async () => {
	assert.equal(await resolveOrganization({ organization: { shortName: "Без БИН" } }), null);
	assert.equal(await resolveOrganization({}), null);
	assert.equal(await resolveOrganization({ organization: { bin: "123" } }), null, "мусорный БИН — не БИН");
});

test("пользователя нет → создаётся, но войти под ним нельзя", async () => {
	const username = `u1c-${crypto.randomUUID().slice(0, 8)}`;
	const r = await resolveUser({ user: { userName: username } });
	trash.users.push(r.uuid);

	assert.equal(r.created, true);
	const u = await prisma.user.findUnique({ where: { uuid: r.uuid } });
	assert.equal(u.password, null, "пароля нет → это лишь «автор» событий, а не учётка для входа");

	const again = await resolveUser({ user: { userName: username } });
	assert.equal(again.created, false);
	assert.equal(again.uuid, r.uuid, "повтор не плодит дублей пользователей");
});

test("обе ссылки разом; отсутствие данных не роняет приём", async () => {
	const bin = bin12();
	const username = `u1c-${crypto.randomUUID().slice(0, 8)}`;
	const a = await resolveActors({ organization: { bin, shortName: "Обе" }, user: { userName: username } });
	trash.orgs.push(a.organizationUuid);
	trash.users.push(a.userUuid);

	assert.ok(a.organizationUuid);
	assert.ok(a.userUuid);

	// Пустое событие: ссылок нет, но исключения тоже — событие важнее ссылок.
	const empty = await resolveActors({});
	assert.deepEqual(empty, { organizationUuid: null, userUuid: null });
});
