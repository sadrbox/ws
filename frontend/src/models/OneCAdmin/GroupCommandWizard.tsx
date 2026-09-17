/**
 * Помощник групповой команды — ОДИН на все групповые операции панели.
 *
 * ЗАЧЕМ. Раньше групповая команда жила в модальном окне: набор баз брался из отметок в
 * списке за спиной у окна, параметры вводились там же, а «что из этого выйдет» не
 * показывалось вовсе — человек нажимал «Применить» и узнавал итог из отчёта задания.
 * Три разных вопроса — над чем, что меняем, что получится — стояли вперемешку в одном окне
 * размером с записку.
 *
 * Теперь у каждого вопроса свой шаг, и ответы видны все сразу:
 *   1. БАЗЫ — набор целей. Пришедшие из списка отметки — лишь заготовка: здесь их видно
 *      целиком и можно поправить, не закрывая помощник.
 *   2. ПАРАМЕТРЫ — то, что требует сама команда: имя пользователя, файл расширения,
 *      каталог выгрузки. У команд без параметров шаг занят объяснением, что будет сделано.
 *   3. ЧТО ПРОИЗОЙДЁТ — поимённо: в какие базы уйдёт, какие пропущены и почему.
 *      Предупреждение команды — здесь же, рядом с кнопкой, а не за два экрана от неё.
 *
 * ПРИМЕНИМОСТЬ ПРОВЕРЯЕТСЯ ДО ОТПРАВКИ. Команда, посланная в пропавшую, отключённую или
 * недоступную базу, вернётся отказом по каждой такой базе, и отчёт из ста строк придётся
 * читать целиком, чтобы понять: половина целей была заведомо непригодна.
 */
