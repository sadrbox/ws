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

router.get("/counterparties", async (req, res) => {
	try {
		const counterparties = await prisma.counterparty.findMany();
		res.status(200).json(counterparties);
	} catch (error) {
		console.error("Error fetching:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

router.get("/contracts", async (req, res) => {
	const contracts = await prisma.contract.findMany();
	res.json({ contracts });
});

router.get("/data", (req, res) => {
	res.json({ message: "Data response" });
});

export default router;
