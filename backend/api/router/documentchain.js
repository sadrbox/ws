// Роутер цепочки связанных документов (Stage C).
// GET /documents/:type/:uuid/document-chain — дерево связанных документов.
import express from "express";
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

export default router;
