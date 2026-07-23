// Непрочитанные сообщения чата (E4.1). Логика границы нетривиальна:
//   • считаются только ЧУЖИЕ сообщения;
//   • только позже отметки прочтения;
//   • канал БЕЗ отметки (ни разу не открывали) непрочитан целиком.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../prisma/prisma-client.js";

/** Тот же расчёт, что делает GET /chat/unread, — на одной организации. */
async function unreadFor(userUuid, organizationUuid) {
	const mark = await prisma.chatRead.findUnique({
		where: { userUuid_organizationUuid: { userUuid, organizationUuid } },
	});
	return prisma.chatMessage.count({
		where: {
			organizationUuid, deletedAt: null,
			authorUuid: { not: userUuid },
			...(mark ? { createdAt: { gt: mark.lastReadAt } } : {}),
		},
	});
}

test("непрочитанное: свои не считаются, отметка сдвигает границу", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	const users = await prisma.user.findMany({ take: 2, select: { uuid: true } });
	if (!org || users.length < 2) return t.skip("нужны организация и два пользователя");
	const [me, other] = users;

	const created = [];
	try {
		const mk = async (authorUuid, body) => {
			const m = await prisma.chatMessage.create({
				data: { organizationUuid: org.uuid, authorUuid, authorName: "test", body },
			});
			created.push(m.uuid);
			return m;
		};

		// Чистим возможную прежнюю отметку, чтобы старт был предсказуем.
		await prisma.chatRead.deleteMany({ where: { userUuid: me.uuid, organizationUuid: org.uuid } });
		const baseline = await unreadFor(me.uuid, org.uuid);

		await mk(other.uuid, "чужое 1");
		await mk(me.uuid, "моё — не должно считаться");
		await mk(other.uuid, "чужое 2");
		assert.equal(await unreadFor(me.uuid, org.uuid), baseline + 2, "свои сообщения не считаются");

		// Отметили прочитанным — непрочитанных не осталось.
		await prisma.chatRead.upsert({
			where: { userUuid_organizationUuid: { userUuid: me.uuid, organizationUuid: org.uuid } },
			create: { userUuid: me.uuid, organizationUuid: org.uuid, lastReadAt: new Date() },
			update: { lastReadAt: new Date() },
		});
		assert.equal(await unreadFor(me.uuid, org.uuid), 0, "после отметки всё прочитано");

		// Новое чужое сообщение снова становится непрочитанным.
		await new Promise((r) => setTimeout(r, 5)); // гарантируем createdAt > lastReadAt
		await mk(other.uuid, "чужое после отметки");
		assert.equal(await unreadFor(me.uuid, org.uuid), 1);
	} finally {
		await prisma.chatMessage.deleteMany({ where: { uuid: { in: created } } });
		await prisma.chatRead.deleteMany({ where: { userUuid: me.uuid, organizationUuid: org.uuid } });
	}
});

test("отметка прочтения уникальна на пару пользователь+организация", async (t) => {
	const org = await prisma.organization.findFirst({ select: { uuid: true } });
	const user = await prisma.user.findFirst({ select: { uuid: true } });
	if (!org || !user) return t.skip("нет организации/пользователя");
	try {
		await prisma.chatRead.deleteMany({ where: { userUuid: user.uuid, organizationUuid: org.uuid } });
		await prisma.chatRead.create({ data: { userUuid: user.uuid, organizationUuid: org.uuid } });
		await assert.rejects(
			() => prisma.chatRead.create({ data: { userUuid: user.uuid, organizationUuid: org.uuid } }),
			/Unique constraint|P2002/,
			"вторая отметка на ту же пару невозможна — иначе счётчик раздвоится",
		);
	} finally {
		await prisma.chatRead.deleteMany({ where: { userUuid: user.uuid, organizationUuid: org.uuid } });
	}
});
