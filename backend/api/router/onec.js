// ─────────────────────────────────────────────────────────────────────────────
// Прокси реестра баз 1С для ШТАТНОГО списка (E15/L1).
//
// ЗАЧЕМ. Базы живут в сервисе `ai`, а общий компонент списков (ModelList →
// useInfiniteModelList) умеет ходить только в API ERP по endpoint. Из-за этого список
// баз собирался вручную и расходился с остальными списками приложения: другое открытие
// элемента, свой предпросмотр, свой множественный выбор.
//
// Прокси делает базы обычным эндпоинтом ERP — и штатный список работает как есть.
// Попутно закрывается то, ради чего прокси предлагался изначально: единый контур
// авторизации и аудит бэкенда.
//
// ТОЛЬКО ЧТЕНИЕ. Базы заводят и удаляют в кластере 1С, а не здесь: ни POST, ни DELETE
// тут нет и быть не должно (список открывается с hideAddDelete).
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { isListedBase, parseSort, sortBases } from "../../utils/onecBasesList.js";

const router = express.Router();
const ROUTE = "onec-bases";

/** Адрес сервиса ai. Тот же, что у панели; на одной машине — локальный. */
const AI_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:3100";

router.get(`/${ROUTE}`, async (req, res) => {
	try {
		const r = await fetch(`${AI_URL}/v1/onec/bases`, {
			headers: { authorization: req.headers.authorization ?? "" },
		});
		const body = await r.json().catch(() => null);
		if (!r.ok || !body?.success) {
			// Ошибку сервиса отдаём как есть: её текст написан для человека. Код не 5xx —
			// иначе прокси перед бэкендом подменит ответ своей страницей.
			return res.status(r.status === 500 ? 502 : r.status).json({
				success: false,
				message: body?.error?.message || "Сервис 1С недоступен",
			});
		}

		const all = (body.data?.items ?? []).map((b, i) => ({
			// Числовой id нужен курсорной подгрузке и идентификации строк в таблице.
			// Порядок стабилен: сервис отдаёт базы отсортированными по серверу и ключу.
			id: i + 1,
			uuid: b.id,
			baseKey: b.key,
			name: b.name,
			status: b.status,
			// Что знает о базе кластер, независимо от скрытия (С44): по нему карточка решает, удалять ли регистрацию
			// или убирать базу из списка.
			clusterStatus: b.clusterStatus ?? b.status,
			serverName: b.serverName,
			onecVersion: b.onecVersion,
			extensionsCount: b.extensionsCount,
			sessionsCount: b.sessionsCount,
			lastSeenAt: b.lastSeenAt,
			infobaseId: b.infobaseId,
			extensionNames: b.extensionNames ?? [],
			// Публикация: три состояния (не проверялась / опубликована / нет), см. миграцию 008.
			published: b.published,
			publishUrl: b.publishUrl,
			// Адрес под публичным именем сервера («Настройки» панели). Отдельно от
			// publishUrl: там ответ агента, и подменять его догадкой значит лишиться
			// возможности заметить ошибку в привязке сайта IIS.
			publishUrlPublic: b.publishUrlPublic,
			// Когда состояние публикации проверяли. Без даты «не опубликована» и
			// «не проверялась» выглядят в списке одинаково убедительно, хотя второе —
			// незнание: срез публикаций сервис принимает не всегда (см. applyPublications).
			publishSeenAt: b.publishSeenAt,
			// База числится в кластере, но войти в неё нельзя. Отдельно от status: тот
			// отвечает «зарегистрирована ли», а это — «можно ли с ней работать».
			ibUnreachableAt: b.ibUnreachableAt,
			// ПОЧЕМУ не войти: «базы нет в СУБД» и «не пускают» лечатся по-разному, и
			// общее «недоступна» заставляет выяснять это заново по тексту ошибки.
			ibUnreachableReason: b.ibUnreachableReason,
			disabled: b.disabled,
		}))
			// Скрытые и удалённые из кластера — только по переключателю (utils/onecBasesList, П33). Отбор ПОСЛЕ
			// нумерации: иначе удаление или скрытие базы сдвигало бы id всех следующих строк, и отметки в таблице
			// переезжали бы на соседние базы.
			.filter((x) => isListedBase(x, { showHidden: req.query.showHidden === "1" }));

		// Поиск — по видимым текстовым полям; служебные id/uuid не ищем.
		const needle = String(req.query.search ?? "").trim().toLowerCase();
		let items = needle
			? all.filter((x) =>
				[x.baseKey, x.name, x.status, x.serverName, x.onecVersion]
					.some((v) => v && String(v).toLowerCase().includes(needle)))
			: all;

		// «Статус» — по показанному состоянию, а не по коду кластера (utils/onecBasesList).
		items = sortBases(items, parseSort(req.query.sort));

		const total = items.length;
		const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
		const cursor = req.query.cursor !== undefined ? Number(req.query.cursor) : null;
		const from = cursor !== null && Number.isFinite(cursor)
			? items.findIndex((x) => x.id === cursor) + 1
			: 0;
		const page = items.slice(from, from + limit);
		const hasMore = from + limit < items.length;

		return res.json({
			success: true,
			items: page,
			nextCursor: hasMore && page.length ? page[page.length - 1].id : null,
			hasMore,
			...(cursor === null ? { total } : {}),
		});
	} catch (e) {
		console.error(`GET /${ROUTE} error:`, e?.message || e);
		return res.status(502).json({ success: false, message: "Сервис 1С недоступен" });
	}
});

export default router;
