// T2.1 — генерация OpenAPI интроспекцией Express. HEADLESS: строим приложение в
// памяти (без listen), проверяем восстановление путей/методов/тегов/параметров.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildOpenApiSpec, swaggerHtml } from "../services/openapi.js";

function makeApp() {
	const app = express();
	const r = express.Router();
	r.get("/sales", (_q, s) => s.end());
	r.post("/sales", (_q, s) => s.end());
	r.get("/sales/:id", (_q, s) => s.end());
	r.put("/sales/:id", (_q, s) => s.end());
	app.use("/api/v1", r);
	const deep = express.Router();
	deep.get("/", (_q, s) => s.end());
	app.use("/api/v1/activityhistories", deep);
	return app;
}

test("buildOpenApiSpec: восстанавливает полные пути и методы", () => {
	const spec = buildOpenApiSpec(makeApp());
	assert.equal(spec.openapi, "3.0.3");
	assert.ok(spec.paths["/api/v1/sales"], "путь /api/v1/sales собран");
	assert.ok(spec.paths["/api/v1/sales"].get, "GET есть");
	assert.ok(spec.paths["/api/v1/sales"].post, "POST есть");
});

test("buildOpenApiSpec: :id → {id} + parameter в спеке", () => {
	const spec = buildOpenApiSpec(makeApp());
	const op = spec.paths["/api/v1/sales/{id}"];
	assert.ok(op, "путь с {id} собран");
	assert.ok(op.get && op.put, "GET и PUT есть");
	assert.deepEqual(op.get.parameters, [{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
});

test("buildOpenApiSpec: тег = ресурс (первый значимый сегмент после api/v1)", () => {
	const spec = buildOpenApiSpec(makeApp());
	assert.deepEqual(spec.paths["/api/v1/sales"].get.tags, ["sales"]);
	assert.ok(spec.tags.some((t) => t.name === "sales"));
	// вложенный префикс монтирования
	assert.ok(spec.paths["/api/v1/activityhistories"], "deep-mount путь собран");
	assert.deepEqual(spec.paths["/api/v1/activityhistories"].get.tags, ["activityhistories"]);
});

test("buildOpenApiSpec: servers прокидываются", () => {
	const spec = buildOpenApiSpec(makeApp(), { servers: ["https://aleppo.kz"] });
	assert.deepEqual(spec.servers, [{ url: "https://aleppo.kz" }]);
});

test("swaggerHtml: подставляет url спеки и грузит swagger-ui с cdnjs", () => {
	const html = swaggerHtml("/api/v1/openapi.json");
	assert.match(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/swagger-ui/);
	assert.match(html, /"\/api\/v1\/openapi\.json"/);
});
