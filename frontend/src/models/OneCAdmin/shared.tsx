/**
 * Общее для вкладок «Администрирования 1С»: применимость операции к базе, чтение
 * содержимого базы, состояние агентов, сообщения об отказах и разделитель половин.
 *
 * Таблица баз с отметками отсюда убрана: она осталась от прежнего устройства панели и не
 * вызывалась ниоткуда — выбор баз давно живёт там, где базы и показывают.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import { useAppContext } from "src/app/context";
import { buildOnecPermissions, type OnecPermissions } from "./onecPermissions";
import type { NoticeItem } from "src/components/Notice";
import { showToast } from "src/components/UIToast";
import {
	fetchBaseExtensions, fetchBaseUsers, fetchAgents, fetchServers, hasCapability,
	type BatchStart, type OnecBase,
} from "src/services/onec/api";
import { previewUrl } from "./ServerParams";
import { finishOp, progressOp, startOp } from "./progress";
import { noteNotice, notify, useNoticeReport, useNoticeScope } from "src/components/TechMessages/store";
import { errorText } from "src/services/errors/route";
import { useOpenOnecBase } from "src/models/OneCBases";
import { requestBaseTab } from "src/models/OneCBases/openAt";
import styles from "./OneCAdmin.module.scss";

/**
 * Применимость операции к базе.
 *
 * ЗАЧЕМ. Половина обращений в поддержку выглядела как «база «X» не найдена в кластере»:
 * команду отправляли в базу, к которой она в принципе неприменима — в пропавшую,
 * отключённую или неопубликованную. Дешевле не показывать такую базу как цель, чем
 * объяснять постфактум, почему сто команд из ста завершились ошибкой.
 *
 * `ib` — операции внутри базы (пользователи — только COM, расширения — ibcmd или COM):
 *        нужна живая база в кластере.
 *        Публикация на веб-сервере здесь НИ ПРИ ЧЁМ: COM-соединение идёт к серверу 1С
 *        напрямую, и неопубликованная база — такая же полноценная цель. Отбирать её было бы
 *        ошибкой: базу как раз и готовят к публикации, заводя в ней пользователей.
 * `http` — операции через расширение buhprof_api: вот им публикация нужна.
 * `publish` / `unpublish` — сама публикация и её снятие: применимы к любой живой базе.
 *        Кэшированное состояние публикации целей НЕ отбирает: оно отстаёт от жизни, и
 *        «уже опубликована» превращалось в тупик, когда публикацию сняли мимо панели —
 *        запрещённой оказывалась ровно та команда, которой это расхождение и лечится.
 *        Обе операции идемпотентны по контракту, поэтому лишний запуск безвреден.
 */
/**
 * Канал операции: `cluster` — команда кластера по базе (rac), в базу не входит (регламентные задания); `drop` —
 * снятие регистрации в кластере; `record` — удаление записи о базе в самой панели (ни кластера, ни базы не касается).
 */
export type OnecOperation = "ib" | "http" | "publish" | "unpublish" | "cluster" | "drop" | "record";

