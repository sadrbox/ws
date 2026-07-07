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

export default { buildCanonicalXml, createEdoDocument, buildForSign, sendEdoDocument, loadAttachments };
