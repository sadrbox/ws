// W1 «Коммуникации»: диалоги — find-or-create, приём входящих, окно 24ч.
// HEADLESS (мок-клиент). Резолвинг номера покрыт отдельно в waResolve.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrCreateConversation, saveIncoming, isWindowOpen } from "../services/wa/conversations.js";

// ── диалоги ──────────────────────────────────────────────────────────────────
function convClient(initial = []) {
	const convs = [...initial];
	const msgs = [];
	let n = 0;
	return {
		convs, msgs,
		contact: { findMany: async () => [] },
		contactPerson: { findFirst: async () => null },
		counterparty: { findFirst: async () => null },
		waConversation: {
			findFirst: async ({ where }) => convs.find((c) =>
				(where.uuid ? c.uuid === where.uuid : true) &&
				(where.phone ? c.phone === where.phone : true) &&
				(where.channelUuid ? c.channelUuid === where.channelUuid : true)) ?? null,
			create: async ({ data }) => { const c = { id: ++n, uuid: `conv-${n}`, unreadCount: 0, ...data }; convs.push(c); return c; },
			update: async ({ where, data }) => {
				const c = convs.find((x) => x.id === where.id);
				for (const [k, v] of Object.entries(data)) {
					c[k] = v && typeof v === "object" && "increment" in v ? (c[k] ?? 0) + v.increment : v;
				}
				return c;
			},
		},
		waMessage: {
			findUnique: async ({ where }) => msgs.find((m) => m.providerMessageId === where.providerMessageId) ?? null,
			create: async ({ data }) => { const m = { id: ++n, uuid: `msg-${n}`, ...data }; msgs.push(m); return m; },
		},
	};
}
const CH = { uuid: "ch1", organizationUuid: "org1" };

test("диалог: один номер = один диалог (история сохраняется)", async () => {
	const c = convClient();
	const a = await findOrCreateConversation(c, { channel: CH, phone: "+7 702 111 22 33" });
	const b = await findOrCreateConversation(c, { channel: CH, phone: "87021112233" });
	assert.equal(a.uuid, b.uuid, "разные записи номера → тот же диалог");
	assert.equal(c.convs.length, 1);
	assert.equal(a.phone, "77021112233", "номер хранится нормализованным");
});

test("входящее: создаёт сообщение, поднимает unread и окно 24ч", async () => {
	const c = convClient();
	const r = await saveIncoming(c, { channel: CH, phone: "77021112233", body: "привет", providerMessageId: "wamid.1" });
	assert.equal(r.duplicate, false);
	assert.equal(r.message.direction, "in");
	assert.equal(r.conversation.unreadCount, 1);
	assert.ok(isWindowOpen(r.conversation), "после входящего окно 24ч открыто");
});

test("входящее: повтор того же wamid не создаёт дубль", async () => {
	const c = convClient();
	await saveIncoming(c, { channel: CH, phone: "77021112233", body: "раз", providerMessageId: "wamid.X" });
	const again = await saveIncoming(c, { channel: CH, phone: "77021112233", body: "раз", providerMessageId: "wamid.X" });
	assert.equal(again.duplicate, true);
	assert.equal(c.msgs.length, 1, "сообщение одно");
	assert.equal(c.convs[0].unreadCount, 1, "счётчик не накрутился");
});

test("окно 24ч: без входящих закрыто, через сутки — тоже", () => {
	assert.equal(isWindowOpen({ lastIncomingAt: null }), false);
	const old = new Date(Date.now() - 25 * 3600 * 1000);
	assert.equal(isWindowOpen({ lastIncomingAt: old }), false);
	const fresh = new Date(Date.now() - 3600 * 1000);
	assert.equal(isWindowOpen({ lastIncomingAt: fresh }), true);
});
