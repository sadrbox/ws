import express from "express";
import cors from "cors";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { parse, formatISO } from "date-fns";
import { formatIpAddress } from "./utils/format.js";
import { getLocalIP } from "./utils/module.js";
import apiv1 from "./api/v1.js";

const prisma = new PrismaClient();
const app = express();

app.use("/api/v1", apiv1);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/users", async (req, res) => {
	const users = await prisma.user.findMany();
	res.json(users);
});

app.get("/users/delete", async (req, res) => {
	await prisma.user.deleteMany();
	res.status(204).send(); // Возвращаем пустой ответ
});

app.post("/users", async (req, res) => {
	try {
		const newUser = await prisma.user.create({
			data: { ...req.body },
		});
		res.status(201).json(newUser);
	} catch (error) {
		res.status(500).json({ error: error.message });
	}
});

app.get("/", (req, res) => {
	res.status(200).json({ message: "JSON успешно получен!" });
});

app.post("/json", async (req, res) => {
	console.log(JSON.stringify(req.body, null, 2));

	const {
		actionDate,
		actionType,
		organization: { shortName, bin },
		user: { userName, host, ip },
		object: { id: objectId, name: objectName, type: objectType },
		props,
	} = req.body;

	const formatActionDate = parse(actionDate, "dd.MM.yyyy HH:mm:ss", new Date());
	const clientIp = ip || formatIpAddress(req.ip);
	const formattedActionDate = formatISO(formatActionDate);

	let city = "";
	try {
		const { data: locationData } = await axios.get(
			`https://json.geoiplookup.io/${clientIp}`
		);
		city = locationData.success ? locationData.city : "";
	} catch (error) {}

	try {
		const transaction = await prisma.$transaction(async (prisma) => {
			const existingOrganization = await prisma.organization.upsert({
				where: {
					OR: [{ bin: bin || undefined }, { shortName }],
				},
				update: {},
				create: { shortName, bin },
			});

			return await prisma.activityHistory.create({
				data: {
					actionDate: formattedActionDate,
					actionType,
					organization: { connect: { bin: existingOrganization.bin } },
					userName,
					host,
					ip: clientIp,
					city: city !== undefined ? city : "",
					objectId,
					objectType,
					objectName,
					props,
				},
			});
		});

		// console.log(transaction);
		res.status(200).json({ message: "JSON успешно получен!" });
	} catch (error) {
		res
			.status(500)
			.json({ message: "Error processing transaction.", error: error.message });
	}
});

app.get("api/json", async (req, res) => {
	try {
		const activities = await prisma.activityHistory.findMany({
			include: { organization: true },
		});
		res.status(200).json(activities);
	} catch (error) {
		console.error("Error fetching activity history:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

app.get("/json", async (req, res) => {
	try {
		const { bin, shortName } = req.query;
		const activities = await prisma.activityHistory.findMany({
			where: {
				OR: [
					{ bin: bin || undefined }, // Если `bin` есть
					{
						organization: {
							shortName: bin ? undefined : shortName, // Если `bin` пустой, ищем по `shortName`
						},
					},
				],
			},
			include: { organization: true },
		});
		res.status(200).json(activities);
	} catch (error) {
		console.error("Error fetching activity history:", error);
		res
			.status(500)
			.json({ message: "Error fetching data.", error: error.message });
	}
});

app.get("/api/v1/history/:id", async (req, res) => {
	const id = parseInt(req.params.id);
	try {
		const history = await prisma.activityHistory.findUnique({
			where: {
				id: id, // Замените 'id' на имя вашего уникального ключа, если оно отличается
			},
		});
		if (!history) {
			return res.status(404).json({ error: "Данные не найдены." });
		}
		res.json(history);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: "Произошла ошибка" });
	}
});

const ip = getLocalIP();
const port = 3000;
app.listen(port, () => {
	console.log(`Server is running on http://${ip}:${port}`);
});
