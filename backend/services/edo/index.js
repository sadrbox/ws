// Сервис ЭДО (электронный документооборот с контрагентами) — внутрисистемный
// обмен. P0: статусы/переходы жизненного цикла + резолвинг получателя по БИН
// (Counterparty.bin ↔ Organization.bin). Подпись/отправка — на следующих этапах.
import { prisma } from "../../prisma/prisma-client.js";

/** Статусы документа ЭДО (String, конвенция проекта). */
export const EDO_STATUS = Object.freeze({
	DRAFT: "DRAFT",         // черновик у отправителя
	SENT: "SENT",           // отправлен (подписан отправителем)
	DELIVERED: "DELIVERED", // доставлен получателю (виден во «Входящих»)
	SIGNED: "SIGNED",       // подписан получателем (встречная подпись)
	ACCEPTED: "ACCEPTED",   // принят получателем (без встречной подписи)
	REJECTED: "REJECTED",   // отклонён получателем
	REVOKED: "REVOKED",     // отозван отправителем
	ANNULLED: "ANNULLED",   // аннулирован по согласию сторон
});

/** Допустимые переходы статусов (защита от некорректных изменений). */
const TRANSITIONS = Object.freeze({
	DRAFT: ["SENT", "REVOKED"],
	SENT: ["DELIVERED", "REVOKED"],
	DELIVERED: ["SIGNED", "ACCEPTED", "REJECTED", "REVOKED"],
	SIGNED: ["ANNULLED"],
	ACCEPTED: ["ANNULLED"],
	REJECTED: [],
	REVOKED: [],
	ANNULLED: [],
});

/** Разрешён ли переход статуса from → to. */
export function canTransition(from, to) {
	return (TRANSITIONS[from] || []).includes(to);
}

export class EdoError extends Error {
	constructor(message, { status } = {}) {
		super(message);
		this.name = "EdoError";
		this.httpStatus = status || 400;
	}
}

/** Бросает, если переход недопустим. */
export function assertTransition(from, to) {
	if (!canTransition(from, to)) {
		throw new EdoError(`Недопустимый переход статуса ЭДО: ${from} → ${to}`, { status: 409 });
	}
}

/**
 * Резолвит получателя по БИН: подключён ли контрагент к системе (есть ли
 * организация с таким БИН). Отправителя исключаем.
 * @returns {Promise<{ receiverOrgUuid: string|null, receiverName: string|null, connected: boolean }>}
 */
export async function resolveRecipient(receiverBin, senderOrgUuid) {
	const bin = (receiverBin || "").trim();
	if (!/^\d{12}$/.test(bin)) {
		throw new EdoError("Некорректный БИН получателя (12 цифр)", { status: 400 });
	}
	const org = await prisma.organization.findFirst({
		where: {
			bin,
			deletedAt: null,
			...(senderOrgUuid ? { NOT: { uuid: senderOrgUuid } } : {}),
		},
		select: { uuid: true, name: true, legalName: true },
	});
	if (!org) return { receiverOrgUuid: null, receiverName: null, connected: false };
	return {
		receiverOrgUuid: org.uuid,
		receiverName: org.legalName || org.name || null,
		connected: true,
	};
}

export default { EDO_STATUS, canTransition, assertTransition, resolveRecipient, EdoError };
