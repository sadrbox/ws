// Роутер цепочки связанных документов (Stage C).
// GET /documents/:type/:uuid/document-chain — дерево связанных документов.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { buildDocumentChain, DOC_REGISTRY } from "../../services/documentChain.js";

const router = express.Router();

router.get("/documents/:type/:uuid/document-chain", async (req, res) => {
	try {
		const { type, uuid } = req.params;
		if (!DOC_REGISTRY[type]) {
			return res.status(400).json({ success: false, message: `Неизвестный тип документа: ${type}` });
		}
		const chain = await buildDocumentChain(type, uuid);
		if (!chain) {
			return res.status(404).json({ success: false, message: "Документ не найден" });
		}
		return res.status(200).json({ success: true, ...chain });
	} catch (error) {
		console.error("GET /documents/:type/:uuid/document-chain error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /documents/:type/:uuid/clear-basis — очистить «висячую» связь основания
// у документа (basisDocumentType/Uuid/Label → null). Чинит integrity.dangling из
// чейн-вьюера: основание было удалено, а ссылка осталась.
router.post("/documents/:type/:uuid/clear-basis", async (req, res) => {
	try {
		const { type, uuid } = req.params;
		const def = DOC_REGISTRY[type];
		if (!def) {
			return res.status(400).json({ success: false, message: `Неизвестный тип документа: ${type}` });
		}
		if (!def.hasBasis) {
			return res.status(400).json({ success: false, message: "Документ не может иметь основания" });
		}
		const existing = await prisma[def.model].findUnique({ where: { uuid }, select: { uuid: true } });
		if (!existing) {
			return res.status(404).json({ success: false, message: "Документ не найден" });
		}
		await prisma[def.model].update({
			where: { uuid },
			data: { basisDocumentType: null, basisDocumentUuid: null, basisDocumentLabel: null },
		});
		return res.status(200).json({ success: true, message: "Связь основания очищена" });
	} catch (error) {
		if (error.code === "P2025") {
			return res.status(404).json({ success: false, message: "Документ не найден" });
		}
		console.error("POST /documents/:type/:uuid/clear-basis error:", error);
		return res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

export default router;
