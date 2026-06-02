// ─────────────────────────────────────────────────────────────────────────
// Валидация принадлежности org-зависимых полей документа его организации.
//
// Правило (Stage D): склад / договор / касса / банк-счёт, указанные в шапке
// документа, должны принадлежать ВЫБРАННОЙ организации документа либо быть
// глобальными (organizationUuid = null). Проверяется на ЛЮБОМ сохранении
// (POST/PUT) — согласовано с фронтовой фильтрацией автокомплитов по орг.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

/** Карта org-зависимых FK-полей шапки → prisma-модель + подпись. */
const ORG_REFS = [
	{ field: "warehouseUuid", model: "warehouse", label: "Склад" },
	{ field: "fromWarehouseUuid", model: "warehouse", label: "Склад-источник" },
	{ field: "toWarehouseUuid", model: "warehouse", label: "Склад-получатель" },
	{ field: "contractUuid", model: "contract", label: "Договор" },
	{ field: "cashboxUuid", model: "cashbox", label: "Касса" },
	{ field: "bankAccountUuid", model: "bankAccount", label: "Банковский счёт" },
];

export class OrgFieldValidationError extends Error {
	constructor(messages) {
		super(messages.join("; "));
		this.name = "OrgFieldValidationError";
		this.messages = messages;
	}
}

/**
 * Бросает OrgFieldValidationError, если какое-то org-зависимое поле документа
 * принадлежит ДРУГОЙ организации (не равной doc.organizationUuid и не глобальной).
 *
 * Если у документа не выбрана организация — проверку пропускаем (это отдельная
 * обязательная-поле валидация). Несуществующие ссылки тоже пропускаем —
 * это забота FK-валидации, а не межорганизационной.
 *
 * @param {object} doc    — объект данных шапки (с *Uuid полями и organizationUuid)
 * @param {object} client — prisma или tx-клиент
 */
export async function assertOrgFieldMembership(doc, client = prisma) {
	const orgUuid = doc?.organizationUuid ?? null;
	if (!orgUuid) return;

	const errors = [];
	for (const ref of ORG_REFS) {
		const uuid = doc[ref.field];
		if (!uuid) continue;
		let rec;
		try {
			rec = await client[ref.model].findUnique({
				where: { uuid },
				select: { organizationUuid: true },
			});
		} catch {
			continue; // модель/поле отсутствует — пропускаем
		}
		if (!rec) continue;
		const recOrg = rec.organizationUuid ?? null;
		if (recOrg !== null && recOrg !== orgUuid) {
			errors.push(`«${ref.label}» принадлежит другой организации`);
		}
	}
	if (errors.length) throw new OrgFieldValidationError(errors);
}

/**
 * Если ошибка — OrgFieldValidationError, отвечает 409 и возвращает true.
 * Иначе false (вызывающий обрабатывает ошибку дальше). Зеркалит respondStockError.
 */
export function respondOrgFieldError(error, res) {
	if (error instanceof OrgFieldValidationError) {
		res.status(409).json({
			success: false,
			message:
				error.messages.length > 1
					? `Поля не соответствуют организации:\n${error.messages.map((m) => `• ${m}`).join("\n")}`
					: error.messages[0],
		});
		return true;
	}
	return false;
}
