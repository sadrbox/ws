import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";
import { prisma } from "../../prisma/prisma-client.js";
import { importBankStatements } from "../../services/bank/importBankStatements.js";
import { resolveWritableOrg, respondOrgAccessError, checkFkOwnership } from "../../utils/auth.js";

const router = createDocumentHeaderRouter({
	MODEL: "bankStatement",
	ROUTE: "bank-statements",
	stringFields: ["organizationUuid", "counterpartyUuid", "contractUuid", "bankAccountUuid", "direction"],
	include: {
		organization: true,
		counterparty: true,
		contract: true,
		bankAccount: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	hasBasis: true,
	posting: { docType: "bank_statement" },
	defaultPosted: true,
});

// T8.1: импорт выписки (1CClientBankExchange / CSV). Фронт читает файл как ТЕКСТ и
// шлёт в body — без multer. Строки создаются НЕпроведёнными (пользователь сверяет
// и проводит). Без транзакции: файл может быть большим (лимит интерактивной
// транзакции Prisma — 5с), повторный импорт дедуплится сам.
router.post("/bank-statements/import", async (req, res) => {
	try {
		if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
		const { text, organizationUuid, bankAccountUuid } = req.body || {};
		if (!text || typeof text !== "string") return res.status(400).json({ success: false, message: "Пустой файл выписки" });
		if (!bankAccountUuid) return res.status(400).json({ success: false, message: "Не указан банковский счёт организации" });
		// Организация и счёт — доступные пользователю (Б8 аудита 26.09): импорт создавал
		// выписки в чужой организации по чужому счёту.
		const orgUuid = resolveWritableOrg(req, organizationUuid);
		const fkError = await checkFkOwnership(req, prisma, [{ model: "bankAccount", uuid: bankAccountUuid }]);
		if (fkError) return res.status(403).json({ success: false, message: "Банковский счёт недоступен" });
		const result = await importBankStatements(prisma, {
			text, organizationUuid: orgUuid, bankAccountUuid, authorUuid: req.user.uuid,
		});
		return res.json({ success: true, ...result });
	} catch (e) {
		if (respondOrgAccessError(e, res)) return;
		console.error("POST /bank-statements/import error:", e);
		return res.status(500).json({ success: false, message: e.message || "Ошибка импорта выписки" });
	}
});

export default router;
