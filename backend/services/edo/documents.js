// ЭДО P1 — создание, канонизация и отправка исходящих документов.
// Подпись выполняется на клиенте (NCALayer, enveloped), backend хранит
// подписанный XML и ведёт статус. Логика вынесена сюда (тестируема без HTTP),
// роутер — тонкая обёртка.
import { prisma } from "../../prisma/prisma-client.js";
import { EDO_STATUS, assertTransition, resolveRecipient, EdoError } from "./index.js";

/** Экранирование значения для XML. */
function esc(v) {
	if (v == null) return "";
	return String(v)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function tag(name, value) {
	if (value === null || value === undefined || value === "") return "";
	return `<${name}>${esc(value)}</${name}>`;
}

/** Дата → ISO (стабильно для подписи). */
function iso(d) {
	const dt = d instanceof Date ? d : new Date(d);
	return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
}

/**
 * Строит КАНОНИЧЕСКИЙ XML документа ЭДО (детерминирован — порядок фиксирован),
 * именно он подписывается ЭЦП. Вложения включаются метаданными (uuid+имя+хэш нет —
 * достаточно ссылки; содержимое файлов неизменно по filePath).
 */
export function buildCanonicalXml(doc, attachments = []) {
	const atts = attachments
		.map((a) =>
			"<attachment>" +
			tag("uuid", a.uuid) + tag("fileName", a.fileName) +
			tag("mimeType", a.mimeType) + tag("fileSize", a.fileSize) +
			"</attachment>")
		.join("");
	return (
		'<edoDocument xmlns="edo">' +
		tag("uuid", doc.uuid) +
		tag("kind", doc.kind) +
		tag("number", doc.number) +
		tag("date", iso(doc.date)) +
		tag("title", doc.title) +
		tag("comment", doc.comment) +
		"<sender>" + tag("orgUuid", doc.senderOrgUuid) + tag("bin", doc.senderBin) + "</sender>" +
		"<receiver>" + tag("bin", doc.receiverBin) + "</receiver>" +
		(doc.sourceDocType ? "<source>" + tag("type", doc.sourceDocType) + tag("uuid", doc.sourceDocUuid) + "</source>" : "") +
		(atts ? `<attachments>${atts}</attachments>` : "") +
		"</edoDocument>"
	);
}

/**
 * Создаёт черновик исходящего документа ЭДО. Резолвит получателя по БИН.
 * @returns {Promise<object>} созданный EdoDocument.
 */
export async function createEdoDocument({
	senderOrgUuid, senderBin, authorUuid,
	receiverBin, kind, title, number, date, comment,
	sourceDocType, sourceDocUuid,
}) {
	if (!senderOrgUuid) throw new EdoError("Не указана организация-отправитель");
	if (!authorUuid) throw new EdoError("Не указан автор");
	if (!kind) throw new EdoError("Не указан тип документа (kind)");
	const rec = await resolveRecipient(receiverBin, senderOrgUuid);
	return prisma.edoDocument.create({
		data: {
			senderOrgUuid, senderBin: senderBin || "",
			receiverBin: receiverBin.trim(), receiverOrgUuid: rec.receiverOrgUuid,
			kind, title: title || null, number: number || null,
			date: date ? new Date(date) : new Date(),
			comment: comment || null,
			sourceDocType: sourceDocType || null, sourceDocUuid: sourceDocUuid || null,
			status: EDO_STATUS.DRAFT, authorUuid,
		},
	});
}

/** Вложения документа ЭДО (через полиморфную AttachedFile). */
export function loadAttachments(edoUuid) {
	return prisma.attachedFile.findMany({
		where: { ownerType: "edo_document", ownerUuid: edoUuid, deletedAt: null },
		select: { uuid: true, fileName: true, mimeType: true, fileSize: true },
	});
}

/**
 * Готовит канонический XML документа для подписи на клиенте.
 * @returns {Promise<{ xml: string }>}
 */
export async function buildForSign(uuid, senderOrgUuid) {
	const doc = await prisma.edoDocument.findFirst({
		where: { uuid, senderOrgUuid, deletedAt: null },
	});
	if (!doc) throw new EdoError("Документ ЭДО не найден", { status: 404 });
	const attachments = await loadAttachments(uuid);
	return { xml: buildCanonicalXml(doc, attachments), doc };
}

/**
 * Отправляет документ: сохраняет подпись отправителя, переводит DRAFT→SENT,
 * и, если получатель подключён к системе, сразу DELIVERED (виден во «Входящих»).
 * Подпись (signedXml) и сертификат приходят от клиента (NCALayer, enveloped).
 * @returns {Promise<object>} обновлённый документ.
 */
export async function sendEdoDocument({ uuid, senderOrgUuid, userUuid, signedXml, certificate }) {
	if (!signedXml) throw new EdoError("Нет подписанного XML");
	const doc = await prisma.edoDocument.findFirst({
		where: { uuid, senderOrgUuid, deletedAt: null },
	});
	if (!doc) throw new EdoError("Документ ЭДО не найден", { status: 404 });
	assertTransition(doc.status, EDO_STATUS.SENT);

	const connected = !!doc.receiverOrgUuid;
	const now = new Date();

	return prisma.$transaction(async (tx) => {
		await tx.edoSignature.create({
			data: {
				edoDocumentUuid: uuid, orgUuid: senderOrgUuid, userUuid: userUuid || null,
				role: "sender", signedXml, certificate: certificate || null,
			},
		});
		return tx.edoDocument.update({
			where: { uuid },
			data: {
				canonicalXml: signedXml,
				status: connected ? EDO_STATUS.DELIVERED : EDO_STATUS.SENT,
				sentAt: now,
				deliveredAt: connected ? now : null,
			},
		});
	});
}

// ── P2: приём / встречная подпись / отклонение (сторона получателя) ──────────

/** Загружает документ, доступный получателю (по receiverOrgUuid). */
async function loadForReceiver(uuid, receiverOrgUuid) {
	const doc = await prisma.edoDocument.findFirst({
		where: { uuid, receiverOrgUuid, deletedAt: null },
	});
	if (!doc) throw new EdoError("Входящий документ ЭДО не найден", { status: 404 });
	return doc;
}

/**
 * Готовит канонический XML для встречной подписи получателем (тот же контент,
 * что подписал отправитель — параллельная подпись).
 */
export async function buildForAccept(uuid, receiverOrgUuid) {
	const doc = await loadForReceiver(uuid, receiverOrgUuid);
	const attachments = await loadAttachments(uuid);
	return { xml: buildCanonicalXml(doc, attachments), doc };
}

/**
 * Приём документа получателем. Если передан signedXml — встречная подпись
 * (role=receiver, статус SIGNED); иначе просто приём (ACCEPTED). Переход из DELIVERED.
 * @returns {Promise<object>} обновлённый документ.
 */
export async function acceptEdoDocument({ uuid, receiverOrgUuid, userUuid, signedXml, certificate }) {
	const doc = await loadForReceiver(uuid, receiverOrgUuid);
	const target = signedXml ? EDO_STATUS.SIGNED : EDO_STATUS.ACCEPTED;
	assertTransition(doc.status, target);
	const now = new Date();
	return prisma.$transaction(async (tx) => {
		if (signedXml) {
			await tx.edoSignature.create({
				data: {
					edoDocumentUuid: uuid, orgUuid: receiverOrgUuid, userUuid: userUuid || null,
					role: "receiver", signedXml, certificate: certificate || null,
				},
			});
		}
		return tx.edoDocument.update({
			where: { uuid }, data: { status: target, respondedAt: now },
		});
	});
}

/** Отклонение документа получателем с причиной (DELIVERED→REJECTED). */
export async function rejectEdoDocument({ uuid, receiverOrgUuid, reason }) {
	const doc = await loadForReceiver(uuid, receiverOrgUuid);
	assertTransition(doc.status, EDO_STATUS.REJECTED);
	return prisma.edoDocument.update({
		where: { uuid },
		data: { status: EDO_STATUS.REJECTED, rejectionReason: reason || null, respondedAt: new Date() },
	});
}

// ── P3: отзыв отправителем / аннулирование по согласию ───────────────────────

/**
 * Отзыв документа отправителем (SENT|DELIVERED → REVOKED). Причина в rejectionReason.
 */
export async function revokeEdoDocument({ uuid, senderOrgUuid, reason }) {
	const doc = await prisma.edoDocument.findFirst({ where: { uuid, senderOrgUuid, deletedAt: null } });
	if (!doc) throw new EdoError("Документ ЭДО не найден", { status: 404 });
	assertTransition(doc.status, EDO_STATUS.REVOKED);
	return prisma.edoDocument.update({
		where: { uuid },
		data: { status: EDO_STATUS.REVOKED, rejectionReason: reason || null, respondedAt: new Date() },
	});
}

/**
 * Аннулирование принятого/подписанного документа (SIGNED|ACCEPTED → ANNULLED).
 * Доступно любой из сторон (отправитель или получатель). Причина в rejectionReason.
 */
export async function annulEdoDocument({ uuid, orgUuid, reason }) {
	const doc = await prisma.edoDocument.findFirst({
		where: {
			uuid, deletedAt: null,
			OR: [{ senderOrgUuid: orgUuid }, { receiverOrgUuid: orgUuid }],
		},
	});
	if (!doc) throw new EdoError("Документ ЭДО не найден", { status: 404 });
	assertTransition(doc.status, EDO_STATUS.ANNULLED);
	return prisma.edoDocument.update({
		where: { uuid },
		data: { status: EDO_STATUS.ANNULLED, rejectionReason: reason || null, respondedAt: new Date() },
	});
}

export default {
	buildCanonicalXml, createEdoDocument, buildForSign, sendEdoDocument, loadAttachments,
	buildForAccept, acceptEdoDocument, rejectEdoDocument, revokeEdoDocument, annulEdoDocument,
};
