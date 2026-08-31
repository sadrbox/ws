// ─────────────────────────────────────────────────────────────────────────────
// Генерация OpenAPI 3 спецификации ИНТРОСПЕКЦИЕЙ смонтированного Express-приложения
// (T2.1). Обходит app._router.stack, восстанавливает метод+полный путь каждого
// маршрута и собирает минимальную, но валидную спеку: пути сгруппированы по
// ресурсу (первый значимый сегмент → tag), параметры пути объявлены, ответы —
// generic (200/4xx). Без смены валидации на схемы — это ЗАДЕЛ под доку API:
// перечисляем то, что реально отвечает сервер.
//
// Спека строится ЛЕНИВО по запросу (из req.app), поэтому видит все роутеры,
// смонтированные к моменту запроса; отдельного реестра не требуется.
// ─────────────────────────────────────────────────────────────────────────────

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** Восстановить префикс монтирования роутера из layer.regexp (+ layer.keys для :param). */
function layerPrefix(layer) {
	const rx = layer.regexp;
	if (!rx || rx.fast_slash) return "";
	let src = rx.source
		.replace(/^\^/, "")
		.replace(/\\\/\?\(\?=\\\/\|\$\)$/, "") // хвост "\/?(?=\/|$)"
		.replace(/\$$/, "");
	let path = src.replace(/\\\//g, "/");
	if (layer.keys?.length) {
		let i = 0;
		path = path.replace(/\(\[\^\\?\/]\+\?\)/g, () => `:${layer.keys[i++]?.name ?? "param"}`);
	}
	return path;
}

/** Express-путь ":id" → OpenAPI "{id}" + список имён параметров. */
function toOpenApiPath(p) {
	const params = [];
	const path = p.replace(/:([A-Za-z0-9_]+)/g, (_, name) => { params.push(name); return `{${name}}`; });
	return { path: path || "/", params };
}

/** Тег (группа) = первый значимый сегмент пути после /api/v?/. */
function tagFor(path) {
	const seg = path.split("/").filter(Boolean);
	// пропускаем api / v1
	const i = seg.findIndex((s) => s !== "api" && !/^v\d+$/.test(s));
	const raw = i >= 0 ? seg[i] : "root";
	return raw.replace(/\{.*\}/g, "").replace(/[^A-Za-z0-9-]/g, "") || "root";
}

/** Обойти стек роутера рекурсивно, собрать { "полный/путь": Set(методы) }. */
function collectRoutes(stack, prefix, out) {
	for (const layer of stack ?? []) {
		if (layer.route) {
			const full = prefix + layer.route.path;
			const methods = Object.keys(layer.route.methods || {}).filter((m) => HTTP_METHODS.has(m));
			if (!methods.length) continue;
			const set = out.get(full) || new Set();
			for (const m of methods) set.add(m);
			out.set(full, set);
		} else if ((layer.name === "router" || layer.handle?.stack) && layer.handle?.stack) {
			collectRoutes(layer.handle.stack, prefix + layerPrefix(layer), out);
		}
	}
}

/**
 * Построить OpenAPI 3.0 документ по смонтированному приложению.
 * @param {import('express').Express} app
 * @param {{title?:string, version?:string, servers?:string[]}} [opts]
 */
export function buildOpenApiSpec(app, { title = "BuhProf ERP API", version = "1.0.0", servers } = {}) {
	const routes = new Map();
	// Express 4: app._router.stack (геттер app.router БРОСАЕТ — не трогаем его первым);
	// Express 5: app.router.stack.
	let stack = [];
	if (app?._router?.stack) stack = app._router.stack;
	else { try { stack = app?.router?.stack ?? []; } catch { stack = []; } }
	collectRoutes(stack, "", routes);

	const paths = {};
	const tags = new Set();
	for (const [rawPath0, methods] of [...routes.entries()].sort()) {
		// Нормализация: схлопнуть «//» и срезать хвостовой «/» (кроме корня).
		const rawPath = rawPath0.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
		const { path, params } = toOpenApiPath(rawPath);
		const tag = tagFor(path);
		tags.add(tag);
		paths[path] = paths[path] || {};
		const parameters = params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } }));
		for (const method of methods) {
			paths[path][method] = {
				tags: [tag],
				summary: `${method.toUpperCase()} ${path}`,
				...(parameters.length ? { parameters } : {}),
				responses: {
					200: { description: "OK" },
					400: { description: "Некорректный запрос" },
					401: { description: "Требуется авторизация" },
					404: { description: "Не найдено" },
				},
			};
		}
	}

	return {
		openapi: "3.0.3",
		info: { title, version, description: "Автогенерация из маршрутов Express (T2.1). Схемы тел — задел; ответы generic." },
		...(servers ? { servers: servers.map((url) => ({ url })) } : {}),
		tags: [...tags].sort().map((name) => ({ name })),
		paths,
	};
}

/** HTML-страница Swagger UI (грузит spec по url). CDN — swagger-ui-dist. */
export function swaggerHtml(specUrl) {
	return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>BuhProf ERP API</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css"/>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
<script>
window.onload = function () {
	window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: "#swagger-ui", deepLinking: true });
};
</script>
</body>
</html>`;
}

export default { buildOpenApiSpec, swaggerHtml };
