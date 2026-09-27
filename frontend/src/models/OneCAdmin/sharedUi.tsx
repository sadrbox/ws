/**
 * Общие КОМПОНЕНТЫ вкладок «Администрирования 1С»: сообщения на доску (способность агента,
 * «только просмотр», задержка обновления, ошибка запроса) и объяснение закрытого сводного списка.
 *
 * Отдельно от shared.ts (аудит 26.09, Fast Refresh): модуль, где рядом с компонентами лежат
 * функции и хуки, при каждой правке перезагружал страницу целиком.
 */
import type { FC, ReactNode } from "react";
import { translate } from "src/i18";
import type { NoticeItem } from "src/components/Notice";
import { hasCapability } from "src/services/onec/api";
import { useNoticeReport, useNoticeScope } from "src/components/TechMessages/store";
import { errorText } from "src/services/errors/route";
import { useAgents } from "./agentsQuery";
import { useOnecWrite } from "./shared";
import styles from "./OneCAdmin.module.scss";

/**
 * «Агент этого не умеет» — СООБЩЕНИЕМ НА ДОСКУ, а не блоком над таблицей.
 *
 * Раньше предупреждение занимало слот постоянной высоты в каждом экране: он не давал
 * разметке прыгать, но отнимал строку у таблицы всегда — и на девяти экранах из десяти
 * ради пустоты. Теперь экран сообщает о своём состоянии доске сообщений (правая область
 * панели, для карточки — её собственная полоса), и не рисует ничего.
 *
 * `scope` берётся из контекста доски: панель и каждая карточка — своя область.
 */
export const CapabilityGuard: FC<{ capability: string; children?: ReactNode }> = ({ capability }) => {
	const agents = useAgents();
	const scope = useNoticeScope();
	const ok = agents.isLoading || hasCapability(agents.data?.items, capability);

	const online = (agents.data?.items ?? []).filter((a) => a.role === "admin" && a.online && !a.disabled);
	// Агент НА СВЯЗИ, но способности нет — почти всегда это его обновление: новая сборка
	// объявила меньше прежней. Сообщение называет, сколько он объявляет сейчас, иначе
	// связь с обновлением агента приходится угадывать.
	const declared = online[0]?.capabilities.length ?? 0;
	// Агент НА СВЯЗИ, но без способности — предупреждение: часть экрана работает.
	// Агента нет вовсе — внимание: не выполнится ни одна команда.
	const items: NoticeItem[] = ok ? [] : [online.length
		? {
			type: "warning",
			text: `${translate("onecCapabilityMissing")}: ${capability}. ${translate("onecCapabilityLostHint")} (${declared})`,
		}
		: { type: "attention", text: translate("onecNoAdminAgent") }];

	useNoticeReport(scope, `capability_${capability}`, translate("onecAgentCapability"), items);
	return null;
};

/**
 * ПОЧЕМУ КОМАНД НЕ ВИДНО — сказать один раз на экран, а не молчать.
 *
 * Спрятанные кнопки без объяснения читаются как поломка: «у меня нет кнопки «Создать», а у
 * коллеги есть». Сообщение называет причину — прав хватает на просмотр, — и человек идёт к
 * тому, кто выдаёт права, а не в поддержку искать пропавшую кнопку.
 */
export const ReadonlyNotice: FC = () => {
	const canWrite = useOnecWrite();
	const scope = useNoticeScope();
	useNoticeReport(scope, "onec_readonly", translate("onecAdmin"),
		canWrite ? [] : [{ type: "info", text: translate("onecReadonlyHint") }]);
	return null;
};

/**
 * «ОБНОВИТСЯ С ЗАДЕРЖКОЙ» — сказать заранее, а не оставить человека с догадкой.
 *
 * Агент со способностью `ib.echo` приносит новое содержимое базы своим же ответом, и таблица
 * показывает изменение сразу. Агент без неё обновляет реестр ВТОРОЙ командой — тем же входом
 * в базу на секунды, — и после «Выполнено» список ещё несколько секунд прежний. Без
 * объяснения это выглядит случайностью: «у одних обновляется сразу, у других нет», и человек
 * жмёт «Обновить» или повторяет команду, решив, что она не сработала.
 *
 * Это НЕ отказ: операция выполняется полностью, поэтому тип сообщения — `info`, а не
 * предупреждение (ср. CapabilityGuard, где способности нет и часть экрана не работает).
 * Пока агента вообще нет на связи, молчим: об этом скажет CapabilityGuard, и два сообщения
 * об одном и том же спорили бы, какое главное.
 */
export const EchoDelayNotice: FC = () => {
	const agents = useAgents();
	const scope = useNoticeScope();
	const online = (agents.data?.items ?? []).filter((a) => a.role === "admin" && a.online && !a.disabled);
	const show = !agents.isLoading && online.length > 0 && !hasCapability(agents.data?.items, "ib.echo");

	useNoticeReport(scope, "capability_ib_echo", translate("onecAgentCapability"),
		show ? [{ type: "info", text: translate("onecEchoMissingHint") }] : []);
	return null;
};

/**
 * Причина, по которой таблица пуста. Ошибку запроса react-query по умолчанию НИКУДА не
 * показывает: пользователь видел пустой список и ни слова о том, что 1С ответила отказом.
 * Текст приходит от сервиса и написан для человека — передаём как есть.
 *
 * Рисует НИЧЕГО: сообщение уходит на доску. Блок над таблицей сдвигал её вниз ровно в тот
 * момент, когда человек в ней работал, — а исчезнув, сдвигал обратно.
 */
export const QueryError: FC<{ error: unknown; source?: string; noticeKey?: string }> = ({ error, source, noticeKey }) => {
	const scope = useNoticeScope();
	// Только Error даёт осмысленный текст; всё прочее — неизвестная ошибка, а не
	// «[object Object]» в лицо пользователю.
	// Текст — через общий разбор: он же превращает «Failed to fetch» в «Нет связи с сервером».
	const text = !error ? "" : errorText(error);
	// Ключ по умолчанию — по тексту: у экрана может быть несколько запросов, и без своего
	// ключа второй затирал бы сообщение первого.
	const key = noticeKey ?? `query_${text.slice(0, 40)}`;
	// Ошибка предметной области (1С ответила отказом, сервис отверг запрос) — «error»:
	// системные сбои сюда не попадают, для них <UIToast />.
	useNoticeReport(scope, key, source ?? translate("onecAdmin"), text ? [{ type: "error", text }] : []);
	return null;
};

export const SharedListForbidden: FC = () => (
	<div className={styles.Hint}>{translate("onecSharedListsForbidden")}</div>
);
