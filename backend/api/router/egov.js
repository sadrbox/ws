// Роутер интеграции с Открытыми данными eGov (регистрационные данные ЮЛ по БИН).
// Используется формами Организации/Контрагента для автозаполнения реквизитов.
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { fetchLegalEntity, egovConfigured, getEgovConfig, EgovError } from "../../services/egov/index.js";
import { setSettings } from "../../services/appSettings.js";

const router = express.Router();

const OWNER_MODEL = { organization: "organization", counterparty: "counterparty" };

/** Upsert контакта юр.адреса (один legal_address на владельца). */
async function upsertLegalAddress(ownerType, ownerUuid, address) {
	if (!address) return false;
	const existing = await prisma.contact.findFirst({
		where: { ownerType, ownerUuid, contactType: "legal_address", deletedAt: null },
		orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
	});
	if (existing) await prisma.contact.update({ where: { uuid: existing.uuid }, data: { value: address } });
	else await prisma.contact.create({ data: { ownerType, ownerUuid, contactType: "legal_address", value: address, isPrimary: true } });
	return true;
}

/** Upsert контактного лица-руководителя (по fullName, без дублей). */
async function upsertDirector(ownerType, ownerUuid, fio) {
	if (!fio) return false;
	const existing = await prisma.contactPerson.findFirst({
		where: { ownerType, ownerUuid, fullName: fio, deletedAt: null },
	});
	if (!existing) await prisma.contactPerson.create({ data: { ownerType, ownerUuid, fullName: fio, comment: "Руководитель (eGov)" } });
	return true;
}

// GET /egov/legal-entity/:bin → регистрационные данные ЮЛ (или 404)
router.get("/egov/legal-entity/:bin", async (req, res) => {
	if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
	try {
		const data = await fetchLegalEntity(req.params.bin);
		if (!data) return res.status(404).json({ success: false, message: "ЮЛ с таким БИН не найдено в eGov" });
		res.json({ success: true, data });
	} catch (err) {
		if (err instanceof EgovError) return res.status(err.httpStatus || 502).json({ success: false, message: err.message });
		console.error("GET /egov/legal-entity error:", err);
		res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// POST /egov/apply { ownerType, uuid, bin } → тянет из eGov и записывает:
// name/legalName сущности + юр.адрес в Контакты + руководителя в Контактные лица.
router.post("/egov/apply", async (req, res) => {
	if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
	try {
		const { ownerType, uuid, bin } = req.body || {};
		const model = OWNER_MODEL[ownerType];
		if (!model) return res.status(400).json({ success: false, message: "Некорректный ownerType" });
		if (!uuid) return res.status(400).json({ success: false, message: "Сначала сохраните запись" });

		const data = await fetchLegalEntity(bin);
		if (!data) return res.status(404).json({ success: false, message: "ЮЛ с таким БИН не найдено в eGov" });

		if (data.name) {
			await prisma[model].update({ where: { uuid }, data: { legalName: data.name, name: data.name } });
		}
		const addressSaved = await upsertLegalAddress(ownerType, uuid, data.address);
		const directorSaved = await upsertDirector(ownerType, uuid, data.director);

		res.json({ success: true, data, applied: { name: !!data.name, address: addressSaved, director: directorSaved } });
	} catch (err) {
		if (err instanceof EgovError) return res.status(err.httpStatus || 502).json({ success: false, message: err.message });
		console.error("POST /egov/apply error:", err);
		res.status(500).json({ success: false, message: "Ошибка сервера" });
	}
});

// GET /egov/status → настроена ли интеграция (для UI: показывать ли кнопку)
router.get("/egov/status", async (req, res) => {
	if (!req.user?.uuid) return res.status(401).json({ success: false, message: "Требуется авторизация" });
	res.json({ success: true, configured: await egovConfigured() });
});

// GET /egov/config → текущие настройки (apiKey маскируется), суперадмин
router.get("/egov/config", async (req, res) => {
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только для суперадмина" });
	const c = await getEgovConfig();
	res.json({ success: true, config: { baseUrl: c.baseUrl, dataset: c.dataset, version: c.version, hasApiKey: !!c.apiKey } });
});

// PUT /egov/config → сохранить настройки (apiKey пишется только если передан непустым)
router.put("/egov/config", async (req, res) => {
	if (!req.user?.isSuperAdmin) return res.status(403).json({ success: false, message: "Только для суперадмина" });
	try {
		const { baseUrl, dataset, version, apiKey } = req.body || {};
		const patch = {};
		if (baseUrl !== undefined) patch["egov.baseUrl"] = baseUrl;
		if (dataset !== undefined) patch["egov.dataset"] = dataset;
		if (version !== undefined) patch["egov.version"] = version;
		if (apiKey) patch["egov.apiKey"] = apiKey; // пустой — не трогаем (не стираем секрет)
		await setSettings(patch);
		res.json({ success: true });
	} catch (err) {
		console.error("PUT /egov/config error:", err);
		res.status(500).json({ success: false, message: "Ошибка сохранения" });
	}
});

export default router;
