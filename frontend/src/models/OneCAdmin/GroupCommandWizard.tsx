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
import Table from "src/components/Table";
import Notice from "src/components/Notice";
import Wizard, { WizardForm, type WizardStep } from "src/components/Wizard";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { FormArea, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { useAppContext } from "src/app/context";
import { fetchBases, runBatch, type BatchType, type OnecBase } from "src/services/onec/api";
import { isApplicable, unreachableReason, usePublishAddressHint, type OnecOperation } from "./shared";
import { attachBatch, finishOp, startOp } from "./progress";
import main from "src/styles/main.module.scss";
import styles from "./OneCAdmin.module.scss";

/** Что умеет помощник. Набор тот же, что был у групповых команд списка баз. */
export type GroupOp =
	| "publish" | "unpublish"
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
};

export const GROUP_OPS: Record<GroupOp, OpSpec> = {
	publish: { type: "IB_PUBLISH", title: "onecPublish", warning: "onecPublishWarning", needs: "publish", kind: "update" },
	unpublish: { type: "IB_UNPUBLISH", title: "onecUnpublish", warning: "onecUnpublishWarning", needs: "unpublish", kind: "update" },
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

	const [name, setName] = useState(asText(data.name));
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);
	const [dir, setDir] = useState("");

	// ── Шаг 1: базы и их пригодность ────────────────────────────────────────
	const [baseCols, setBaseCols] = useState<TColumn[]>(() => getModelColumns(baseColumns(), "OneCAdmin_gcwBases"));
	const fitOf = useCallback((b: OnecBase) => (spec && isApplicable(b, spec.needs) ? "" : unreachableReason(b)), [spec]);
	const baseRows = useMemo(() => items.map((b, i) => ({
		id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
		status: b.status,
		// Почему база непригодна — сразу в строке: иначе «применимо 40 из 100» выглядит
		// как потеря половины выбора без объяснения.
		fitLabel: fitOf(b) || translate("onecFitOk"),
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
					? {
						name: name.trim(),
						...(fullName.trim() ? { fullName: fullName.trim() } : {}),
						...(password ? { password } : {}),
					}
					: spec.type === "IB_INSTALL_EXTENSION"
						? { name: name.trim(), safeMode, contentBase64: file ? await toBase64(file) : "" }
						: spec.needsDir
							? (dir.trim() ? { dir: dir.trim() } : {})
							: spec.needsName ? { name: name.trim() } : {};

			const opId = startOp({
				kind: spec.kind, title: translate(spec.title),
				target: `${translate("onecBases")}: ${targets.length}`,
				total: targets.length, scope: { bases: targets },
			});
			try {
				const r = await runBatch(spec.type, targets, payload);
				attachBatch(opId, r.batchId, r.total,
					r.skipped.length ? `${translate("onecBatchSkipped")}: ${r.skipped.length}` : "");
				return r;
			} catch (e) {
				finishOp(opId, { failed: targets.length, note: e instanceof Error ? e.message : String(e) });
				throw e;
			}
		},
		onSuccess: (r) => {
			const tail = r.skipped.length ? ` ${translate("onecBatchSkipped")}: ${r.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${r.queued}/${r.total}.${tail}`,
				r.skipped.length ? "warning" : "success");
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
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
				]} />}>
					<>
						<GroupRow>
							<Field name="gcw_plan_op" label={translate("onecWhatHappens")}
								value={translate(spec.title)} disabled width={FIELD_WIDTH.wide} onChange={() => {}} />
							<Field name="gcw_plan_count" label={translate("onecBatchTargets")}
								value={String(targets.length)} disabled width={FIELD_WIDTH.sm} onChange={() => {}} />
						</GroupRow>
						<FormArea title={translate("onecTabBases")}>
							<div className={styles.PlanRow}>
								<span className={styles.PlanAdd}>{targets.join(", ") || translate("onecNoChanges")}</span>
							</div>
						</FormArea>
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

	return (
		<div className={main.PaneFill}>
			<Wizard
				steps={steps}
				finishLabel={translate(spec.title)}
				finishBlockedReason={
					!targets.length ? translate("onecPickBasesFirst")
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
