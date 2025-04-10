import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
// import { parse, formatISO } from "date-fns";
// import { formatIpAddress } from "./utils/format.js";
// import { getLocalIP } from "./utils/module.js";
// import apiv1 from "./api/v1.js";

const prisma = new PrismaClient();
const router = express.Router();
router.use(cors());

router.get("/activityhistories", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [activityHistories, total] = await prisma.$transaction([
			prisma.activityHistory.findMany({
				skip,
				take: limit,
				include: {
					organization: true,
				},
			}),
			prisma.activityHistory.count(),
		]);

		res.status(200).json({
			items: activityHistories,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/counterparties", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [counterparties, total] = await prisma.$transaction([
			prisma.counterparty.findMany({
				skip,
				take: limit,
				// include: {
				// 	organization: true,
				// 	counterparty: true,
				// },
			}),
			prisma.counterparty.count(),
		]);

		res.status(200).json({
			items: counterparties,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/organizations", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [organizations, total] = await prisma.$transaction([
			prisma.organization.findMany({
				skip,
				take: limit,
				// include: {
				// 	organization: true,
				// 	counterparty: true,
				// },
			}),
			prisma.organization.count(),
		]);

		res.status(200).json({
			items: organizations,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/contracts", async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 100;
		const skip = (page - 1) * limit;

		const [contracts, total] = await prisma.$transaction([
			prisma.contract.findMany({
				skip,
				take: limit,
				// include: {
				// 	organization: true,
				// 	counterparty: true,
				// },
			}),
			prisma.contract.count(),
		]);

		res.status(200).json({
			items: contracts,
			total,
			page,
			totalPages: Math.ceil(total / limit),
		});
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/data", (req, res) => {
	res.json({ message: "Data response" });
});

export default router;
