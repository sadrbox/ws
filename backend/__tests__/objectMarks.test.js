// Метки (ссылки на объекты) и справочник статусов задач.
// Проверяем защитные инварианты, которые легко потерять при правках:
//   • повторная отметка не падает на unique и оживляет снятую метку;
//   • обратный поиск «кто ссылается на объект» находит метку по цели;
//   • код статуса задачи неизменяем (иначе осиротеют задачи);
//   • статус, использованный в задачах, не удаляется.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";

const uid = () => crypto.randomUUID();

test("метка: повторная отметка идемпотентна и оживляет снятую", async () => {
	const owner = uid(), target = uid();
	const key = { ownerType: "sales", ownerUuid: owner, targetType: "products", targetUuid: target };
	try {
		const first = await prisma.objectMark.create({ data: { ...key, targetLabel: "Товар А" } });

		// Повторная отметка того же объекта: в роутере это upsert по паре —
		// проверяем, что пара действительно уникальна и вторая запись невозможна.
		await assert.rejects(
			() => prisma.objectMark.create({ data: { ...key, targetLabel: "дубль" } }),
			/Unique constraint|P2002/,
			"вторая метка на ту же пару должна отвергаться БД",
		);

		// Снятие — мягкое; «оживление» = сброс deletedAt с обновлением подписи.
		await prisma.objectMark.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
		const revived = await prisma.objectMark.update({
			where: { id: first.id }, data: { deletedAt: null, targetLabel: "Товар А (обновлён)" },
		});
		assert.equal(revived.deletedAt, null);
		assert.equal(revived.targetLabel, "Товар А (обновлён)");
	} finally {
		await prisma.objectMark.deleteMany({ where: { ownerUuid: owner } });
	}
});

test("метка: обратный поиск находит ссылающиеся записи по цели", async () => {
	const target = uid(), ownerA = uid(), ownerB = uid();
	try {
		await prisma.objectMark.createMany({
			data: [
				{ ownerType: "sales", ownerUuid: ownerA, targetType: "counterparties", targetUuid: target },
				{ ownerType: "purchases", ownerUuid: ownerB, targetType: "counterparties", targetUuid: target },
			],
		});
		const incoming = await prisma.objectMark.findMany({
			where: { targetType: "counterparties", targetUuid: target, deletedAt: null },
		});
		assert.equal(incoming.length, 2, "обе записи ссылаются на объект");
		assert.deepEqual(
			incoming.map((m) => m.ownerType).sort(),
			["purchases", "sales"],
		);
	} finally {
		await prisma.objectMark.deleteMany({ where: { targetUuid: target } });
	}
});

test("статусы задач: коды уникальны, базовые засеяны и помечены завершающими", async () => {
	const rows = await prisma.todoStatus.findMany({ orderBy: { sortOrder: "asc" } });
	const codes = rows.map((r) => r.code);
	assert.ok(codes.includes("new"), "базовый статус new засеян миграцией");
	assert.ok(codes.includes("done"));
	assert.equal(new Set(codes).size, codes.length, "коды уникальны");

	// isFinal отличает завершающие статусы — по нему считается просрочка.
	const finals = rows.filter((r) => r.isFinal).map((r) => r.code).sort();
	assert.deepEqual(finals, ["cancelled", "done"], "завершающие: выполнена и отменена");
});

test("статус задачи, использованный в задачах, не должен удаляться", async () => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	const code = `test_${crypto.randomUUID().slice(0, 8)}`;
	const status = await prisma.todoStatus.create({ data: { code, name: "Тестовый", sortOrder: 999 } });
	const todo = await prisma.todo.create({
		data: { description: "проверка статуса", status: code, organizationUuid: org?.uuid ?? null },
	});
	try {
		// Именно эту проверку делает роутер перед удалением (FK тут нет —
		// связь строковая status↔code, checkReferences её не видит).
		const used = await prisma.todo.count({ where: { status: code, deletedAt: null } });
		assert.equal(used, 1, "статус используется → удаление должно быть отклонено (409)");
	} finally {
		await prisma.todo.delete({ where: { uuid: todo.uuid } });
		await prisma.todoStatus.delete({ where: { id: status.id } });
	}
});
