// Документация API (T2.1): спецификация OpenAPI + страница Swagger UI.
// Монтируется ДО authMiddleware — это публичная дока (перечень маршрутов, без данных),
// сервис за cloudflared. Спека строится из живого приложения (req.app) при запросе.
import express from "express";
import { buildOpenApiSpec, swaggerHtml } from "../../services/openapi.js";

const router = express.Router();

// JSON-спецификация.
router.get("/api/v1/openapi.json", (req, res) => {
	const proto = req.headers["x-forwarded-proto"] || req.protocol;
	const base = `${proto}://${req.get("host")}`;
	res.json(buildOpenApiSpec(req.app, { servers: [base] }));
});

// Интерактивная дока. Переопределяем CSP (глобальный helmet = default-src 'self'),
// чтобы Swagger UI мог загрузиться с cdnjs и выполнить инлайн-инициализацию.
router.get("/api/docs", (_req, res) => {
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
		"style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self'",
	);
	res.type("html").send(swaggerHtml("/api/v1/openapi.json"));
});

export default router;