import { FC, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { buildUserCreate } from "./userUpdate";
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import Wizard, { WizardForm, type WizardStep } from "src/components/Wizard";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { FormArea, GroupRow } from "src/components/UI";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { useAppContext } from "src/app/context";
import {
	fetchBases, type BatchType, type OnecBase, fetchRoles, fetchSessions
} from "src/services/onec/api";
import {
	fitReason, reportBatchStart, usePublishAddressHint, type OnecOperation, type OpTarget, useOnecPermissions,
} from "./shared";
import { SECTION_OF_TYPE, deniedText, sectionAllows } from "./onecPermissions";
import { estimateSecs, formatDuration, useQueueStats } from "./queueStats";
import { runGroupCommand } from "./runGroupCommand";
import main from "src/styles/main.module.scss";
import styles from "./OneCAdmin.module.scss";

/** Что умеет помощник. Набор тот же, что был у групповых команд списка баз. */
export type GroupOp =
	| "publish" | "unpublish"
	| "info" | "denyJobs" | "allowJobs" | "dropRegistration"
	| "createUser" | "deleteUser"
	| "installExt" | "deleteExt"
	| "backup" | "checkBase";

type OpSpec = {
	type: BatchType;
	title: string;
	warning: string;
	/** Какой канал нужен операции — по нему отбираются пригодные базы. */
	needs: OnecOperation;
	/** Нужно ли имя объекта (пользователя или расширения). */
	needsName?: "user" | "extension";
	needsFile?: boolean;
	/** Каталог назначения — необязательный: без него агент берёт свой из настроек. */
	needsDir?: boolean;
	/** Вид операции для реестра прогресса. */
	kind: "create" | "update" | "delete" | "read";
	/** К какому состоянию ведёт операция: базы, которые уже в нём, отсеиваются с причиной (alreadyInTarget). */
	target?: OpTarget;
	/** Готовое тело команды — у операций без полей ввода. */
	payload?: Record<string, unknown>;
	/** Нужен ли операции монопольный доступ к базе: только тогда предупреждаем об активных сеансах. */
	exclusive?: boolean;
};

/** Колонка шага «Права»: одна роль в строке — отметка значит «выдать новому пользователю». */
const rightsColumns = (): TColumn[] => ([
	{ identifier: "role", type: "string", width: "420px", minWidth: "200px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

export const GROUP_OPS: Record<GroupOp, OpSpec> = {
	publish: { type: "IB_PUBLISH", title: "onecPublish", warning: "onecPublishWarning", needs: "publish", kind: "update", target: { published: true } },
	unpublish: { type: "IB_UNPUBLISH", title: "onecUnpublish", warning: "onecUnpublishWarning", needs: "unpublish", kind: "update", target: { published: false } },
	// Сведения — чтение: вход в базу за конфигурацией, расширениями и блокировкой. Монопольного доступа не требует.
	info: { type: "IB_INFO", title: "onecBaseInfoRefresh", warning: "onecBaseInfoGroupPlan", needs: "ib", kind: "read", exclusive: false },
	denyJobs: {
		type: "CLUSTER_SET_SCHEDULED_JOBS", title: "onecScheduledJobsDeny", warning: "onecScheduledJobsDenyPlan",
		needs: "cluster", kind: "update", target: { jobsDenied: true }, payload: { denied: true },
	},
	allowJobs: {
		type: "CLUSTER_SET_SCHEDULED_JOBS", title: "onecScheduledJobsAllow", warning: "onecScheduledJobsAllowPlan",
		needs: "cluster", kind: "update", target: { jobsDenied: false }, payload: { denied: false },
	},
	// Опасная команда: запись в кластере восстанавливается только вручную. `confirm` сервис требует явно.
	dropRegistration: {
		type: "CLUSTER_DROP_INFOBASE", title: "onecBaseDropRegistration", warning: "onecBaseDropRegistrationWarning",
		needs: "drop", kind: "delete", payload: { confirm: true },
	},
	createUser: { type: "IB_CREATE_USER", title: "onecUserCreate", warning: "onecUserCreateWarning", needs: "ib", needsName: "user", kind: "create" },
	deleteUser: { type: "IB_DELETE_USER", title: "onecUserDelete", warning: "onecUserDeleteWarning", needs: "ib", needsName: "user", kind: "delete" },
	installExt: { type: "IB_INSTALL_EXTENSION", title: "onecExtInstall", warning: "onecExtInstallWarning", needs: "ib", needsName: "extension", needsFile: true, kind: "create" },
	deleteExt: { type: "IB_DELETE_EXTENSION", title: "onecExtRemove", warning: "onecExtRemoveWarning", needs: "ib", needsName: "extension", kind: "delete" },
	backup: { type: "IB_BACKUP", title: "onecBackup", warning: "onecBackupWarning", needs: "ib", needsDir: true, kind: "update" },
	// Из обслуживания в группу вынесена ТОЛЬКО проверка: загрузка и обновление по сотне
	// баз одной кнопкой не нужны никому, а ошибиться там нечем — данные затираются целиком.
	checkBase: { type: "IB_CHECK", title: "onecMaintCheck", warning: "onecMaintCheckPlan", needs: "ib", kind: "read" },
};

const baseColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "260px", minWidth: "150px", alignment: "left", visible: true, inlist: true },
	{ identifier: "status", type: "string", width: "140px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "fitLabel", type: "string", width: "320px", minWidth: "160px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const reader = new FileReader();
	reader.onerror = () => reject(new Error(translate("onecExtFileRequired")));
	reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
	reader.readAsDataURL(file);
});

export const GroupCommandWizard: FC<Partial<TPane>> = (paneProps) => {
	const data = (paneProps.data ?? {}) as TDataItem;
	const op = asText(data.op) as GroupOp;
	const perms = useOnecPermissions();
	const spec = GROUP_OPS[op];
	const qc = useQueryClient();
	const { requestClose } = useAppContext().windows;

	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const items = useMemo(() => bases.data?.items ?? [], [bases.data]);
	// Отметки из списка — ЗАГОТОВКА, а не приговор: здесь их видно целиком и можно поправить.
	const preset = useMemo(() => new Set(
		(Array.isArray(data.baseKeys) ? (data.baseKeys as string[]) : []).map((k) => k.toLowerCase()),
	), [data.baseKeys]);
	const [picked, setPicked] = useState<Set<string>>(preset);

	/*
	 * Какой получится ссылка после публикации. Групповая публикация идёт на ОДИН сервер —
	 * тот, где живут отмеченные базы, — поэтому имя сервера берём у первой отмеченной, а
	 * когда сервер в реестре один, оно и не требуется.
	 */
	const address = usePublishAddressHint(items.find((b) => picked.has(b.key.toLowerCase()))?.serverName);

	/** Оценка времени операции: измеренная длительность типа × число баз ÷ параллельность. */
	const stats = useQueueStats();
	const eta = formatDuration(estimateSecs(stats.data, spec?.type ?? "", picked.size));

	const [name, setName] = useState(asText(data.name));
	// Роли нового пользователя (шаг «Права»). IB_CREATE_USER принимает их вместе с именем и паролем — без
	// этого шага пользователь заводился без единого права, и за ролями шли второй командой в карточку.
	const [roles, setRoles] = useState<Set<string>>(new Set());
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);
	const [dir, setDir] = useState("");

	// ── Шаг 1: базы и их пригодность ────────────────────────────────────────
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_gcwBases"));
	// Непригодна (нет в кластере, не войти) — причина; пригодна, но уже в нужном состоянии — тоже причина: команда
	// ей ничего не изменит (alreadyInTarget).
	const fitOf = useCallback((b: OnecBase) => (spec ? fitReason(b, spec.needs, spec.target) : ""), [spec]);
	const baseRows = useMemo(() => items.map((b, i) => ({
		id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
		status: b.status,
		// Почему база непригодна — сразу в строке: иначе «применимо 40 из 100» выглядит
		// как потеря половины выбора без объяснения.
		/*
		 * Снятие регистрации: у базы, в которую не войти, ответ предсказуем, а у остальных решает агент — он смотрит
		 * СУБД и у работающей базы откажет. Говорим это в строке, а не прячем команду (17.09).
		 */
		fitLabel: fitOf(b)
			|| (spec?.needs === "drop" && !b.ibUnreachableAt ? translate("onecDropAgentWillVerify") : translate("onecFitOk")),
		__fit: fitOf(b) === "",
	})), [items, fitOf]);
	const baseView = useStaticTableView(baseRows, { baseKey: "asc" });
	const presetIds = useMemo(
		() => new Set(baseRows.filter((r) => picked.has(r.baseKey.toLowerCase())).map((r) => r.id)),
		[baseRows, picked],
	);

	const targets = useMemo(
		() => items.filter((b) => picked.has(b.key.toLowerCase()) && fitOf(b) === "").map((b) => b.key),
		[items, picked, fitOf],
	);
	const skipped = useMemo(
		() => items.filter((b) => picked.has(b.key.toLowerCase()) && fitOf(b) !== "")
			.map((b) => ({ key: b.key, reason: fitOf(b) })),
		[items, picked, fitOf],
	);

	/*
	 * ЗАНЯТЫЕ БАЗЫ — ДО НАЖАТИЯ (П27). Платформе нужен монопольный доступ: живой сеанс останавливает установку
	 * расширения, загрузку и обновление. Узнавать об этом из отказа через двадцать минут ожидания в очереди — поздно,
	 * а «Фоновое задание» вдобавок не убирается блокировкой входа: его снимают сеансом или запретом регламентных.
	 */
	const needsExclusive = spec?.needs === "ib" && spec.exclusive !== false;
	const sessions = useQuery({
		queryKey: ["onec", "sessions"], queryFn: fetchSessions,
		enabled: needsExclusive && picked.size > 0, staleTime: 30_000,
	});
	const busy = useMemo(() => {
		const uuids = new Set(items.filter((b) => targets.includes(b.key)).map((b) => b.infobaseId).filter(Boolean));
		const rows = (sessions.data?.items ?? []).filter((r) => uuids.has(r.infobase));
		const jobs = rows.filter((r) => /BackgroundJob|Фоновое задание/i.test(r.appId ?? "")).length;
		return { total: rows.length, jobs };
	}, [items, targets, sessions.data]);

	// ── Шаг «Права»: роли нового пользователя (только создание) ─────────────
	const isCreateUser = spec?.type === "IB_CREATE_USER";
	const rolesQuery = useQuery({
		queryKey: ["onec", "roles", ""], queryFn: () => fetchRoles(), staleTime: 5 * 60_000, enabled: isCreateUser,
	});
	const [rightsCols, setRightsCols] = useState<TColumn[]>(() => getModelColumns(rightsColumns(), "OneCAdmin_gcwRights"));
	const rightsRows = useMemo(
		() => (rolesQuery.data?.items ?? []).map((r, i) => ({ id: i + 1, uuid: r.name, role: r.name })),
		[rolesQuery.data],
	);
	const rightsView = useStaticTableView(rightsRows, { role: "asc" });
	const rightsPreset = useMemo(
		() => new Set(rightsRows.filter((r) => roles.has(r.role)).map((r) => r.id)),
		[rightsRows, roles],
	);

	// ── Что не хватает для запуска ──────────────────────────────────────────
	const paramsMissing = useMemo(() => {
		if (!spec) return translate("unknownError");
		if (spec.needsName && !name.trim()) {
			return translate(spec.needsName === "user" ? "onecUserName" : "onecExtName");
		}
		if (spec.needsFile && !file) return translate("onecExtFileRequired");
		return "";
	}, [spec, name, file]);

	const run = useMutation({
		mutationFn: async () => {
			if (!spec) throw new Error(translate("unknownError"));
			const payload: Record<string, unknown> =
				spec.type === "IB_CREATE_USER"
					// Роли шага «Права» уходят вместе с именем и паролем (userUpdate.buildUserCreate):
					// без них пользователь заводился без единого права, а шаг выглядел рабочим.
					? buildUserCreate({ name, fullName, password, roles: [...roles] })
					: spec.type === "IB_INSTALL_EXTENSION"
						? { name: name.trim(), safeMode, contentBase64: file ? await toBase64(file) : "" }
						: spec.needsDir
							? (dir.trim() ? { dir: dir.trim() } : {})
							: spec.needsName ? { name: name.trim() } : { ...(spec.payload ?? {}) };

			return await runGroupCommand(spec, targets, payload);
		},
		onSuccess: (r) => {
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			// Итог до закрытия помощника: если ни одна команда не встала в очередь, человек
			// должен узнать это сейчас, а не через два часа по пустому заданию.
			reportBatchStart(r, translate(spec.title));
			if (paneProps.uniqId) void requestClose(paneProps.uniqId);
		},
		onError: (e) => reportError(e, { source: translate(spec.title) }),
	});

	if (!spec) {
		return (
			<div className={main.PaneFill}>
				<Notice inline items={[{ type: "error", text: translate("unknownError") }]} />
			</div>
		);
	}

	const steps: WizardStep[] = [
		{
			id: "bases",
			title: translate("onecWizStepBases"),
			hint: translate("onecWizStepTargetsHint"),
			blockedReason: targets.length ? "" : translate("onecPickBasesFirst"),
			body: (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_gcwBases", rows: baseView.rows, columns: baseCols,
					setColumns: setBaseCols, sorting: baseView.sorting, search: baseView.search,
					isLoading: bases.isLoading,
					reloading: bases.isFetching,
					onReload: () => void bases.refetch(),
					selectable: true,
					presetSelectedRows: presetIds,
					onSelectionChange: (sel, all) => setPicked(new Set(
						all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.baseKey).toLowerCase()),
					)),
				})} />
			),
		},
		{
			id: "params",
			title: translate("onecWizStepParams"),
			hint: translate("onecWizStepParamsHint"),
			blockedReason: paramsMissing ? `${translate("onecWizNeed")}: ${paramsMissing}` : "",
			body: (
				<WizardForm aside={<Notice inline items={[{ type: "info", text: translate(spec.warning) }]} />}>
					<>
							{spec.needsName && (
								<GroupRow>
									<Field name="gcw_name" noAutofill width={FIELD_WIDTH.wide}
										label={translate(spec.needsName === "user" ? "onecUserName" : "onecExtName")}
										value={name}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
								</GroupRow>
							)}
							{spec.type === "IB_CREATE_USER" && (
								<GroupRow>
									<Field name="gcw_full" noAutofill width={FIELD_WIDTH.wide}
										label={translate("onecUserFullName")} value={fullName}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)} />
									<Field name="gcw_pwd" type="password" width={FIELD_WIDTH.wide}
										label={translate("onecUserPassword")} value={password}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
								</GroupRow>
							)}
							{spec.needsFile && (
								<GroupRow>
									<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
									<FieldToggle name="gcw_safe" label={translate("onecExtSafeMode")}
										value={safeMode} onChange={setSafeMode} />
								</GroupRow>
							)}
							{spec.needsDir && (
								<GroupRow>
									{/* Каталог необязателен: раскладку дисков сервера знает агент. */}
									<Field name="gcw_dir" noAutofill width={FIELD_WIDTH.lg}
										label={translate("onecBackupDir")} value={dir}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDir(e.target.value)} />
								</GroupRow>
							)}
							{!spec.needsName && !spec.needsFile && !spec.needsDir && (
								<Notice inline items={[{ type: "info", text: translate("onecWizNoParams") }]} />
							)}
					</>
				</WizardForm>
			),
		},
		...(isCreateUser ? [{
			id: "rights",
			title: translate("onecTabRights"),
			hint: translate("onecWizStepRightsCreateHint"),
			body: (
				<Table {...buildStaticTableProps({
					componentName: "OneCAdmin_gcwRights", rows: rightsView.rows, columns: rightsCols,
					setColumns: setRightsCols, sorting: rightsView.sorting, search: rightsView.search,
					isLoading: rolesQuery.isLoading,
					reloading: rolesQuery.isFetching,
					onReload: () => void rolesQuery.refetch(),
					// Строка — не «текущая запись», а отметка: роль либо выдаётся новому пользователю, либо нет.
					disableActiveRow: true,
					selectable: true,
					presetSelectedRows: rightsPreset,
					onSelectionChange: (sel, all) => setRoles(new Set(
						all.filter((r) => sel.has(Number(r.id))).map((r) => asText(r.role)),
					)),
				})} />
			),
		}] : []),
		{
			id: "plan",
			title: translate("onecWhatHappens"),
			// Тот же каркас, что и у шага параметров: шаги одного помощника не должны
			// выглядеть как страницы из разных программ.
			body: (
				<WizardForm aside={<Notice inline items={[
					{ type: "attention", text: translate(spec.warning) },
					/*
					 * Публикация — единственная операция, у которой есть АДРЕС, и он решает,
					 * будет ли от неё толк: агент отдаёт то, что записано в привязке сайта
					 * IIS (обычно localhost), а полезной ссылку делает «Адрес сервера» из
					 * параметров агента. Называем адрес до нажатия, а не после.
					 */
					...(spec.type === "IB_PUBLISH" ? [address] : []),
					// Сеансы мешают только операциям внутрь базы; молчим, когда база свободна (П27).
					...(busy.total ? [{
						type: "warning" as const,
						text: `${translate("onecBusySessionsWarn")}: ${busy.total}`
							+ (busy.jobs ? ` · ${translate("onecBusyBackgroundJobs")}: ${busy.jobs}` : "")
							+ `. ${translate("onecBusySessionsHint")}`,
					}] : []),
				]} />}>
					<>
						<GroupRow>
							<Field name="gcw_plan_op" label={translate("onecWhatHappens")}
								value={translate(spec.title)} disabled width={FIELD_WIDTH.wide} onChange={() => {}} />
							<Field name="gcw_plan_count" label={translate("onecBatchTargets")}
								value={String(targets.length)} disabled width={FIELD_WIDTH.sm} onChange={() => {}} />
							{/*
							  * СКОЛЬКО ЭТО ЗАЙМЁТ — до нажатия, а не после. Сто десять баз по
							  * измеренным девятнадцати секундам — это тридцать пять минут, и
							  * человек вправе узнать это заранее, а не по счётчику «7 из 110».
							  * Оценка берётся из фактических длительностей за неделю; нет
							  * замеров — так и говорим, а не выдумываем округлое число.
							  */}
							<Field name="gcw_plan_eta" label={translate("onecEstimate")}
								value={eta || translate("onecEstimateUnknown")}
								disabled width={FIELD_WIDTH.md} onChange={() => {}} />
						</GroupRow>
						<FormArea title={translate("onecTabBases")}>
							<div className={styles.PlanRow}>
								<span className={styles.PlanAdd}>{targets.join(", ") || translate("onecNoChanges")}</span>
							</div>
						</FormArea>
						{/*
						  * ПРАВА — В ПЛАНЕ. Отмеченные роли уходят вместе с командой создания, и человек
						  * должен видеть их здесь же, рядом с базами: шаг «Права» остаётся позади, а
						  * пользователь без единой роли — самый заметный способ ошибиться молча.
						  */}
						{isCreateUser && (
							<FormArea title={translate("onecTabRights")}>
								<div className={styles.PlanRow}>
									<span className={roles.size ? styles.PlanAdd : styles.PlanDel}>
										{roles.size
											? [...roles].sort((a, b) => a.localeCompare(b, "ru")).join(", ")
											: translate("onecWizNoRoles")}
									</span>
								</div>
							</FormArea>
						)}
						{skipped.length > 0 && (
							<FormArea title={translate("onecSkippedBases")}>
								<div className={styles.PlanRow}>
									<span className={styles.PlanDel}>
										{skipped.map((x) => `${x.key} (${x.reason})`).join(", ")}
									</span>
								</div>
							</FormArea>
						)}
					</>
				</WizardForm>
			),
		},
	];

	const sectionNeed = SECTION_OF_TYPE[spec.type];
	// Переустановка уже установленного расширения — «редактирование»: какие базы его имеют, точно решит сервис.
	const installByEdit = spec.type === "IB_INSTALL_EXTENSION" && sectionAllows(perms, "extensions", "edit", targets.length);
	const permissionBlock = sectionNeed && !installByEdit && !sectionAllows(perms, sectionNeed.section, sectionNeed.action, targets.length)
		? deniedText(perms, sectionNeed.section, sectionNeed.action, targets.length) : "";

	return (
		<div className={main.PaneFill}>
			<Wizard
				steps={steps}
				finishLabel={translate(spec.title)}
				finishBlockedReason={
					!targets.length ? translate("onecPickBasesFirst")
						// Пользователи и расширения — по вложенным разрешениям (действие и групповое редактирование).
						: permissionBlock ? permissionBlock
						: paramsMissing ? `${translate("onecWizNeed")}: ${paramsMissing}` : ""
				}
				finishing={run.isPending}
				onFinish={() => run.mutate()}
				onCancel={paneProps.uniqId ? () => void requestClose(paneProps.uniqId!) : undefined}
			/>
		</div>
	);
};
GroupCommandWizard.displayName = "GroupCommandWizard";

/**
 * Открыть помощник групповой команды отдельным пейном.
 *
 * Отметки из списка передаются заготовкой: помощник показывает их целиком и позволяет
 * поправить, не закрываясь, — но не подменяет собой выбор, сделанный в списке.
 */
export function useOpenGroupCommand() {
	const { addPane } = useAppContext().windows;
	return (op: GroupOp, baseKeys: string[], presetName = "") => {
		addPane({
			label: `${translate(GROUP_OPS[op].title)}`,
			component: GroupCommandWizard as never,
			data: { op, baseKeys, name: presetName } as unknown as TDataItem,
		});
	};
}

export default GroupCommandWizard;