/** Принимает всё, у чего есть эти три поля: строку списка баз или запись реестра. */
export function isApplicable(
	b: Pick<OnecBase, "status" | "disabled" | "published"> & {
		ibUnreachableAt?: string | null;
		ibUnreachableReason?: string | null;
		clusterStatus?: string;
	},
	op: OnecOperation,
): boolean {
	/*
	 * СНЯТЬ РЕГИСТРАЦИЮ — пока она есть, то есть любой базе, кроме той, которой в кластере уже нет.
	 *
	 * Раньше требовался признак «в базу не войти», и это было неверно (17.09): признак появляется только после
	 * «Проверить базы данных» или неудачной команды, а до того панель считает базу рабочей. То есть команда пряталась
	 * ровно тогда, когда нужна. Судит здесь агент: он проверяет через СУБД, есть ли база данных, и у работающей базы
	 * отказывает — предсказать его ответ панель не может и не должна.
	 */
	if (op === "drop") return (b.clusterStatus ?? b.status) !== "MISSING";
	/*
	 * УДАЛИТЬ ЗАПИСЬ ИДЕНТИФИКАТОРА — только у базы, которой в кластере нет: у остальных запись вернёт полный срез
	 * через минуты, и человек решил бы, что удалил базу (сервис такую попытку и отклоняет).
	 */
	if (op === "record") return (b.clusterStatus ?? b.status) === "MISSING";
	// Базы, которой нет в кластере, нет ни для одной операции.
	if (b.status === "MISSING" || b.disabled) return false;
	/*
	 * БАЗЫ НЕТ ВОВСЕ — ни одна операция к ней неприменима, включая публикацию.
	 *
	 * Публикация не соединяется с базой и потому формально «сработала бы»: на веб-сервере
	 * появилась бы ссылка на несуществующие данные. Смысла в такой ссылке нет, а вреда —
	 * достаточно: по ней потом придут и получат «База данных не обнаружена». Пока причина
	 * не разобрана (UNKNOWN, «не пускают»), запрет остаётся прежним — только на команды
	 * внутрь базы: вопрос прав решается настройкой, а не исключением базы из работы.
	 */
	if (b.ibUnreachableReason === "NO_DB" || b.ibUnreachableReason === "NO_INFOBASE") return false;
	/*
	 * База ЧИСЛИТСЯ в кластере, но войти в неё нельзя — фантом: запись в кластере осталась,
	 * самой базы на СУБД уже нет. Для операций ВНУТРИ базы это отказ, известный заранее:
	 * посылать туда команду значит заставить человека ждать полминуты ради ответа, который
	 * у нас уже есть. Для команд уровня кластера (публикация, снятие) признак ничего не
	 * значит — они с базой не соединяются.
	 */
	if (op === "ib" && b.ibUnreachableAt) return false;
	// «Не проверялась» (null) публикацию не запрещает: считать незнание отказом значило бы
	// прятать базы, с которыми всё в порядке.
	// http — единственный случай, где состояние публикации означает НЕВОЗМОЖНОСТЬ:
	// у неопубликованной базы HTTP-канала нет физически.
	if (op === "http") return b.published !== false;
	return true;
}

/** К какому состоянию базы ведёт операция: опубликована ли, запрещены ли регламентные задания. */
export type OpTarget = { published?: boolean; jobsDenied?: boolean };

/**
 * БАЗА УЖЕ ТАМ, КУДА ВЕДЁТ ОПЕРАЦИЯ — почему команда ей не нужна; `""` — нужна.
 *
 * «Операции» списка баз (17.09): запрет регламентных заданий у базы, где они уже запрещены, и публикация
 * опубликованной ничего не меняют, а занимают очередь агента и строку в отчёте. Незнание (`null`) — не «уже»:
 * состояние не читали, и прятать такую базу значило бы решать за человека.
 *
 * По этому же правилу меню «Операции» решает, какие пункты доступны для отмеченных баз: пункт нужен, если хоть
 * одной из них он что-то изменит.
 */
export function alreadyInTarget(
	// Индекс-сигнатура — чтобы подходили и запись реестра, и строка таблицы (TDataItem).
	b: { published?: unknown; scheduledJobsDenied?: unknown; [field: string]: unknown },
	target: OpTarget | undefined,
): string {
	if (!target) return "";
	if (target.published !== undefined && b.published === target.published) {
		return translate(target.published ? "onecAlreadyPublished" : "onecAlreadyUnpublished");
	}
	if (target.jobsDenied !== undefined && b.scheduledJobsDenied === target.jobsDenied) {
		return translate(target.jobsDenied ? "onecJobsAlreadyDenied" : "onecJobsAlreadyAllowed");
	}
	return "";
}

/**
 * Пункт «Операций» ничего не изменит отмеченным базам: все они уже в нужном состоянии. Без отметок — изменит
 * (базы выбирают в помощнике); операция без целевого состояния (сведения, проверки) — всегда нужна.
 */
