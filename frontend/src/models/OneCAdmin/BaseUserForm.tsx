/**
 * Карточка «Пользователь базы» — отдельный пейн, открывается двойным щелчком по строке.
 *
 * ЦЕНТРАЛЬНЫЙ ОБЪЕКТ — пара «человек + база». Один и тот же человек в разных базах имеет
 * разные права, и карточка, притворяющаяся общей, врала бы: показывала бы одни роли, а
 * меняла другие. Поэтому база выбирается прямо в шапке, и всё содержимое следует за ней.
 *
 * ПРАВА ПРАВЯТСЯ ОТМЕТКАМИ, А ПИШУТСЯ РАЗНИЦЕЙ. В таблице прав отметка означает «роль
 * есть»; при записи уходит только то, что ИЗМЕНИЛИ (addRoles/removeRoles). Неотмеченное,
 * которого и не было, не пишется вовсе: иначе команда трогала бы то, чего её не просили,
 * и на сотне баз это разошлось бы с ожиданиями молча.
 *
 * РАСКРЫТИЕ СТРОКИ ПРАВА даёт второй разрез той же картины: щёлкнули роль — увидели все
 * базы человека и где она есть. Правку в этих строках делать можно: она копится тем же
 * черновиком, что и отметки на текущей базе.
 */
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "src/app/context";
import ModelForm from "src/components/ModelForm";
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import main from "src/styles/main.module.scss";
import { showToast } from "src/components/UIToast";
import { errorText, reportError } from "src/services/errors/route";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { asText } from "src/utils/asText";
import { getFormatDate } from "src/utils/datetime";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBaseUsers, fetchBaseUsersCached, fetchRoles, fetchUserOccurrences, runBatch,
} from "src/services/onec/api";
import { formStoreAPI } from "src/hooks/useFormStore";
import { setPaneBusy, setPaneIsEditMode } from "src/hooks/paneFormState";
import { Icon } from "src/components/IconButton/icons";
import { QueryError, useOnecWrite } from "./shared";
import { useOpenOnecBase } from "src/models/OneCBases";
import {
	attachBatch, finishOp, opBlocks, startOp, useBatchWatch, useOnecOps, withOp,
} from "./progress";
import { buildSavePlan, buildUserUpdate, roleCatalog } from "./userUpdate";

const rightsColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "320px", minWidth: "180px", alignment: "left", visible: true, inlist: true },
	{ identifier: "inBase", type: "string", width: "140px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
	{ identifier: "changedLabel", type: "string", width: "130px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const basesColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "baseName", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesCount", type: "number", width: "110px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "seenAt", type: "datetime", width: "170px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Черновик: роль → должна ли она быть в базе. Только изменённое попадёт в команду. */
type Draft = Map<string, boolean>;
const draftKey = (baseKey: string, role: string) => `${baseKey.toLowerCase()}|${role}`;

export const BaseUserForm: FC<Partial<TPane>> = (paneProps) => {
	const canWrite = useOnecWrite();
	const row = (paneProps.data ?? {}) as TDataItem;
	/**
	 * ИМЯ ВХОДА — ИДЕНТИЧНОСТЬ КАРТОЧКИ, и она может смениться.
	 *
	 * Все запросы адресуются пользователю по имени, поэтому «текущее имя» и «имя,
	 * введённое в поле» — разные вещи. Пока переименование не выполнено в базе, карточка
	 * продолжает жить под прежним именем: команда может и не пройти (имя занято, база
	 * недоступна), а карточка, переехавшая на несуществующее имя, показывала бы пустоту.
	 */
	const [userName, setUserName] = useState(asText(row.userName) || asText(row.name));
	const qc = useQueryClient();
	const { addPane, requestClose, updatePaneLabel } = useAppContext().windows;
	const openOnecBase = useOpenOnecBase();

	const [baseKey, setBaseKey] = useState(asText(row.baseKey));
	const [draft, setDraft] = useState<Draft>(new Map());
	/** Строка вкладки «Базы», выбранная одиночным щелчком: цель «Открыть в другой базе». */
	const [activeOccurrence, setActiveOccurrence] = useState("");
	/**
	 * «Показывать в списке выбора» — ТРЁХЗНАЧНО: `null` значит «не менять».
	 *
	 * Прочитать текущее значение неоткуда: `IB_LIST_USERS` возвращает имя, полное имя,
	 * признак отключения и роли — этого признака там нет. Раньше форма подставляла
	 * «включено» как факт и отправляла его при КАЖДОМ «Применить»: правка полного имени
	 * молча включала показ в списке у того, у кого он был выключен. А переключение самого
	 * тумблера, наоборот, не считалось изменением — и «Применить» не делало ничего. Отсюда
	 * и жалоба: «значение не сохраняется».
	 *
	 * Поэтому: пока значение неизвестно, поле стоит в положении «не менять» и в команду не
	 * попадает вовсе. Известное (сборка агента научится его отдавать — сервис уже готов,
	 * миграция 019) подставляется как есть.
	 */
	const [form, setForm] = useState<{
		name: string; fullName: string; password: string; disabled: boolean;
		showInList: boolean | null;
	}>({ name: "", fullName: "", password: "", disabled: false, showInList: null });
	/** Переименование, поставленное в очередь: ждём его результата, чтобы переехать. */
	const [renaming, setRenaming] = useState<{ opId: string; to: string } | null>(null);

	// Где заведён и с какими ролями — из кэша реестра, без обращения к 1С.
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", userName],
		queryFn: () => fetchUserOccurrences(userName),
		enabled: !!userName.trim(),
	});
	// Пользователи выбранной базы: из них берём реквизиты именно в этой базе.
	const baseUsers = useQuery({
		queryKey: ["onec", "base-users-cached", baseKey],
		queryFn: () => fetchBaseUsersCached(baseKey),
		enabled: !!baseKey,
	});
	/**
	 * СПРАВОЧНИК РОЛЕЙ — ЭТОЙ БАЗЫ, А НЕ ОБЩИЙ ПО ВСЕМ.
	 *
	 * ЖИВОЙ СЛУЧАЙ (12.09, 23:43). Карточка предлагала роли из ОБЩЕГО справочника —
	 * объединения по всем базам панели, — и запись ролей закончилась отказом агента: «в базе
	 * «_transition» нет ролей: ДобавлениеИзменениеКорректировкаПоступления, …». И правильно:
	 * набор ролей задаёт КОНФИГУРАЦИЯ, у «Бухгалтерии» и «ERP» он разный, а команда уходит в
	 * одну базу. Роли чужой конфигурации в ней не существуют.
	 *
	 * Спрашиваем по ключу базы: сервис отдаёт то, что известно о ней из реестра, без
	 * обращения в 1С. Полный справочник конфигурации читается живьём — кнопкой «Обновить» в
	 * таблице прав (`?live=1`), это вход в базу на десятки секунд.
	 */
	const [rolesLive, setRolesLive] = useState(false);
	const roles = useQuery({
		queryKey: ["onec", "roles", baseKey, rolesLive],
		queryFn: () => fetchRoles(baseKey || undefined, rolesLive),
		enabled: !!baseKey,
		staleTime: 5 * 60_000,
	});

	/**
	 * ПОКА ПО ОБЪЕКТУ ИДЁТ ОПЕРАЦИЯ, КАРТОЧКА ТОЛЬКО ЧИТАЕТСЯ.
	 *
	 * Значения меняются прямо сейчас — в 1С или в кэше реестра. Форма, позволяющая править
	 * поверх, отправила бы команду по данным, которых уже нет: человек снял бы роль, которую
	 * выполняющаяся команда только что добавила, и результат зависел бы от того, кто успел
	 * раньше. Поэтому на время операции поля и отметки заблокированы, а когда она закончится,
	 * свежие значения приходят сами (useBatchWatch перечитывает реестр).
	 */
	// Хук ведёт опрос заданий: карточка может остаться единственным открытым пейном.
	useBatchWatch();
	const ops = useOnecOps();
	const busy = useMemo(
		() => ops.find((o) => opBlocks(o, userName, baseKey)) ?? null,
		[ops, userName, baseKey],
	);
	const locked = !!busy;

	// Спиннер на ⟳ в шапке панели: пока идёт операция по объекту карточки, кнопка
	// крутится и не принимает нажатие — свежих значений всё равно ещё нет.
	useEffect(() => {
		const uniqId = paneProps.uniqId;
		if (!uniqId) return;
		setPaneBusy(uniqId, locked);
		return () => setPaneBusy(uniqId, false);
	}, [paneProps.uniqId, locked]);

	/**
	 * Строки без `baseKey` отбрасываем.
	 *
	 * Панель падала на них при отрисовке: запрос с пустым именем попадал в сводку
	 * пользователей (Express не различает `/users` и `/users/`), а у её строк базы нет.
	 * Сервис теперь такой запрос отвергает, но верить форме чужого ответа вслепую
	 * всё равно нельзя — падение из-за одной кривой строки роняло весь пейн.
	 */
	const occ = useMemo(
		() => (occurrences.data?.items ?? []).filter((o) => typeof o?.baseKey === "string" && !!o.baseKey),
		[occurrences.data],
	);
	const here = useMemo(
		() => (baseUsers.data?.items ?? []).find((u) => u.name.toLowerCase() === userName.toLowerCase()) ?? null,
		[baseUsers.data, userName],
	);

	/**
	 * ИСХОДНОЕ СОСТОЯНИЕ РЕКВИЗИТОВ — то, что записано в базе.
	 *
	 * Оно нужно дважды: им заполняется форма при смене базы и к нему же возвращает
	 * «Отменить правки». Раньше вторая половина отсутствовала: кнопка сбрасывала только
	 * отметки ролей, а переключённый тумблер «Отключен» откатить было НЕЧЕМ — оставалось
	 * закрыть карточку и открыть заново. Одно место на оба случая, чтобы они не разошлись.
	 *
	 * ПОЛНОЕ ИМЯ ПОКАЗЫВАЕМ ТО, ЧТО ЕСТЬ: поле стояло пустым, хотя реестр знает значение, и
	 * «пусто — не трогать» превращалось в «не видно». Пустым остаётся только то, чего мы
	 * знать не можем (пароль), а «показывать в списке» при неизвестном значении — «не менять».
	 */
	const baseline = useMemo(() => ({
		name: userName, fullName: here?.fullName ?? "", password: "",
		disabled: here?.disabled ?? false,
		showInList: here?.showInList ?? null,
	}), [here, userName]);

	// Реквизиты следуют за выбранной базой: в другой базе у человека своё полное имя.
	useEffect(() => { setForm(baseline); }, [baseline]);

	/**
	 * База карточки всегда есть в списке — даже когда реестр про неё ещё не знает.
	 *
	 * Карточку открывают из базы, содержимое которой только что прочитали, а сводка
	 * «в каких базах есть этот человек» наполняется отдельно и может отставать. Поле со
	 * значением, которого нет среди вариантов, показывается ПУСТЫМ: выглядело это как
	 * «форма не работает», хотя база выбрана и всё правится.
	 */
	const baseOptions = useMemo(() => {
		const items = occ.map((o) => ({ value: o.baseKey, label: `${o.baseKey} — ${o.baseName || "—"}` }));
		if (baseKey && !items.some((i) => i.value.toLowerCase() === baseKey.toLowerCase())) {
			items.unshift({ value: baseKey, label: baseKey });
		}
		return items;
	}, [occ, baseKey]);

	/*
	 * РОЛИ СВОЕЙ БАЗЫ — ИЗ СПИСКА ЭТОЙ БАЗЫ, а не из сводки по всем базам.
	 *
	 * Сводка «в каких базах есть этот человек» наполняется отдельно и отстаёт: у только что
	 * созданного пользователя она пуста вовсе, а после записи ролей обновляется позже, чем
	 * список пользователей самой базы (его приносит эхо той же команды). Пока отметки
	 * читались из сводки, карточка показывала прошлое — и выданная роль выглядела
	 * непринятой, хотя в базе она уже была.
	 *
	 * Про ЧУЖИЕ базы сводка остаётся единственным источником — их списков карточка не
	 * читает и читать не должна: это вход в каждую из них.
	 */
	const rolesByBase = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const o of occ) m.set(o.baseKey.toLowerCase(), o.roles ?? []);
		if (baseKey && here?.roles) m.set(baseKey.toLowerCase(), here.roles);
		return m;
	}, [occ, baseKey, here]);

	/** Есть ли роль в базе с учётом черновика. */
	const isOn = useCallback((base: string, role: string) => {
		const d = draft.get(draftKey(base, role));
		return d ?? (rolesByBase.get(base.toLowerCase()) ?? []).includes(role);
	}, [draft, rolesByBase]);

	const toggle = useCallback((base: string, role: string) => {
		setDraft((prev) => {
			const next = new Map(prev);
			const was = (rolesByBase.get(base.toLowerCase()) ?? []).includes(role);
			const now = !isOn(base, role);
			// Вернули как было — строка из черновика уходит: писать «изменение», равное
			// исходному, значит трогать базу зря.
			if (now === was) next.delete(draftKey(base, role));
			else next.set(draftKey(base, role), now);
			return next;
		});
	}, [rolesByBase, isOn]);

	/*
	 * ── ПРАВА — ПО ОДНОЙ БАЗЕ, ТОЙ, ЧТО ВЫБРАНА В «ОСНОВНОМ» ────────────────
	 *
	 * Карточка — про пару «человек + база»: база названа в её первой же вкладке, и права
	 * здесь относятся к ней. Раньше строка роли была заголовком группы и считала «в
	 * скольких базах из скольких» роль есть, а отдельная база пряталась во вложенной
	 * строке: карточка одной базы незаметно правила остальные, и человек, снявший галочку,
	 * не мог сказать, где именно она снялась.
	 *
	 * Групповая правка никуда не делась — она переехала туда, где ей и место: в помощник
	 * группового редактирования, где базы выбирают явным шагом (см. BaseUserWizard).
	 */
	// Справочник ЭТОЙ базы плюс выданное в ней. Правило и его цена — в roleCatalog:
	// роль чужой конфигурации отвергает всю правку целиком (живой случай 12.09).
	const allRoles = useMemo(
		() => roleCatalog((roles.data?.items ?? []).map((r) => r.name), here?.roles ?? []),
		[roles.data, here],
	);

	const [rightsCols, setRightsCols] = useState<TColumn[]>(() => getModelColumns(rightsColumns(), "OneCAdmin_bufRights"));
	const rightsRows = useMemo(() => allRoles.map((role, i) => ({
		id: i + 1, uuid: role, role,
		// «Есть в базе» — ответ про ЭТУ базу, а не счёт по всем: счёт здесь не значил бы
		// ничего, кроме того, что человек заведён и где-то ещё.
		inBase: isOn(baseKey, role) ? translate("yes") : translate("no"),
		changedLabel: draft.has(draftKey(baseKey, role)) ? translate("onecChanged") : "",
	})), [allRoles, baseKey, isOn, draft]);
	const rightsView = useStaticTableView(rightsRows, { role: "asc" });

	/** Отмеченные строки = роли, выданные в этой базе (с учётом черновика). */
	const rightsSelected = useMemo(
		() => new Set(rightsView.rows.filter((r) => isOn(baseKey, asText(r.role))).map((r) => Number(r.id))),
		[rightsView.rows, baseKey, isOn],
	);

	/*
	 * Вложенных строк здесь БОЛЬШЕ НЕТ: раскрытие роли базами — инструмент ГРУППОВОЙ
	 * правки, и он переехал в помощник (BaseUserWizard), где базы выбирают явным первым
	 * шагом. Карточка правит одну базу — ту, что названа в «Основном».
	 */

	// ── Базы, где заведён человек ───────────────────────────────────────────
	const [basesCols, setBasesCols] = useState<TColumn[]>(() => getModelColumns(basesColumns(), "OneCAdmin_bufBases"));
	const basesRows = useMemo(() => occ.map((o, i) => ({
		id: i + 1, uuid: o.baseKey, baseKey: o.baseKey, baseName: o.baseName || "—",
		rolesCount: (o.roles ?? []).length, seenAt: o.seenAt,
	})), [occ]);
	const basesView = useStaticTableView(basesRows, { baseKey: "asc" });

	// ── Запись: только изменённое, по каждой затронутой базе ────────────────
	const changedByBase = useMemo(() => {
		const m = new Map<string, { add: string[]; remove: string[] }>();
		for (const [key, value] of draft) {
			const [base, role] = key.split("|");
			const real = occ.find((o) => o.baseKey.toLowerCase() === base);
			const target = real?.baseKey ?? base;
			const entry = m.get(target) ?? { add: [], remove: [] };
			(value ? entry.add : entry.remove).push(role);
			m.set(target, entry);
		}
		return m;
	}, [draft, occ]);

	/** Введённое имя отличается от текущего — значит, просят переименовать. */
	const renameTo = form.name.trim() && form.name.trim() !== userName ? form.name.trim() : "";

	/**
	 * Что именно изменилось — считает общий расчёт (userUpdate). Форма только показывает;
	 * правило «в команду уходит только изменённое» живёт в одном месте и покрыто тестом,
	 * потому что теряется оно легко, а стоит дорого: выдуманное значение уезжает в 1С.
	 */
	const profileUpdate = useMemo(
		() => buildUserUpdate(userName, {
			fullName: here?.fullName ?? "",
			disabled: here?.disabled ?? false,
			showInList: here?.showInList ?? null,
		}, form),
		[userName, here, form],
	);
	const dirtyProfile = !!profileUpdate;

	/**
	 * Постановка команды сразу попадает в реестр операций: запись прав на десятке баз
	 * идёт минутами, и человеку нужен не только тост «поставлено», но и место, где видно,
	 * чем это кончилось. Вкладка «Прогресс запросов и команд» читает тот же реестр.
	 */
	const enqueue = useCallback(async (title: string, target: string, bases: string[], payload: Record<string, unknown>) => {
		const op = startOp({
			kind: "update", title, target, total: bases.length,
			// Пока команда идёт, карточка этой пары только читается: значения меняются в 1С.
			scope: { user: userName, bases },
		});
		try {
			const r = await runBatch("IB_UPDATE_USER", bases, payload);
			attachBatch(op, r.batchId, r.total, r.skipped.length ? `${translate("onecSkipped")}: ${r.skipped.length}` : "");
			return { ...r, opId: op };
		} catch (e) {
			// Команда даже не встала в очередь: без этого запись осталась бы «выполняется»
			// навсегда — задания, за которым следить, у неё нет.
			finishOp(op, { failed: bases.length, note: e instanceof Error ? e.message : String(e) });
			throw e;
		}
	}, [userName]);

	/**
	 * ЗАПИСЬ — ОДНА КОМАНДА НА БАЗУ, И ЭТО ПРИНЦИПИАЛЬНО.
	 *
	 * Раньше правки уходили порознь: реквизиты — одной командой, роли — второй, и обе по
	 * одной и той же базе. Команды выполняются агентом независимо и в любом порядке, а
	 * переименование меняет то самое имя, которым адресована вторая: если она успевала
	 * первой — роли ложились на старого пользователя, если второй — приходило «в базе нет
	 * пользователя», и человек оставался с половиной применённых изменений.
	 *
	 * Теперь по каждой базе собирается ОДНА команда со всеми изменениями сразу: и
	 * переименование, и реквизиты, и роли. Порядок внутри одной команды — забота агента,
	 * а не гонка между командами.
	 *
	 * ПЕРЕИМЕНОВАНИЕ КАСАЕТСЯ ТОЛЬКО СВОЕЙ БАЗЫ. В других базах это отдельные пользователи
	 * с прежним именем: адресовать их новым именем значит потерять их — ровно та ошибка,
	 * из-за которой появился этот комментарий.
	 *
	 * В БАЗУ, ГДЕ ЧЕЛОВЕКА НЕТ, команда не уходит вовсе: реестр знает, где он заведён, и
	 * посылать изменение туда, где менять некого, — гарантированный отказ.
	 */
	const save = useMutation({
		mutationFn: async () => {
			/*
			 * РОЛИ УХОДЯТ ПОЛНЫМ НАБОРОМ, И НАБОР СЧИТАЕТСЯ ПО СВЕЖЕМУ ЧТЕНИЮ.
			 *
			 * Сборка агента не применяет поправки `addRoles`/`removeRoles`: отвечает успехом и
			 * не меняет ничего (поймано 12.09 по эху команды — docs/
			 * TASK_AGENT_UPDATE_USER_ROLES.md). Второй способ того же контракта — полный набор
			 * `roles`; им и пользуемся, пока агента не обновят.
			 *
			 * Но «эталон» опасен по кэшу: роль, выданную в конфигураторе после последнего
			 * чтения, он молча снял бы. Поэтому перед записью список пользователей ЭТОЙ базы
			 * перечитывается у 1С — один вход в базу на правку ролей, зато набор считается по
			 * тому, что в базе сейчас. Не удалось прочитать — шлём поправки, как прежде: пусть
			 * лучше агент их не применит (и скажет об этом), чем мы снимем чужую роль.
			 */
			const ownRoleChanges = [...changedByBase.entries()]
				.find(([base]) => base.toLowerCase() === baseKey.toLowerCase())?.[1];
			let ownCurrentRoles: string[] | null = null;
			if (ownRoleChanges && (ownRoleChanges.add.length || ownRoleChanges.remove.length)) {
				try {
					const live = await withOp(
						{ kind: "read", title: translate("onecUsersCheck"), target: baseKey, scope: { bases: [baseKey] } },
						() => fetchBaseUsers(baseKey),
					);
					const fresh = (live.items ?? []).find((u) => u.name.toLowerCase() === userName.toLowerCase());
					ownCurrentRoles = fresh?.roles ?? null;
					// Пользователя в свежем списке нет — набор считать не по чему.
					if (!ownCurrentRoles) showToast(translate("onecRolesLiveMissing"), "warning");
				} catch (e) {
					// Чтение отказало (база недоступна, агент занят) — не выдумываем эталон.
					showToast(`${translate("onecRolesLiveFailed")}: ${errorText(e)}`, "warning");
				}
			}

			/*
			 * План записи считает общий расчёт (userUpdate.buildSavePlan): база карточки в
			 * него попадает ВСЕГДА, а отсев «человека там нет» остаётся для остальных баз.
			 * Раньше отсев шёл по сводке реестра и съедал саму базу карточки, когда сводка
			 * отставала, — правка тихо не применялась (см. комментарий к buildSavePlan).
			 */
			const { plan, skipped } = buildSavePlan({
				baseKey, userName, profileUpdate,
				rolesByBase: changedByBase,
				knownBases: occ.map((o) => o.baseKey),
				ownCurrentRoles,
			});
			if (skipped.length) {
				showToast(`${translate("onecUserNotInBases")}: ${skipped.join(", ")}`, "warning");
			}

			const results = [];
			for (const [base, payload] of plan) {
				const isHere = base.toLowerCase() === baseKey.toLowerCase();
				const r = await enqueue(
					isHere && renameTo ? translate("onecUserRename") : translate("onecUserUpdate"),
					`${userName} — ${base}`, [base], payload,
				);
				// Переезд карточки на новое имя — только после того, как база подтвердит
				// переименование: команда может и не пройти (имя занято, база недоступна),
				// а карточка на несуществующем имени показывала бы пустоту.
				if (isHere && renameTo) setRenaming({ opId: r.opId, to: renameTo });
				results.push(r);
			}
			return results;
		},
		onSuccess: (r) => {
			// «Задание поставлено: 0» — это не успех, а молчаливое ничего: так выглядела
			// правка, у которой все базы отсеялись. Называем это тем, что произошло.
			if (!r.length) {
				showToast(translate("onecNothingToApply"), "warning");
				return;
			}
			showToast(`${translate("onecBatchQueued")}: ${r.length}`, "success");
			setDraft(new Map());
			void qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
		},
		onError: (e) => reportError(e, { source: translate("onecUser") }),
	});

	/**
	 * ПОЛНАЯ АКТУАЛИЗАЦИЯ карточки — кнопка ⟳ в шапке панели.
	 *
	 * Это единственное место карточки, которое СПРАШИВАЕТ 1С: читает пользователей базы
	 * командой агенту и затем перечитывает реестр. «Обновить» в командной панели таблиц
	 * так не делает намеренно — она перечитывает тот же источник, из которого таблица
	 * читала (кэш реестра сервиса), и стоит доли секунды вместо десятков.
	 */
	const refreshLive = useCallback(async () => {
		if (!baseKey) { await occurrences.refetch(); return; }
		const op = startOp({
			kind: "read", title: translate("onecCardRefresh"), target: `${userName} — ${baseKey}`,
			total: 1, scope: { user: userName, bases: [baseKey] },
		});
		try {
			await fetchBaseUsers(baseKey);
			finishOp(op);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			finishOp(op, { failed: 1, note: msg });
			showToast(msg, "error");
		}
		await Promise.all([occurrences.refetch(), baseUsers.refetch(), roles.refetch()]);
	}, [baseKey, userName, occurrences, baseUsers, roles]);

	// Кнопка ⟳ в шапке панели ищет обработчик в formStoreAPI, а доступной становится
	// только у панели «с записью» — карточка пары именно такая.
	useEffect(() => {
		const uniqId = paneProps.uniqId;
		if (!uniqId) return;
		setPaneIsEditMode(uniqId, true);
		formStoreAPI.register(uniqId, { reload: refreshLive });
		return () => {
			formStoreAPI.unregister(uniqId);
			setPaneIsEditMode(uniqId, false);
		};
	}, [paneProps.uniqId, refreshLive]);

	/**
	 * Итог переименования: команда прошла — карточка живёт под новым именем, не прошла —
	 * остаётся под прежним, а причина видна во вкладке «Прогресс запросов и команд».
	 */
	useEffect(() => {
		if (!renaming) return;
		const op = ops.find((o) => o.id === renaming.opId);
		if (!op || op.state === "running") return;
		if (op.state === "done") {
			setUserName(renaming.to);
			if (paneProps.uniqId) {
				updatePaneLabel(paneProps.uniqId, `${translate("onecBaseUserCard")}: ${renaming.to} — ${baseKey}`);
			}
			showToast(`${translate("onecUserRenamed")}: ${renaming.to}`, "success");
			void qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
			void qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
		}
		setRenaming(null);
	}, [ops, renaming, paneProps.uniqId, updatePaneLabel, baseKey, qc]);

	const openBase = useCallback((r: Partial<TDataItem>) => addPane({
		label: `${translate("onecBaseUserCard")}: ${userName} — ${asText(r.baseKey)}`,
		component: BaseUserForm as never,
		data: { userName, baseKey: asText(r.baseKey) } as unknown as TDataItem,
	}), [addPane, userName]);

	const changedCount = draft.size + (dirtyProfile ? 1 : 0);

	// «Закрыть» — штатное закрытие пейна (с проверкой несохранённого), а не пустышка.
	const close = useCallback(() => {
		if (paneProps.uniqId) void requestClose(paneProps.uniqId);
	}, [requestClose, paneProps.uniqId]);

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			// Пока по паре идёт операция, кнопки формы заблокированы вместе с полями.
			isLoading={occurrences.isLoading || locked || save.isPending}
			onSave={() => save.mutate()}
			onSaveAndClose={() => { save.mutate(undefined, { onSuccess: close }); }}
			onClose={close}
			tabs={[
				{
					id: "main", label: translate("general"),
					// Каркас — общий для всех форм приложения (см. SalesForm): колонка полей
					// под чтение и колонка сообщений справа снизу, а не сообщения враспор
					// между областями.
					component: (
						<div className={main.FormContainer}>
							<div className={main.FormWrapper}>
								<GroupCol className={main.Form}>
									<FormArea title={translate("onecAreaOwner")}>
										<GroupRow>
											<FieldSelect name="buf_base" label={translate("onecBase")} value={baseKey}
												disabled={locked}
												onChange={(e) => setBaseKey(e.target.value)}
												options={baseOptions} />
											<Field name="buf_seen" label={translate("onecDataFrom")}
												value={occ.find((o) => o.baseKey === baseKey)?.seenAt
													? getFormatDate(occ.find((o) => o.baseKey === baseKey)!.seenAt) : "—"}
												disabled width={FIELD_WIDTH.date} onChange={() => {}} />
											<Field name="buf_roles" label={translate("roles")}
												value={String((rolesByBase.get(baseKey.toLowerCase()) ?? []).length)}
												disabled width={FIELD_WIDTH.sm} onChange={() => {}} />
										</GroupRow>
									</FormArea>

									<FormArea title={translate("onecAreaUserData")}>
										<GroupCol>
											<GroupRow>
												{/* Имя входа правится, как и прочее: в 1С это смена свойства
												    «Имя» у того же пользователя, а не новый пользователь. */}
												<Field name="buf_user" label={translate("onecUserName")} value={form.name} width={FIELD_WIDTH.wide}
													noAutofill disabled={locked}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
												<Field name="buf_full" label={translate("onecUserFullName")} value={form.fullName} width={FIELD_WIDTH.wide}
													noAutofill disabled={locked} placeholder={here?.fullName || translate("onecKeepAsIs")}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
												<Field name="buf_pwd" label={translate("onecUserPassword")} type="password" value={form.password}
													width={FIELD_WIDTH.md} disabled={locked} placeholder={translate("onecKeepAsIs")}
													onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
											</GroupRow>
											<GroupRow>
												{/*
												  * ТУМБЛЕР, НО НЕ ТРОГАЮЩИЙ ТОГО, ЧЕГО НЕ ЗНАЕТ.
												  *
												  * Текущее значение прочитать неоткуда: агент не возвращает его в
												  * списке пользователей. Поэтому внутри поле трёхзначное — `null`
												  * значит «не трогали», и в команду оно не попадает вовсе. Тумблер
												  * показывает известное значение, а когда его нет — выключен, и
												  * подсказка говорит прямо: значение не читается, переключите,
												  * если нужно записать своё.
												  */}
												<FieldToggle name="buf_show" label={translate("onecShowInList")}
													value={form.showInList ?? here?.showInList ?? false}
													disabled={locked}
													/*
													 * Откуда взято показанное — говорим прямо. Значение, которое
													 * помнит реестр, записала САМА ПАНЕЛЬ (сервис запоминает его
													 * по успешной команде): из 1С этот признак не читается, и
													 * выдавать его за прочитанное нельзя.
													 */
													title={here?.showInList != null
														? translate("onecShowInListRemembered")
														: form.showInList === null
															? translate("onecShowInListUnknown")
															: undefined}
													onChange={(v) => setForm((f) => ({ ...f, showInList: v }))} />
												<FieldToggle name="buf_disabled" label={translate("onecUserDisabled")} value={form.disabled}
													disabled={locked}
													onChange={(v) => setForm((f) => ({ ...f, disabled: v }))} />
											</GroupRow>
										</GroupCol>
									</FormArea>
								</GroupCol>

								<GroupCol className={main.FormNotice}>
									<QueryError error={occurrences.error ?? baseUsers.error} />
									<Notice items={[
										...(renameTo ? [{ type: "warning" as const, text: `${translate("onecUserRenameWarning")} «${userName}» → «${renameTo}».` }] : []),
										/* Название операции и объект — в кавычках и скобках: цепочка из трёх
										   тире («заблокирована: Изменить пользователя — Иванов — база»)
										   читалась как одна фраза, где не видно, что чем является. */
										/*
										 * Пока идёт операция по объекту, форма только читается: писать
										 * поверх значений, которые прямо сейчас меняются в 1С, значило бы
										 * отправить команду по данным, которых уже нет. Но если операция
										 * идёт подозрительно долго, человек должен знать, что запись можно
										 * снять, — иначе форма заперта навсегда (живой случай: команда
										 * выполнена, а панель об этом не узнала).
										 */
										...(busy ? [{
											type: "info" as const,
											text: `${translate("onecObjectBusy")} «${busy.title}» (${busy.target}). `
												+ (Date.now() - busy.startedAt > 5 * 60_000
													? translate("onecObjectBusyStuck")
													: translate("onecObjectBusyWait")),
										}] : []),
										...(!baseKey ? [{ type: "info" as const, text: translate("onecPickBaseInHeader") }] : []),
										/*
										 * НЕСОХРАНЁННЫХ ПРАВОК ЗДЕСЬ НЕТ И НЕ БУДЕТ.
										 *
										 * «Не применено правок: N» — не сообщение, а состояние кнопки
										 * «Применить»: оно возникало на каждое переключение отметки и
										 * висело в общем списке, пока правки не применят или не отменят,
										 * — а убрать его оттуда нельзя, живое сообщение очистка щадит.
										 * Получалась строка, которая не уходит по требованию человека и
										 * ничего ему не сообщает: что он сам только что изменил, он знает.
										 * Поэтому число стоит на самой кнопке, рядом с действием, как это
										 * сделано и в других формах панели (см. ServerParams).
										 */
									]} />
								</GroupCol>
							</div>
						</div>
					),
				},
				{
					id: "rights", label: translate("onecTabRights"),
					component: (
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_bufRights", rows: rightsView.rows, columns: rightsCols,
							setColumns: setRightsCols, sorting: rightsView.sorting, search: rightsView.search,
							isLoading: roles.isLoading,
							reloading: roles.isFetching,
							/*
							 * «ОБНОВИТЬ» ЗДЕСЬ — ЭТО ПОЛНЫЙ СПРАВОЧНИК КОНФИГУРАЦИИ у самой 1С.
							 * Из реестра известны только роли, кому-то в этой базе выданные, —
							 * выдать новую по такому списку нельзя, её в нём нет. Живое чтение
							 * стоит входа в базу, поэтому идёт по кнопке, а не само.
							 */
							onReload: () => { setRolesLive(true); if (rolesLive) void roles.refetch(); },
							reloadTitle: translate("onecRolesReadLive"),
							// Активной строки здесь нет: строка — не «текущая запись», а отметка.
							disableActiveRow: true,
							/*
							 * ОТМЕТКА = РОЛЬ ВЫДАНА В ЭТОЙ БАЗЕ. Ни групповых отметок, ни вложенных
							 * строк: карточка правит одну базу — ту, что выбрана в «Основном».
							 * Вложенные строки по базам остались в помощнике группового
							 * редактирования, где базы выбирают явным шагом.
							 */
							selectable: !locked,
							presetSelectedRows: rightsSelected,
							onSelectionChange: (sel, all) => {
								// Сравниваем с текущим состоянием и записываем в черновик только
								// РАЗНИЦУ: иначе каждое перерисовывание таблицы выглядело бы правкой.
								for (const r of all) {
									const role = asText(r.role);
									const now = sel.has(Number(r.id));
									if (now !== isOn(baseKey, role)) toggle(baseKey, role);
								}
							},
							// Права смотрят и правом «просмотр»; записывать их в 1С — только полному
							// доступу (F5). Без кнопок карточка остаётся тем, чем и была: сводкой.
							extraButtons: !canWrite ? undefined : (
								<>
									{/*
									  * Отменяет ВСЁ несохранённое карточки — и отметки ролей, и реквизиты
									  * с соседней вкладки. Пока она сбрасывала только роли, переключённый
									  * тумблер «Отключен» нельзя было вернуть иначе как закрыв карточку,
									  * и «Применить» оставалось зажжённым по правке, которой человек уже
									  * не хотел.
									  */}
									<Button variant="secondary" disabled={!changedCount || locked}
										title={changedCount ? translate("onecResetDraft") : translate("onecNoChanges")}
										onClick={() => { setDraft(new Map()); setForm(baseline); }}>
										<Icon name="restore" /> {translate("onecResetDraft")}
									</Button>
									<Button variant="primary" disabled={!changedCount || save.isPending || locked}
										title={changedCount ? `${translate("onecUnsavedChanges")}: ${changedCount}` : translate("onecNothingToApply")}
										onClick={() => save.mutate()}>
										{/* Счёт правок — на кнопке: он про неё и есть. */}
										<Icon name="save" /> {translate("apply")}{changedCount ? ` (${changedCount})` : ""}
									</Button>
								</>
							),
						})} />
					),
				},
				{
					id: "bases", label: translate("onecTabBases"),
					component: (
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_bufBases", rows: basesView.rows, columns: basesCols,
							setColumns: setBasesCols, sorting: basesView.sorting, search: basesView.search,
							isLoading: occurrences.isLoading,
							reloading: occurrences.isFetching,
							onReload: () => void occurrences.refetch(),
							reloadTitle: translate("onecReloadCached"),
							// Строка — база: двойной щелчок открывает карточку БАЗЫ, как и везде.
							// Тот же человек в другой базе открывается кнопкой: это другой жест
							// и другой объект.
							onRowClick: (r) => openOnecBase(asText(r.baseKey)),
							onActiveRowChange: (r) => setActiveOccurrence(r ? asText(r.baseKey) : ""),
							extraButtons: (
								<Button variant="secondary" disabled={!activeOccurrence}
									title={activeOccurrence
										? `${translate("onecBaseUserCard")}: ${userName} — ${activeOccurrence}`
										: translate("onecPickBaseFirst")}
									onClick={() => openBase({ baseKey: activeOccurrence })}>
									<Icon name="open" /> {translate("onecOpenInOtherBase")}
								</Button>
							),
						})} />
					),
				},
			]}
		/>
	);
};
BaseUserForm.displayName = "BaseUserForm";

/** Открыть карточку «Пользователь базы» отдельным пейном. */
export function useOpenBaseUser() {
	const { addPane } = useAppContext().windows;
	return (userName: string, baseKey: string) => addPane({
		label: `${translate("onecBaseUserCard")}: ${userName}${baseKey ? ` — ${baseKey}` : ""}`,
		component: BaseUserForm as never,
		data: { userName, baseKey } as unknown as TDataItem,
	});
}

export default BaseUserForm;
