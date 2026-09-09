/**
 * Вкладка «Пользователи баз» (E15/A3, A4): реквизиты, роли и базы одного человека —
 * на одном экране, командами из панелей таблиц.
 *
 * ПОЧЕМУ ТАК. Прежний экран задавал режим («добавить / убрать / заменить») сразу на весь
 * набор ролей, и что именно произойдёт с каждой ролью, приходилось держать в голове.
 * Теперь роль — строка таблицы со своим действием: оставить, назначить, снять. Решение
 * принимается по строке и видно целиком.
 *
 * ЧТО ЧЕМ СОБРАНО (только штатные компоненты):
 *   • списки со множественным выбором — `Table` с отметками строк; все команды живут в её
 *     командной панели, кнопок внутри строк нет;
 *   • роли — `SubTable` с правкой в строках и штатными «Добавить»/«Удалить» её панели;
 *   • реквизиты — `Field`/`FieldToggle` в `GroupRow`/`GroupCol`;
 *   • предупреждения формы — `Notice`, итоги операций — `UIToast`.
 *
 * ЗАЩИТЫ. База, где снятие «ПолныеПрава» оставит её без единого администратора,
 * исключается из операции и названа в предпросмотре. Служебные пользователи платформы
 * не удаляются и не отключаются. Ничего не уходит в 1С, пока не нажата команда.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Table from "src/components/Table";
import SubTable from "src/components/SubTable";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { asText } from "src/utils/asText";
import { getModelColumns } from "src/components/Table/services";
import { getFormatDate } from "src/utils/datetime";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TCellValidator } from "src/components/SubTable";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import {
	fetchBaseUsers, fetchBaseUsersCached, fetchBases, fetchBatch, fetchRoleHolders, fetchRoles,
	fetchUserHistory, fetchUserOccurrences, fetchUserSummary, runBatch, type BatchType,
} from "src/services/onec/api";
import { CapabilityGuard, QueryError, checkBases, isApplicable, useCheckParallel } from "./shared";
import styles from "./OneCAdmin.module.scss";

/** Роль, снятие которой способно оставить базу без администратора. */
const ADMIN_ROLE = "ПолныеПрава";

/** Пользователи платформы: их не удаляют и не отключают — на них держатся задания базы. */
const SYSTEM_USERS = ["ОтправкаСерверныхОповещений", "СлужебныйПользовательДляОбновленияПредставлений"];
const isSystemUser = (name: string) => SYSTEM_USERS.some((s) => s.toLowerCase() === name.toLowerCase());

const userColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "bases", type: "number", width: "90px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "disabled", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
] as unknown as TColumn[]);

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "230px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "300px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Пользователи одной базы: имя, полное имя, роли, состояние. */
const baseUserColumns = (): TColumn[] => ([
	{ identifier: "name", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fullName", type: "string", width: "200px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "state", type: "string", width: "110px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
	{ identifier: "rolesLabel", type: "string", width: "320px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Роли: строка = роль + что с ней сделать. Правится в самой таблице. */
const roleColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "300px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
	{ identifier: "act", type: "string", width: "160px", minWidth: "120px", alignment: "left", visible: true, inlist: true },
	{ identifier: "inBases", type: "string", width: "150px", minWidth: "110px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

type RoleAct = "keep" | "grant" | "revoke";

export const UsersTab: FC<{ onBatchStarted: (id: string) => void }> = ({ onBatchStarted }) => {
	const qc = useQueryClient();

	/**
	 * Две точки входа в одни и те же данные.
	 *
	 * «По пользователю» отвечает на вопрос «в каких он базах», «по базе» — «кто в ней
	 * заведён». Второй вопрос задают не реже первого (пришёл клиент — кто у него в базе),
	 * а раньше на него нельзя было ответить вовсе: пришлось бы перебирать людей по одному.
	 * Карточка справа одна и та же, меняется только то, что выбирают слева.
	 */
	const [mode, setMode] = useState<"byUser" | "byBase">("byUser");
	/** База, чьих пользователей смотрим (режим «по базе»). */
	const [openedBase, setOpenedBase] = useState("");

	// Отметки строк — единственный способ выбрать цель: команды живут в панелях таблиц.
	const [pickedUsers, setPickedUsers] = useState<string[]>([]);
	const [pickedBases, setPickedBases] = useState<string[]>([]);
	const [roleRows, setRoleRows] = useState<TDataItem[]>([]);
	const [dialog, setDialog] = useState<null | "apply" | "delete" | "create" | "align">(null);
	/** Вкладки карточки: правка, обзор расхождений, история. */
	const [tab, setTab] = useState<"edit" | "matrix" | "history">("edit");

	// Реквизиты. Пустое поле означает «не трогать» — это же правило у команды изменения.
	const [form, setForm] = useState({ name: "", fullName: "", password: "", disabled: false, showInList: true });

	const summary = useQuery({ queryKey: ["onec", "user-summary"], queryFn: fetchUserSummary });
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const roles = useQuery({ queryKey: ["onec", "roles", ""], queryFn: () => fetchRoles(), staleTime: 5 * 60_000 });
	const holders = useQuery({ queryKey: ["onec", "role-holders", ADMIN_ROLE], queryFn: () => fetchRoleHolders(ADMIN_ROLE) });

	/** Карточку показываем для ПЕРВОГО отмеченного: остальные — цели той же команды. */
	const current = pickedUsers[0] ?? "";
	const occurrences = useQuery({
		queryKey: ["onec", "user-where", current],
		queryFn: () => fetchUserOccurrences(current),
		enabled: !!current,
	});

	// Пользователи выбранной базы — из кэша: просмотр не должен стоить сеанса 1С.
	const baseUsers = useQuery({
		queryKey: ["onec", "base-users-cached", openedBase],
		queryFn: () => fetchBaseUsersCached(openedBase),
		enabled: mode === "byBase" && !!openedBase,
	});

	const [userCols, setUserCols] = useState<TColumn[]>(() => getModelColumns(userColumns(), "OneCAdmin_userSummary"));
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_userBases"));
	const [buCols, setBuCols] = useState<TColumn[]>(() => getModelColumns(baseUserColumns(), "OneCAdmin_baseUsersCached"));

	// ── Левый список: люди или базы, смотря что спрашивают ──────────────────
	const userRows = useMemo(() => (summary.data?.items ?? []).map((x, i) => ({
		id: i + 1, uuid: x.name, name: x.name, bases: x.bases, disabled: x.disabled,
	})), [summary.data]);
	const userView = useStaticTableView(userRows, { name: "asc" });

	const baseUserRows = useMemo(() => (baseUsers.data?.items ?? []).map((u, i) => ({
		id: i + 1, uuid: u.name, name: u.name,
		fullName: u.fullName || "—",
		rolesLabel: (u.roles ?? []).join(", ") || "—",
		state: u.disabled ? translate("onecUserDisabled") : translate("onecUserActive"),
	})), [baseUsers.data]);
	const baseUserView = useStaticTableView(baseUserRows, { name: "asc" });

	const basePickRows = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.map((b, i) => ({ id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
			presence: String(b.extensionsCount ?? ""), rolesLabel: "" })), [bases.data]);
	const basePickView = useStaticTableView(basePickRows, { baseKey: "asc" });

	// ── Базы: где пользователь есть и какие у него там роли ─────────────────
	const occByBase = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const o of occurrences.data?.items ?? []) m.set(o.baseKey.toLowerCase(), o.roles ?? []);
		return m;
	}, [occurrences.data]);

	const adminsByBase = useMemo(() => {
		const m = new Map<string, number>();
		for (const h of holders.data?.items ?? []) m.set(h.baseKey.toLowerCase(), h.users);
		return m;
	}, [holders.data]);

	const baseRows = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => isApplicable(b, "ib"))
		.map((b, i) => {
			const has = occByBase.get(b.key.toLowerCase());
			return {
				id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
				presence: has ? translate("onecPresent") : translate("onecAbsent"),
				rolesLabel: has?.length ? has.join(", ") : "—",
			};
		}), [bases.data, occByBase]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });

	// ── Роли: строки SubTable ───────────────────────────────────────────────
	const roleOptions = useMemo(() => {
		const known = (roles.data?.items ?? []).map((r) => r.name);
		const own = [...new Set([...occByBase.values()].flat())];
		return [...new Set([...own, ...known])].sort((a, b) => a.localeCompare(b, "ru"));
	}, [roles.data, occByBase]);

	/** Роли, которые у человека уже есть: из отмеченных баз, иначе из всех его баз. */
	const currentRoles = useMemo(() => {
		const src = pickedBases.length
			? pickedBases.flatMap((k) => occByBase.get(k.toLowerCase()) ?? [])
			: [...occByBase.values()].flat();
		return [...new Set(src)].sort((a, b) => a.localeCompare(b, "ru"));
	}, [pickedBases, occByBase]);

	const fillRoles = useCallback(() => {
		setRoleRows(currentRoles.map((role, i) => ({ id: i + 1, uuid: role, role, act: "keep" as RoleAct })));
	}, [currentRoles]);

	/**
	 * Права пользователя показываются СРАЗУ при его выборе, а не по кнопке.
	 *
	 * Пустая таблица ролей у человека, у которого они есть, читается как «ролей нет» —
	 * то есть врёт. Заполняем при смене пользователя; правки, сделанные руками, при этом
	 * не затираем: пересборка идёт только когда сменился сам пользователь.
	 */
	const filledFor = useRef<string>("");
	useEffect(() => {
		if (!current || filledFor.current === current) return;
		if (!occurrences.data) return;
		filledFor.current = current;
		fillRoles();
	}, [current, occurrences.data, fillRoles]);

	/** Сколько отмеченных баз уже имеют эту роль — видно до применения. */
	const inBasesLabel = useCallback((role: string) => {
		if (!pickedBases.length) return "—";
		const n = pickedBases.filter((k) => (occByBase.get(k.toLowerCase()) ?? []).includes(role)).length;
		return `${n} / ${pickedBases.length}`;
	}, [pickedBases, occByBase]);

	// ── Что произойдёт ──────────────────────────────────────────────────────
	const plan = useMemo(() => pickedBases.map((key) => {
		const has = new Set(occByBase.get(key.toLowerCase()) ?? []);
		const add = roleRows.filter((r) => r.act === "grant" && !has.has(asText(r.role))).map((r) => asText(r.role));
		const del = roleRows.filter((r) => r.act === "revoke" && has.has(asText(r.role))).map((r) => asText(r.role));
		// Единственный администратор: снятие оставило бы базу без администратора вовсе.
		const lastAdmin = del.includes(ADMIN_ROLE) && (adminsByBase.get(key.toLowerCase()) ?? 0) <= 1;
		return { key, add, del, blocked: lastAdmin ? translate("onecLastAdminBlock") : null };
	}), [pickedBases, roleRows, occByBase, adminsByBase]);

	const targets = plan.filter((p) => !p.blocked && (p.add.length || p.del.length || form.fullName.trim() || form.password));
	const blocked = plan.filter((p) => p.blocked);

	// ── Команды ─────────────────────────────────────────────────────────────
	const batch = useMutation({
		mutationFn: (p: { type: BatchType; keys: string[]; payload: Record<string, unknown> }) =>
			runBatch(p.type, p.keys, p.payload),
		onSuccess: (d) => {
			setDialog(null);
			const skipped = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${skipped}`, d.skipped.length ? "warning" : "success");
			onBatchStarted(d.batchId);
			// Данные обновятся сами, когда задание закончится: панель не должна показывать
			// прежние роли после того, как их изменили.
			void watchBatch(d.batchId);
		},
		onError: (e) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const apply = useCallback(() => {
		if (!current || !targets.length) return;
		const keys = targets.map((t) => t.key);
		/**
		 * Роли уходят ОТНОСИТЕЛЬНО каждой базы: назначить одни, снять другие.
		 *
		 * Раньше здесь считался итоговый набор по ПЕРВОЙ базе и слался во все — базы с
		 * другими наборами молча выравнивались по первой. Разница между «добавить» и
		 * «заменить» существует ровно для того, чтобы этого не происходило.
		 */
		const addRoles = roleRows.filter((r) => r.act === "grant").map((r) => asText(r.role));
		const removeRoles = roleRows.filter((r) => r.act === "revoke").map((r) => asText(r.role));

		// Отмечено несколько человек — команда уходит по каждому: одно задание на
		// пользователя, чтобы в отчёте было видно, у кого что не получилось.
		const people = pickedUsers.length ? pickedUsers : [current];
		for (const person of people) {
			batch.mutate({
				type: "IB_UPDATE_USER", keys,
				payload: {
					name: person,
					// Переименование имеет смысл только для одного человека: одно имя на всех
					// создало бы дубли. При групповой правке поле не отправляется.
					...(people.length === 1 && form.name.trim() && form.name.trim() !== current
						? { newName: form.name.trim() } : {}),
					...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
					...(form.password ? { password: form.password } : {}),
					...(addRoles.length ? { addRoles } : {}),
					...(removeRoles.length ? { removeRoles } : {}),
					disabled: form.disabled,
					showInList: form.showInList,
				},
			});
		}
	}, [batch, current, pickedUsers, targets, roleRows, form]);

	const removeUser = useCallback(() => {
		if (!current || !pickedBases.length) return;
		batch.mutate({ type: "IB_DELETE_USER", keys: pickedBases, payload: { name: current } });
	}, [batch, current, pickedBases]);

	const createUser = useCallback(() => {
		if (!form.name.trim() || !pickedBases.length) return;
		batch.mutate({
			type: "IB_CREATE_USER", keys: pickedBases,
			payload: {
				name: form.name.trim(),
				...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
				...(form.password ? { password: form.password } : {}),
				...(roleRows.some((r) => r.act === "grant")
					? { roles: roleRows.filter((r) => r.act === "grant").map((r) => asText(r.role)) } : {}),
			},
		});
	}, [batch, form, pickedBases, roleRows]);

	/**
	 * Роль в таблице не должна повторяться: две строки с одним именем и разными
	 * действиями («назначить» и «снять») — это команда, которая противоречит сама себе,
	 * и что победит, зависело бы от порядка строк.
	 */
	const roleValidators = useMemo<Record<string, TCellValidator>>(() => ({
		role: (value, row) => {
			const v = asText(value).trim();
			if (!v) return translate("onecRoleRequired");
			const dup = roleRows.some((r) => asText(r.id) !== asText(row.id) && asText(r.role) === v);
			return dup ? translate("onecRoleDuplicate") : undefined;
		},
	}), [roleRows]);

	/** Новая строка получает первую ЕЩЁ НЕ выбранную роль — иначе она сразу дубль. */
	const nextFreeRole = useCallback(() => {
		const used = new Set(roleRows.map((r) => asText(r.role)));
		return roleOptions.find((r) => !used.has(r)) ?? "";
	}, [roleRows, roleOptions]);

	const parallel = useCheckParallel();
	const [checking, setChecking] = useState(false);

	/**
	 * Перечитать пользователей баз у самой 1С и обновить экран.
	 *
	 * Сервис после каждой удачной изменяющей команды сам ставит чтение той же базы, но
	 * ждать его результата панель не обязана: кнопка делает это сразу и по выбранным
	 * базам. Чтение безопасно — базу оно не меняет.
	 */
	const recheck = useCallback(async (keys: string[]) => {
		if (!keys.length) return;
		setChecking(true);
		const r = await checkBases(keys, fetchBaseUsers, parallel);
		setChecking(false);
		// Точечно: чтение обновило кэш пользователей и ролей, остальное не трогаем.
		await qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
		await qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
		await qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
		await qc.invalidateQueries({ queryKey: ["onec", "role-holders"] });
		showToast(
			r.failed.length
				? `${translate("onecChecked")}: ${r.ok}/${keys.length}. ${translate("onecCheckFailed")}: ${r.failed[0].baseKey} — ${r.failed[0].message}`
				: `${translate("onecChecked")}: ${r.ok}`,
			r.failed.length ? "warning" : "success",
		);
	}, [parallel, qc]);

	/**
	 * Дождаться конца задания и перечитать данные.
	 *
	 * Без этого экран остаётся с картиной «до»: роли назначены, а в таблице прежние —
	 * и человек назначает их второй раз. Опрос редкий: задание на сотню баз идёт минутами.
	 */
	const watchBatch = useCallback(async (batchId: string) => {
		// Пауза растёт: задание на сотню баз идёт минутами, и ровный опрос раз в 3 секунды
		// давал бы под две сотни запросов, каждый из которых говорит одно и то же.
		let pause = 2000;
		const until = Date.now() + 15 * 60_000;
		while (Date.now() < until) {
			await new Promise((r) => setTimeout(r, pause));
			pause = Math.min(15_000, Math.round(pause * 1.4));
			const b = await fetchBatch(batchId).catch(() => null);
			if (!b) return;
			if (b.pending === 0) break;
		}
		// Сбрасываем ТОЛЬКО то, что могло измениться: сеансы, агенты и задания к ролям
		// отношения не имеют, а их перезапрос стоит команд в кластер.
		await qc.invalidateQueries({ queryKey: ["onec", "user-where"] });
		await qc.invalidateQueries({ queryKey: ["onec", "user-summary"] });
		await qc.invalidateQueries({ queryKey: ["onec", "base-users-cached"] });
		await qc.invalidateQueries({ queryKey: ["onec", "role-holders"] });
	}, [qc]);

	/**
	 * Давность данных: экран, построенный по кэшу недельной давности, выглядит так же
	 * уверенно, как по свежему. Число баз и дата снимают этот вопрос без нажатий.
	 */
	const staleHint = useMemo(() => {
		const items = occurrences.data?.items ?? [];
		if (!current || !items.length) return "";
		const last = items.map((o) => o.seenAt).sort().at(-1);
		return last ? `${translate("onecDataFrom")}: ${getFormatDate(last)} · ${items.length} ${translate("bases").toLowerCase()}` : "";
	}, [current, occurrences.data]);

	/**
	 * Матрица «базы × роли»: строки — базы, столбцы — роли, на пересечении отметка.
	 *
	 * Отвечает на вопрос, которого не видно ни в одной другой таблице: ГДЕ у человека
	 * роли расходятся. Колонки строятся по объединению ролей всех его баз — их обычно
	 * единицы, и матрица остаётся читаемой.
	 */
	const matrixRoles = useMemo(
		() => [...new Set([...occByBase.values()].flat())].sort((a, b) => a.localeCompare(b, "ru")),
		[occByBase],
	);

	const matrixColumns = useMemo(() => ([
		{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
		...matrixRoles.map((r) => ({
			identifier: `role:${r}`, type: "string", width: "150px", minWidth: "90px",
			alignment: "center", visible: true, inlist: true,
		})),
	] as unknown as TColumn[]), [matrixRoles]);

	const matrixRows = useMemo(() => (occurrences.data?.items ?? []).map((o, i) => {
		const row: TDataItem = { id: i + 1, uuid: o.baseKey, baseKey: o.baseKey };
		for (const r of matrixRoles) row[`role:${r}`] = (o.roles ?? []).includes(r) ? "✓" : "";
		return row;
	}), [occurrences.data, matrixRoles]);
	const matrixView = useStaticTableView(matrixRows, { baseKey: "asc" });
	const [matrixCols, setMatrixCols] = useState<TColumn[]>([]);
	useEffect(() => setMatrixCols(matrixColumns), [matrixColumns]);

	/**
	 * Эталон — база с самым полным набором ролей. По ней выравнивают остальные: это
	 * ЗАМЕНА набора (roles), а не правка, поэтому команда идёт отдельной кнопкой и с
	 * подтверждением — «выдать роль» и «сделать как здесь» разные вещи.
	 */
	const reference = useMemo(() => {
		const items = occurrences.data?.items ?? [];
		return items.reduce<{ baseKey: string; roles: string[] } | null>(
			(best, o) => (!best || (o.roles ?? []).length > best.roles.length
				? { baseKey: o.baseKey, roles: o.roles ?? [] } : best), null);
	}, [occurrences.data]);

	const alignToReference = useCallback(() => {
		if (!current || !reference || !pickedBases.length) return;
		batch.mutate({
			type: "IB_UPDATE_USER",
			keys: pickedBases.filter((k) => k.toLowerCase() !== reference.baseKey.toLowerCase()),
			payload: { name: current, roles: reference.roles },
		});
	}, [batch, current, reference, pickedBases]);

	/** Что делали с этим пользователем из панели. */
	const history = useQuery({
		queryKey: ["onec", "user-history", current],
		queryFn: () => fetchUserHistory(current),
		enabled: !!current && tab === "history",
	});

	/** Пользователь есть в сводке, но его баз ещё не читали — это не «ролей нет». */
	const neverRead = !!current && !(occurrences.data?.items ?? []).length && !occurrences.isLoading;

	const systemPicked = pickedUsers.some(isSystemUser);

	return (
		<>
			<CapabilityGuard capability="ib.admin" />

			{/* Режим просмотра — полосой над обеими колонками: в тулбаре узкого списка
			    три кнопки не помещались и переносились в три строки. */}
			<div className={styles.ModeBar}>
				<span className={styles.Hint}>{translate("onecViewBy")}</span>
				<Button variant="secondary" active={mode === "byUser"}
					onClick={() => { setMode("byUser"); setOpenedBase(""); }}>
					{translate("onecByUser")}
				</Button>
				<Button variant="secondary" active={mode === "byBase"}
					onClick={() => { setMode("byBase"); setPickedUsers([]); }}>
					{translate("onecByBase")}
				</Button>
				{staleHint && <span className={styles.Hint}>{staleHint}</span>}
			</div>

			<div className={styles.UsersLayout}>
				{/* ── Слева: кого меняем. Команды — в панели таблицы ───────────── */}
				<div className={styles.UsersList}>
					<QueryError error={mode === "byUser" ? summary.error : bases.error} />
					{mode === "byUser" ? (
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_userSummary", rows: userView.rows, columns: userCols,
							setColumns: setUserCols, sorting: userView.sorting, search: userView.search,
							isLoading: summary.isLoading,
							onReload: () => void summary.refetch(),
							selectable: true,
							onSelectionChange: (sel, all) => {
								const names = all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.name));
								setPickedUsers(names);
								if (names[0]) setForm((f) => ({ ...f, name: names[0], fullName: "", password: "" }));
							},
							extraButtons: (
								<Button variant="secondary" disabled={!pickedBases.length}
									title={translate("onecUserCreateInBases")}
									onClick={() => { setForm({ name: "", fullName: "", password: "", disabled: false, showInList: true }); setDialog("create"); }}>
									{translate("create")}
								</Button>
							),
						})} />
					) : (
						<Table {...buildStaticTableProps({
							componentName: "OneCAdmin_basePick", rows: basePickView.rows, columns: baseCols,
							setColumns: setBaseCols, sorting: basePickView.sorting, search: basePickView.search,
							isLoading: bases.isLoading,
							onReload: () => void bases.refetch(),
							selectable: true,
							// Отмечают базы: первая становится открытой, все отмеченные — цель команды.
							onSelectionChange: (sel, all) => {
								const keys = all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey));
								setPickedBases(keys);
								setOpenedBase(keys[0] ?? "");
								setPickedUsers([]);
							},
							extraButtons: (
								<Button variant="secondary" disabled={!openedBase || checking}
									onClick={() => void recheck(pickedBases)}>
									{translate("onecUsersCheck")}
								</Button>
							),
						})} />
					)}
				</div>

				{/* ── Справа: карточка. Секции идут вплотную, без воздуха ──────── */}
				<div className={styles.UsersCard}>
					{mode === "byBase" && (
						<>
							<div className={styles.SecHead}>
								{translate("onecBaseUsers")}{openedBase ? `: ${openedBase}` : ""}
								{pickedBases.length > 1 && ` · ${translate("onecBatchTargets")}: ${pickedBases.length}`}
							</div>
							{!openedBase ? (
								<div className={styles.SecBody}>
									<Notice items={[{ type: "info", text: translate("onecPickBaseFirst") }]} />
								</div>
							) : (
								<Table {...buildStaticTableProps({
									componentName: "OneCAdmin_baseUsersCached", rows: baseUserView.rows, columns: buCols,
									setColumns: setBuCols, sorting: baseUserView.sorting, search: baseUserView.search,
									isLoading: baseUsers.isLoading,
									onReload: () => void recheck([openedBase]),
									selectable: true,
									onSelectionChange: (sel, all) => {
										const names = all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.name));
										setPickedUsers(names);
										if (names[0]) setForm((f) => ({ ...f, name: names[0], fullName: "", password: "" }));
									},
									extraButtons: (
										<span className={styles.Hint}>
											{baseUserView.rows.length
												? translate("onecPickUserInBase")
												: translate("onecBaseUsersEmpty")}
										</span>
									),
								})} />
							)}
						</>
					)}

					{!current ? (
						mode === "byUser"
							? <Notice items={[{ type: "info", text: translate("onecPickUserFirst") }]} />
							: null
					) : (
						<>
							<div className={styles.SecHead}>
								{translate("onecUserCard")}: {current}
								{pickedUsers.length > 1 && ` · ${translate("onecBatchTargets")}: ${pickedUsers.length}`}
								<span className={styles.HeadActions}>
									<Button variant="secondary" active={tab === "edit"} onClick={() => setTab("edit")}>
										{translate("onecTabEdit")}
									</Button>
									<Button variant="secondary" active={tab === "matrix"} onClick={() => setTab("matrix")}>
										{translate("onecTabMatrix")}
									</Button>
									<Button variant="secondary" active={tab === "history"} onClick={() => setTab("history")}>
										{translate("onecTabHistory")}
									</Button>
								</span>
							</div>
							{tab === "edit" && <div className={styles.SecBody}>
								{systemPicked && <Notice items={[{ type: "warning", text: translate("onecSystemUserWarn") }]} />}
								{neverRead && <Notice items={[{ type: "info", text: translate("onecUserNeverRead") }]} />}
								{pickedUsers.length > 1 && (
									<Notice items={[{ type: "info",
										text: `${translate("onecGroupEditHint")} (${pickedUsers.length})` }]} />
								)}
								<GroupCol>
									<GroupRow>
										<Field name="ou_name" label={translate("onecUserName")} value={form.name} width="220px"
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} />
										<Field name="ou_full" label={translate("onecUserFullName")} value={form.fullName} width="220px"
											autoComplete="off" placeholder={translate("onecKeepAsIs")}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
										<Field name="ou_pwd" label={translate("onecUserPassword")} type="password" value={form.password}
											width="190px" autoComplete="new-password" placeholder={translate("onecKeepAsIs")}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))} />
									</GroupRow>
									<GroupRow>
										<FieldToggle name="ou_show" label={translate("onecShowInList")} value={form.showInList}
											onChange={(v) => setForm((f) => ({ ...f, showInList: v }))} />
										<FieldToggle name="ou_disabled" label={translate("onecUserDisabled")} value={form.disabled}
											onChange={(v) => setForm((f) => ({ ...f, disabled: v }))} />
									</GroupRow>
								</GroupCol>
							</div>}

							{/* ── Роли: правка в строках, команды — в панели SubTable ── */}
							{tab === "edit" && <div className={styles.SecHead}>{translate("roles")}</div>}
							{tab === "edit" && <SubTable
								model="onec-user-roles"
								componentName="OneCAdmin_userRoles"
								columnsJson={roleColumns()}
								parentKey="role"
								parentUuid=""
								deferRemoteChanges
								clientSort
								defaultInlineEditing
								showEditModeToggle={false}
								selectable
								hideReload
								initialPendingRows={roleRows}
								defaultNewRow={() => ({ role: nextFreeRole(), act: "grant" })}
								validationRules={roleValidators}
								onAllItemsChange={setRoleRows}
								emptyMessage={translate("onecRolesEmptyRows")}
								extraButtons={
									<Button variant="secondary" onClick={fillRoles} disabled={!occByBase.size}>
										{translate("onecRolesFillFromBases")}
									</Button>
								}
								renderCell={(row, col, ctx) => {
									if (col.identifier === "role") {
										// Поле с подсказками, а не список: ролей в типовой конфигурации сотни,
										// и выпадающий список без поиска среди них бесполезен. Занятые роли
										// из подсказок убраны — повторить её нельзя, предлагать нечестно.
										return (
											<Field name={`role_${asText(row.id)}`} value={asText(row.role)} variant="table"
												suggestions={roleOptions.filter((r) => r === asText(row.role)
													|| !roleRows.some((x) => asText(x.role) === r))}
												onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
													void ctx.handleInlineChange(row, "role", e.target.value)} />
										);
									}
									if (col.identifier === "act") {
										return (
											<FieldSelect name={`act_${asText(row.id)}`} value={asText(row.act) || "keep"} variant="table"
												options={[
													{ value: "keep", label: translate("onecRoleKeep") },
													{ value: "grant", label: translate("onecRoleGrant") },
													{ value: "revoke", label: translate("onecRoleRevoke") },
												]}
												onChange={(e) => void ctx.handleInlineChange(row, "act", e.target.value)} />
										);
									}
									if (col.identifier === "inBases") return <span>{inBasesLabel(asText(row.role))}</span>;
									return undefined;
								}}
							/>}

							{/* ── Матрица: где роли расходятся между базами ─────────── */}
							{tab === "matrix" && (
								<>
									<div className={styles.SecHead}>
										{translate("onecTabMatrix")}
										<span className={styles.Hint}>
											{reference ? `${translate("onecReferenceBase")}: ${reference.baseKey} (${reference.roles.length})` : ""}
										</span>
										<span className={styles.HeadActions}>
											<Button variant="secondary"
												disabled={!reference || !pickedBases.length}
												title={reference ? undefined : translate("onecUserNeverRead")}
												onClick={() => setDialog("align")}>
												{translate("onecAlignToReference")}
											</Button>
										</span>
									</div>
									{matrixRows.length ? (
										<Table {...buildStaticTableProps({
											componentName: "OneCAdmin_userMatrix", rows: matrixView.rows, columns: matrixCols,
											setColumns: setMatrixCols, sorting: matrixView.sorting, search: matrixView.search,
											isLoading: occurrences.isLoading,
											onReload: () => void occurrences.refetch(),
										})} />
									) : (
										<div className={styles.SecBody}>
											<Notice items={[{ type: "info", text: translate("onecUserNeverRead") }]} />
										</div>
									)}
								</>
							)}

							{/* ── История: что делали с этим человеком из панели ───── */}
							{tab === "history" && (
								<>
									<div className={styles.SecHead}>{translate("onecTabHistory")}</div>
									<div className={styles.SecBody}>
										<QueryError error={history.error} />
										{(history.data?.items ?? []).length === 0 && !history.isLoading && (
											<Notice items={[{ type: "info", text: translate("onecHistoryEmpty") }]} />
										)}
										{(history.data?.items ?? []).map((h, i) => (
											<div key={i} className={styles.PlanRow}>
												<span className={styles.PlanBase}>{getFormatDate(h.createdAt)}</span>
												<span>{h.type}</span>
												<span className={styles.Hint}>{h.baseKey ?? "—"}</span>
												<span className={h.state === "done" ? styles.PlanAdd : styles.PlanDel}>
													{h.state === "done" ? translate("onecHistoryDone") : h.error || h.state}
												</span>
											</div>
										))}
									</div>
								</>
							)}

							{/* ── Базы: цель команды. В режиме «по базе» цель уже выбрана слева. ── */}
							{tab === "edit" && mode === "byUser" && <div className={styles.SecHead}>{translate("onecTabBases")}</div>}
							{tab === "edit" && mode === "byUser" && <Table {...buildStaticTableProps({
								componentName: "OneCAdmin_userBases", rows: baseView.rows, columns: baseCols,
								setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
								isLoading: bases.isLoading,
								onReload: () => void bases.refetch(),
								selectable: true,
								onSelectionChange: (sel, all) =>
									setPickedBases(all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey))),
								extraButtons: (
									<>
										<Button variant="primary" disabled={!targets.length} onClick={() => setDialog("apply")}>
											{translate("apply")}
										</Button>
										<Button variant="danger" disabled={!pickedBases.length || systemPicked}
											title={systemPicked ? translate("onecSystemUserWarn") : undefined}
											onClick={() => setDialog("delete")}>
											{translate("onecUserDelete")}
										</Button>
									</>
								),
							})} />}

							{/* ── Что произойдёт. Команды режима «по базе» — здесь же. ── */}
							{tab === "edit" && <div className={styles.SecHead}>{translate("onecWhatHappens")}
								{mode === "byBase" && (
									<span className={styles.HeadActions}>
										<Button variant="primary" disabled={!targets.length} onClick={() => setDialog("apply")}>
											{translate("apply")}
										</Button>
										<Button variant="danger" disabled={!pickedBases.length || systemPicked}
											title={systemPicked ? translate("onecSystemUserWarn") : undefined}
											onClick={() => setDialog("delete")}>
											{translate("onecUserDelete")}
										</Button>
									</span>
								)}
							</div>}
							{tab === "edit" && <div className={styles.SecBody}>
								{!pickedBases.length && <Notice items={[{ type: "info", text: translate("onecPickBasesFirst") }]} />}
								{blocked.length > 0 && (
									<Notice items={[{ type: "warning",
										text: `${translate("onecSkippedBases")}: ${blocked.map((b) => b.key).join(", ")} — ${translate("onecLastAdminBlock")}` }]} />
								)}
								{plan.filter((p) => !p.blocked).map((p) => (
									<div key={p.key} className={styles.PlanRow}>
										<span className={styles.PlanBase}>{p.key}</span>
										{p.add.length > 0 && <span className={styles.PlanAdd}>+ {p.add.join(", ")}</span>}
										{p.del.length > 0 && <span className={styles.PlanDel}>− {p.del.join(", ")}</span>}
										{!p.add.length && !p.del.length && <span className={styles.Hint}>{translate("onecNoChanges")}</span>}
									</div>
								))}
							</div>}
						</>
					)}
				</div>
			</div>

			{dialog && (
				<Modal
					title={dialog === "delete" ? translate("onecUserDelete")
						: dialog === "create" ? translate("onecUserCreateInBases")
							: dialog === "align" ? translate("onecAlignToReference") : translate("apply")}
					onClose={() => setDialog(null)}
					onApply={dialog === "delete" ? removeUser
						: dialog === "create" ? createUser
							: dialog === "align" ? alignToReference : apply}
				>
					<div className={styles.ModalForm}>
						<div>{translate("onecUserName")}: {dialog === "create" ? form.name : current}</div>
						<div>{translate("onecBatchTargets")}: {dialog === "apply" ? targets.length : pickedBases.length}</div>
						{dialog === "align" && reference && (
							<div>{translate("onecReferenceBase")}: {reference.baseKey} — {reference.roles.join(", ") || "—"}</div>
						)}
						<div className={styles.ConfirmWarning}>
							{dialog === "delete" ? translate("onecUserDeleteWarning")
								: dialog === "create" ? translate("onecUserCreateWarning")
									: dialog === "align" ? translate("onecAlignWarning") : translate("onecUserUpdateWarning")}
						</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default UsersTab;