export const changesNothing = (
	selected: { published?: unknown; scheduledJobsDenied?: unknown; [field: string]: unknown }[],
	target: OpTarget | undefined,
): boolean => !!target && selected.length > 0 && selected.every((r) => alreadyInTarget(r, target) !== "");

/**
 * ПОЧЕМУ БАЗЕ НЕ НУЖНА (ИЛИ НЕ ПОДХОДИТ) КОМАНДА — одной строкой; `""` — подходит.
 *
 * Одно правило на два места: помощник пишет это в колонке «Пригодна», а меню «Операции» по нему отсеивает
 * отмеченные базы перед запуском — иначе задание уходило бы с заведомо непригодными целями.
 */
export function fitReason(
	b: Parameters<typeof isApplicable>[0] & Parameters<typeof alreadyInTarget>[0],
	needs: OnecOperation,
	target?: OpTarget,
): string {
	if (!isApplicable(b, needs)) return unreachableReason(b);
	return alreadyInTarget(b, target);
}

/**
 * Отмеченные базы — на те, которым команда нужна, и остальные (с причиной). По этому разбору меню «Операции»
 * запускает задание и говорит в подтверждении, сколько баз отсеяно и почему.
 */
export function splitTargets<T extends Parameters<typeof fitReason>[0]>(
	rows: readonly T[], needs: OnecOperation, target?: OpTarget,
): { targets: T[]; skipped: { row: T; reason: string }[] } {
	const targets: T[] = [];
	const skipped: { row: T; reason: string }[] = [];
	for (const r of rows) {
		const reason = fitReason(r, needs, target);
		if (reason) skipped.push({ row: r, reason }); else targets.push(r);
	}
	return { targets, skipped };
}

/** Колонки списка баз в режиме выбора цели: только то, что помогает выбрать. */
/** Публикация: null — «не проверялась», а не «нет» (см. миграцию 008). */
export const publishLabel = (v: boolean | null | undefined): string =>
	v === true ? translate("onecPublished")
		: v === false ? translate("onecNotPublished")
			: translate("onecPublishUnknown");

/**
 * Почему в базу не войти — словами человека и с подсказкой, что делать.
 *
 * Текст агента («база «shahs_backup» не найдена на сервере SERVER») верен, но не отвечает
 * на вопрос, который после него задают: как так, если она в списке? Отвечаем: в списке она
 * потому, что кластер её перечисляет; войти нельзя потому, что самой базы уже нет.
 */
export function unreachableReason(
	b: Pick<OnecBase, "status" | "disabled"> & {
		ibUnreachableAt?: string | null;
		ibUnreachableReason?: string | null;
	},
): string {
	if (b.disabled) return translate("onecBaseDisabled");
	if (b.status === "MISSING") return translate("onecBaseMissing");
	if (b.ibUnreachableAt) return translate(UNREACHABLE_TEXT[b.ibUnreachableReason ?? ""] ?? "onecBaseIbUnreachable");
	return translate("unknownError");
}

/**
 * ПОЧЕМУ в базу не войти — по коду из сервиса (см. ibFailureReason в ai/src/bases).
 *
 * Разница решает, что делать дальше, и потому названа словами. «Базы нет в СУБД» не
 * лечится повтором никогда: запись в кластере осталась, данных нет, и выход — либо
 * восстановить из копии, либо убрать регистрацию. «Не пускают» — вопрос учётных данных.
 * Общее «недоступна» заставляло человека выяснять это самому, по тексту ошибки, который он
 * уже один раз прочитал и не понял.
 */
const UNREACHABLE_TEXT: Record<string, string> = {
	NO_DB: "onecBaseNoDb",
	NO_INFOBASE: "onecBaseNoInfobase",
	NO_ACCESS: "onecBaseNoAccess",
	UNKNOWN: "onecBaseIbUnreachable",
};

/** Короткая подпись состояния базы-фантома для списка: в колонку длинный текст не влезет. */
export const unreachableShort = (reason?: string | null): string =>
	translate(reason === "NO_DB" ? "onecBaseNoDbShort"
		: reason === "NO_ACCESS" ? "onecBaseNoAccessShort"
			: "onecBaseUnreachableShort");

/**
 * КАКОЙ БУДЕТ ССЫЛКА после публикации — до того, как её нажали.
 *
 * Агент публикует базу на веб-сервере этой машины и честно возвращает адрес из привязки
 * сайта IIS — обычно `http://localhost/<база>`. С самого сервера он рабочий, снаружи по
 * нему не попасть. Имя, под которым сервер виден из сети, задают в карточке агента
 * («Параметры» → «Адрес сервера»), и именно оно решает, будет ли ссылка кому-то полезна.
 * Поэтому предупреждение о публикации называет адрес, а не пугает словом «localhost»:
 * заданный адрес — показываем, незаданный — говорим, где его указать.
 */
export function usePublishAddressHint(serverName?: string | null): NoticeItem {
	const servers = useQuery({ queryKey: ["onec", "servers"], queryFn: fetchServers });
	const items = servers.data?.items ?? [];
	// Сервер базы — по имени; когда сервер один, имя не нужно (и его может не быть в строке).
	const server = (serverName && items.find((s) => s.name === serverName))
		|| (items.length === 1 ? items[0] : null);
	const host = (server?.publicHost ?? "").trim();
	return host
		? { type: "info", text: `${translate("onecPublishAddress")}: ${previewUrl(host)}` }
		: { type: "warning", text: translate("onecPublishNoPublicHost") };
}

/**
 * ИТОГ ПОСТАНОВКИ ЗАДАНИЯ — словами, и без «успеха» там, где ничего не поставили.
 *
 * ЖИВОЙ СЛУЧАЙ (12.09). Операцию запустили при остановленном агенте: ни одна команда не
 * встала в очередь, а панель сказала «Поставлено в очередь: 0/1» жёлтым — как будто
 * что-то произошло. Человек ушёл ждать, задание два часа показывало «В работе: 1» без
 * единой строки, а на деле работы не начиналось вовсе.
 *
 * Правило: поставили всё — успех; поставили часть — предупреждение с числом; не поставили
 * ничего — ОШИБКА, и называем причину, которую вернул сервис («нет агента на связи»).
 */
export function reportBatchStart(r: BatchStart, source?: string): void {
	const reason = r.skipped[0]?.reason ?? "";
	if (!r.queued) {
		const text = `${translate("onecBatchNothingQueued")}${reason ? `: ${reason}` : ""}`;
		notify({ severity: "error", text, source: source ?? translate("onecCommands") });
		return;
	}
	if (r.skipped.length) {
		const text = `${translate("onecBatchQueued")}: ${r.queued}/${r.total}`
			+ ` · ${translate("onecBatchNotQueued")}: ${r.skipped.length}${reason ? ` (${reason})` : ""}`;
		// Отсеянных может быть десяток, а в тост влезает одна причина — остальное в журнал.
		notify({
			severity: "warning", toast: text, source: source ?? translate("onecCommands"),
			text: r.skipped.map((x) => `${x.baseKey} — ${x.reason}`).join("\n"),
		});
		return;
	}
	showToast(`${translate("onecBatchQueued")}: ${r.queued}/${r.total}`, "success");
}

/** Что читаем у базы: её пользователей или её расширения. */
export type BaseContentKind = "users" | "extensions";

/**
 * «Обновить содержимое базы» — ОДИН механизм на все экраны.
 *
 * Кнопка есть и на вкладке «Пользователи баз», и в карточке базы, и раньше они делали
 * разное: панель заводила операцию в реестре прогресса, показывала итог и перечитывала
 * кэш реестра, а карточка просто включала свой запрос — без следа в «Прогрессе запросов
 * и команд», без обновления сводок и без сообщения о том, чем всё кончилось. Одна и та же
 * подпись обязана означать одно и то же действие, поэтому обе кнопки зовут этот хук.
 *
 * ЧТО ОН ДЕЛАЕТ. Читает содержимое базы у самой 1С (команда агенту), кладёт ответ в кэш
 * запроса карточки — чтобы прочитанное показалось без второго обращения, — и обновляет
 * сводки реестра, которые от этих данных считаются.
 */
export function useBaseContentCheck(kind: BaseContentKind = "users"): {
	run: (keys: string[]) => Promise<void>;
	checking: boolean;
} {
	const qc = useQueryClient();
	const parallel = useCheckParallel();
	const [checking, setChecking] = useState(false);
	const isUsers = kind === "users";

	const run = useCallback(async (keys: string[]) => {
		const asked = keys.filter(Boolean);
		if (!asked.length || checking) return;

		/*
		 * ОТСЕИВАЕМ ТО, ЧТО ЗАВЕДОМО НЕ ВЫПОЛНИТСЯ.
		 *
		 * Чтение содержимого — это вход в базу: десятки секунд ожидания. Посылать его в
		 * базу, про которую в реестре уже написано, что войти в неё нельзя (пропала из
		 * кластера, отключена, или числится, но при входе не находится), значит заставить
		 * человека ждать ради ответа, который у нас уже есть. Он и получал его в виде
		 * «Проверено баз: 0/1. Не удалось: … база не найдена на сервере» — текст агента,
		 * из которого не следует, что делать.
		 *
		 * Реестр может и не знать базу (её только что завели) — тогда не мешаем: незнание
		 * не повод отказывать.
		 */
		const known = qc.getQueryData<{ items?: OnecBase[] }>(["onec", "bases"])?.items ?? [];
		const byKey = new Map(known.map((b) => [b.key.toLowerCase(), b]));
		const skipped: { baseKey: string; message: string }[] = [];
		const targets = asked.filter((key) => {
			const b = byKey.get(key.toLowerCase());
			if (!b || isApplicable(b, "ib")) return true;
			skipped.push({ baseKey: key, message: unreachableReason(b) });
			return false;
		});

		if (!targets.length) {
			// Ничего не осталось — не заводим операцию вовсе: работы нет, есть объяснение.
			const first = skipped[0];
			// Тост говорит КОРОТКО и о факте, журнал — подробности, которые переживут четыре
			// секунды: при десятке отсеянных баз в тосте помещается только первая, а
			// остальные нужны, чтобы понять, чинить одну базу или все сразу.
			const details = skipped.map((x) => `${x.baseKey} — ${x.message}`).join("\n");
			noteNotice(translate(isUsers ? "onecUsersCheck" : "onecExtCheck"), { type: "warning", text: details });
			showToast(skipped.length > 1
				? `${translate("onecNothingToCheck")}: ${skipped.length}`
				: `${first.baseKey} — ${first.message}`, "warning");
			return;
		}

		setChecking(true);
		const op = startOp({
			kind: "read", title: translate(isUsers ? "onecUsersCheck" : "onecExtCheck"),
			target: targets.length === 1 ? targets[0] : `${translate("onecBases")}: ${targets.length}`,
			total: targets.length,
			note: skipped.length ? `${translate("onecSkippedBases")}: ${skipped.length}` : "",
			// Читаем содержимое этих баз — карточки их пользователей на это время не правятся.
			scope: { bases: targets },
		});
		const r = await checkBases(
			targets,
			async (baseKey) => {
				const data = isUsers ? await fetchBaseUsers(baseKey) : await fetchBaseExtensions(baseKey);
				// Время чтения ставим здесь: у агента его в ответе нет, а карточка показывает
				// возраст данных (колонка «Прочитано»). Без метки только что прочитанное
				// выглядело бы как «неизвестно когда» — ровно наоборот правде.
				const seenAt = new Date().toISOString();
				const stamped = { items: (data.items as { seenAt?: string | null }[]).map((x) => ({ ...x, seenAt })) };
				// Прочитанное сразу становится данными карточки базы: иначе она сделала бы
				// второй такой же вход в базу, чтобы показать то же самое.
				qc.setQueryData(["onec", isUsers ? "base-users" : "base-ext", baseKey], stamped);
				return data;
			},
			parallel,
			(done, failed) => progressOp(op, done, failed),
		);
		finishOp(op, {
			failed: r.failed.length,
			note: r.failed.length ? `${r.failed[0].baseKey}: ${r.failed[0].message}` : "",
		});
		setChecking(false);

		// Пропущенные называем поимённо и с причиной: «проверено 3 из 5» без объяснения
		// выглядит как потеря половины выбора.
		for (const sk of skipped) {
			noteNotice(translate(isUsers ? "onecUsersCheck" : "onecExtCheck"),
				{ type: "warning", text: `${sk.baseKey} — ${sk.message}` });
		}
		const tail = skipped.length ? ` ${translate("onecSkippedBases")}: ${skipped.length}.` : "";
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${targets.length}.${tail} ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}.${tail}`,
			r.failed.length || skipped.length ? "warning" : "success",
		);
		// Сводки считаются из того же кэша реестра, что наполняет чтение.
		if (isUsers) {
			void qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
			void qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
		} else {
			void qc.invalidateQueries({ queryKey: ["onec", "ext-summary"] });
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
		}
	}, [qc, parallel, checking, isUsers]);

	return { run, checking };
}

/** Частный случай для читаемости на месте вызова. */
export const useBaseUsersCheck = () => useBaseContentCheck("users");

/**
 * Состояние агентов — ОДИН запрос на всю панель, и он опрашивается.
 *
 * Состояние агента меняется без нашего участия: службу на сервере 1С останавливают,
 * перезапускают, обновляют. Пока панель спрашивала о нём только при открытии вкладки,
 * остановленный агент оставался «на связи» до перезагрузки страницы: человек жал команду
 * и ждал ответа от того, кого уже нет. Раз в 15 секунд — достаточно, чтобы заметить, и
 * дёшево: ответ идёт из базы сервиса, кластер он не трогает.
 */
export function useAgents() {
	return useQuery({
		queryKey: ["onec", "agents"],
		queryFn: fetchAgents,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 0,
	});
}

export function useCheckParallel(): number {
	const agents = useAgents();
	return agents.data?.limits?.checkParallel ?? 4;
}

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
export const CapabilityGuard: FC<{ capability: string; children?: React.ReactNode }> = ({ capability }) => {
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
 * ДВА ПРАВА НА ПАНЕЛЬ 1С (F5): просмотр и изменение.
 *
 * Право «Администрирование 1С» бывает двух уровней, и раньше разницы между ними не было:
 * тот, кому дали просмотр, мог удалить регистрацию базы, снять публикацию и переписать
 * пользователей ИБ. Сервис теперь различает уровни (см. ai/src/onec/access.ts), а панель
 * обязана показывать ровно то, что человек может сделать: кнопка, отвечающая отказом по
 * правам, — это обещание, которого она не держит.
 *
 * Уровень берётся из того же права, что открывает панель, поэтому отдельного запроса нет.
 */
/**
 * КНОПКИ У ОТКАЗА «БАЗА ЗАНЯТА» (П25): «Повторить» и «Показать сеансы».
 *
 * Отказ отвечает, почему не вышло, но не на «что нажать»: повтор человек делает, возвращаясь в форму, а
 * держателя ищет на другой вкладке. Обе кнопки строит одно место — здесь, потому что решение одинаково для
 * всех команд панели: сервис уже сказал, осмыслен ли повтор (`retryable`, см. isBusyFailure) и кто держит
 * базу (`details.lockedBy`).
 *
 * ПОЧЕМУ НЕ «СНЯТЬ СЕАНС». Платформа называет держателя НОМЕРОМ сеанса, а команда кластера принимает только
 * UUID — на номер агент отвечает VALIDATION_ERROR. Поэтому ведём в список сеансов базы, где строка уже
 * подсвечена, а снимают её там, по самой строке.
 */
export function useOnecErrorActions() {
	const openBase = useOpenOnecBase();
	return (e: unknown, opts: { baseKey?: string | null; retry?: () => void | Promise<void> } = {}):
		{ label: string; onClick: () => void | Promise<void> }[] => {
		const err = e as { retryable?: boolean; details?: { lockedBy?: { sessionId?: string | null } } } | null;
		const held = err?.details?.lockedBy;
		// Повтор предлагаем только там, где он осмыслен: сервис отмечает такие отказы сам.
		const retryable = err?.retryable === true;
		const actions: { label: string; onClick: () => void | Promise<void> }[] = [];
		if (retryable && opts.retry) actions.push({ label: translate("retry"), onClick: () => opts.retry!() });
		if (opts.baseKey && (held || retryable)) {
			const baseKey = opts.baseKey;
			actions.push({
				label: translate("onecSessionsShow"),
				onClick: () => {
					requestBaseTab(baseKey, { tab: "sessions", session: held?.sessionId ?? null });
					openBase(baseKey);
				},
			});
		}
		return actions;
	};
}

export const useOnecWrite = (): boolean => useAccessPermission("OneCAdmin").canWrite;

/** Вложенные разрешения «Администрирования 1С» текущего пользователя (onecPermissions.ts). */
export function useOnecPermissions(): OnecPermissions {
	const user = useAppContext().auth.user;
	const hasSection = useAccessPermission("OneCAdmin").canRead;
	return useMemo(() => buildOnecPermissions(
		user?.accessPermissions ?? user?.employee?.accessPermissions ?? [],
		{ isSuperAdmin: !!user?.isSuperAdmin, hasSection },
	), [user, hasSection]);
}

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

/**
 * СВОДНЫЙ СПИСОК, ЗАКРЫТЫЙ УСТАНОВКОЙ — ОДНО ОБЪЯСНЕНИЕ ВМЕСТО ПУСТОЙ ТАБЛИЦЫ С ОШИБКОЙ (С3.4 аудита 23.09).
 *
 * Вкладки разделов 1С открываются по праву «Администрирование 1С» (agentsAllow), а СВОДНЫЕ списки сервиса — заявки,
 * токены, БИНы, базы с расширением — при `ONEC_SERVER_SCOPE=organizations` отдаются только администратору BuhProf.
 * Ворота разные и оба законные: право панели говорит о кластерах и агентах СВОЕЙ организации, а сводка по всем
 * клиентам установки — про чужие. Панель заранее знать этого не может: настройка живёт на сервере, поэтому узнаём
 * по первому же ответу. Без этого человек с правом на агентов видел раздел, а внутри — 403 в каждой таблице.
 */
export const isSharedListForbidden = (error: unknown): boolean =>
	(error as { code?: string } | null)?.code === "FORBIDDEN";

export const SharedListForbidden: FC = () => (
	<div className={styles.Hint}>{translate("onecSharedListsForbidden")}</div>
);

/**
 * Прогон чтения по нескольким базам — прямыми запросами, без задания.
 *
 * Задание (command_batches) существует для ИЗМЕНЯЮЩИХ операций: их результат по каждой
 * базе нужно хранить и к нему возвращаться. Чтение списка — обычный запрос: нажал и увидел,
 * заводить ради него сущность и уходить на другую вкладку незачем.
 *
 * Ограничение одновременности — не из вежливости: каждое обращение к базе занимает у 1С
 * сеанс и лицензию, а агент и так исполняет команды пачками по `max_parallel`.
 */
export async function checkBases(
	keys: string[],
	read: (baseKey: string) => Promise<unknown>,
	limit = 4,
	/** Сколько баз уже обработано — для вкладки прогресса: проверка сотни баз идёт минутами. */
	onProgress?: (done: number, failed: number) => void,
): Promise<{ ok: number; failed: { baseKey: string; message: string }[] }> {
	const queue = [...keys];
	let ok = 0;
	const failed: { baseKey: string; message: string }[] = [];

	const worker = async () => {
		for (;;) {
			const key = queue.shift();
			if (!key) return;
			try {
				await read(key);
				ok += 1;
			} catch (e) {
				failed.push({ baseKey: key, message: e instanceof Error ? e.message : String(e) });
			}
			onProgress?.(ok + failed.length, failed.length);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, keys.length) }, worker));
	return { ok, failed };
}

