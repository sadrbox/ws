/**
 * «Обслуживание» — операции над самой базой: проверка, выгрузка, загрузка, обновление
 * конфигурации.
 *
 * ПОЧЕМУ В КАРТОЧКЕ, А НЕ В СПИСКЕ. Все четыре об одном и том же — о состоянии ОДНОЙ базы,
 * и цена ошибки у них измеряется часами работы сервера. Загрузка по сотне баз одной кнопкой
 * не нужна никому; из группового меню оставлена только проверка.
 *
 * ПЛАН ВМЕСТО ДОГАДКИ. Каждая операция умеет `dryRun`: агент возвращает, что именно
 * произойдёт («ЗАМЕНИТЬ данные базы из …»), и базу не трогает. Этот текст и показывается в
 * подтверждении — он точнее любого сочинённого нами: его пишет тот, кто будет выполнять.
 *
 * ДВА РАЗНЫХ ПОДТВЕРЖДЕНИЯ У ПРОВЕРКИ. Без «Исправлять» она ничего не меняет, и требовать
 * подтверждения на осмотр — приучать подтверждать не глядя. Спрашиваем именно про
 * исправление.
 */
import { FC, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { translate } from "src/i18";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { Icon } from "src/components/IconButton/icons";
import { showToast } from "src/components/UIToast";
import { CapabilityGuard } from "src/models/OneCAdmin/shared";
import { attachBatch, finishOp, startOp } from "src/models/OneCAdmin/progress";
import {
	applyBaseUpdate, checkBase, planText, restoreBase, runBatch,
	type IbApplyUpdateResult, type IbCheckResult, type IbRestoreResult,
} from "src/services/onec/api";
import main from "src/styles/main.module.scss";
import styles from "src/models/OneCAdmin/OneCAdmin.module.scss";

type Job = "check" | "backup" | "restore" | "update";

/** Что показать в подтверждении: план от агента либо наше описание, если плана нет. */
type Confirm = { job: Job; plan: string };

export const BaseMaintenance: FC<{ baseKey: string }> = ({ baseKey }) => {
	const [check, setCheck] = useState({ reindex: true, logicalIntegrity: true, recalcTotals: false, repair: false });
	const [backupDir, setBackupDir] = useState("");
	const [restorePath, setRestorePath] = useState("");
	const [restoreLock, setRestoreLock] = useState(true);
	const [updatePath, setUpdatePath] = useState("");
	const [updateBackup, setUpdateBackup] = useState(true);
	const [updateLock, setUpdateLock] = useState(true);
	const [confirm, setConfirm] = useState<Confirm | null>(null);
	const [report, setReport] = useState("");

	/** Долгая операция в реестре прогресса: она идёт часами, и место ей — на своей вкладке. */
	const track = async <T,>(job: Job, title: string, run: () => Promise<T>): Promise<T> => {
		const op = startOp({ kind: job === "check" ? "read" : "update", title, target: baseKey, total: 1, scope: { bases: [baseKey] } });
		try {
			const r = await run();
			finishOp(op);
			return r;
		} catch (e) {
			finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e) });
			throw e;
		}
	};

	const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error");

	/** Сухой прогон: спрашиваем агента, что произойдёт, и показываем ЕГО текст. */
	const plan = useMutation({
		mutationFn: async (job: Job): Promise<Confirm> => {
			if (job === "check") {
				const r: IbCheckResult = await checkBase(baseKey, { ...check, dryRun: true });
				return { job, plan: planText(r.plan) || r.report || translate("onecMaintCheckPlan") };
			}
			if (job === "restore") {
				const r: IbRestoreResult = await restoreBase(baseKey, { path: restorePath.trim(), lockSessions: restoreLock, dryRun: true });
				return { job, plan: planText(r.plan) || `${translate("onecMaintRestorePlan")}: ${restorePath.trim()}` };
			}
			if (job === "update") {
				const r: IbApplyUpdateResult = await applyBaseUpdate(baseKey, {
					path: updatePath.trim(), backup: updateBackup, lockSessions: updateLock, dryRun: true,
				});
				return { job, plan: planText(r.plan) || `${translate("onecMaintUpdatePlan")}: ${updatePath.trim()}` };
			}
			return { job, plan: translate("onecBackupWarning") };
		},
		onSuccess: (c) => setConfirm(c),
		onError: fail,
	});

	const apply = useMutation({
		mutationFn: async (job: Job) => {
			if (job === "check") {
				const r = await track("check", translate("onecMaintCheck"), () => checkBase(baseKey, check));
				setReport(r.report || "");
				return `${translate("onecMaintIssues")}: ${r.issues ?? 0}${r.repairMode ? `, ${translate("onecMaintRepaired")}: ${r.repaired ?? 0}` : ""}`;
			}
			if (job === "backup") {
				// Выгрузка идёт заданием, как и раньше: она же доступна группой по списку баз.
				const op = startOp({ kind: "update", title: translate("onecBackup"), target: baseKey, total: 1, scope: { bases: [baseKey] } });
				const r = await runBatch("IB_BACKUP", [baseKey], backupDir.trim() ? { dir: backupDir.trim() } : {});
				attachBatch(op, r.batchId, r.total);
				return translate("onecBatchQueued");
			}
			if (job === "restore") {
				const r = await track("restore", translate("onecMaintRestore"),
					() => restoreBase(baseKey, { path: restorePath.trim(), lockSessions: restoreLock }));
				return `${translate("onecMaintRestored")}: ${r.path || restorePath.trim()}`;
			}
			const r = await track("update", translate("onecMaintUpdate"),
				() => applyBaseUpdate(baseKey, { path: updatePath.trim(), backup: updateBackup, lockSessions: updateLock }));
			return `${translate("onecMaintUpdated")}: ${r.versionFrom || "—"} → ${r.versionTo || "—"}`;
		},
		onSuccess: (text) => { showToast(text, "success"); setConfirm(null); },
		onError: (e) => { fail(e); setConfirm(null); },
	});

	const busy = plan.isPending || apply.isPending;
	/** Проверка без исправления ничего не меняет — её запускают сразу, без подтверждения. */
	const runCheck = () => (check.repair ? plan.mutate("check") : apply.mutate("check"));

	return (
		<div className={main.FormContainer}>
			<CapabilityGuard capability="ib.admin" />
			<div className={main.FormWrapper}>
				<GroupCol className={main.Form}>
					<FormArea title={translate("onecMaintCheck")}>
						<GroupCol>
							<GroupRow>
								<FieldToggle name="mnt_reindex" label={translate("onecMaintReindex")} value={check.reindex}
									disabled={busy} onChange={(v) => setCheck((c) => ({ ...c, reindex: v }))} />
								<FieldToggle name="mnt_logical" label={translate("onecMaintLogical")} value={check.logicalIntegrity}
									disabled={busy} onChange={(v) => setCheck((c) => ({ ...c, logicalIntegrity: v }))} />
								<FieldToggle name="mnt_totals" label={translate("onecMaintTotals")} value={check.recalcTotals}
									disabled={busy} onChange={(v) => setCheck((c) => ({ ...c, recalcTotals: v }))} />
							</GroupRow>
							<GroupRow>
								{/* Исправление — отдельный флаг и отдельное подтверждение: оно меняет данные. */}
								<FieldToggle name="mnt_repair" label={translate("onecMaintRepair")} value={check.repair}
									disabled={busy} onChange={(v) => setCheck((c) => ({ ...c, repair: v }))} />
								<Button variant="primary" disabled={busy} title={translate("onecMaintCheck")} onClick={runCheck}>
									<Icon name="recalc" /> {translate("onecMaintCheck")}
								</Button>
							</GroupRow>
						</GroupCol>
					</FormArea>

					<FormArea title={translate("onecBackup")}>
						<GroupRow>
							<Field name="mnt_dir" label={translate("onecBackupDir")} value={backupDir} noAutofill width={FIELD_WIDTH.lg}
								disabled={busy} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBackupDir(e.target.value)} />
							<Button variant="secondary" disabled={busy} title={translate("onecBackup")}
								onClick={() => apply.mutate("backup")}>
								<Icon name="download" /> {translate("onecBackup")}
							</Button>
						</GroupRow>
					</FormArea>

					<FormArea title={translate("onecMaintRestore")}>
						<GroupCol>
							<GroupRow>
								<Field name="mnt_path" label={translate("onecMaintFileDt")} value={restorePath} noAutofill width={FIELD_WIDTH.lg}
									disabled={busy} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRestorePath(e.target.value)} />
								<FieldToggle name="mnt_lock" label={translate("onecMaintLockSessions")} value={restoreLock}
									disabled={busy} onChange={setRestoreLock} />
							</GroupRow>
							<GroupRow>
								<Button variant="danger" disabled={busy || !restorePath.trim()}
									title={restorePath.trim() ? translate("onecMaintRestore") : translate("onecMaintNeedFile")}
									onClick={() => plan.mutate("restore")}>
									<Icon name="restore" /> {translate("onecMaintRestore")}
								</Button>
							</GroupRow>
						</GroupCol>
					</FormArea>

					<FormArea title={translate("onecMaintUpdate")}>
						<GroupCol>
							<GroupRow>
								<Field name="mnt_cfu" label={translate("onecMaintFileCfu")} value={updatePath} noAutofill width={FIELD_WIDTH.lg}
									disabled={busy} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUpdatePath(e.target.value)} />
								<FieldToggle name="mnt_backup" label={translate("onecMaintBackupFirst")} value={updateBackup}
									disabled={busy} onChange={setUpdateBackup} />
								<FieldToggle name="mnt_ulock" label={translate("onecMaintLockSessions")} value={updateLock}
									disabled={busy} onChange={setUpdateLock} />
							</GroupRow>
							<GroupRow>
								<Button variant="danger" disabled={busy || !updatePath.trim()}
									title={updatePath.trim() ? translate("onecMaintUpdate") : translate("onecMaintNeedFile")}
									onClick={() => plan.mutate("update")}>
									<Icon name="editInline" /> {translate("onecMaintUpdate")}
								</Button>
							</GroupRow>
						</GroupCol>
					</FormArea>
				</GroupCol>

				<GroupCol className={main.FormNotice}>
					<Notice items={[
						{ type: "info", text: translate("onecMaintHint") },
						...(updateBackup ? [] : [{ type: "warning" as const, text: translate("onecMaintNoBackupWarning") }]),
						...(report ? [{ type: "info" as const, text: report }] : []),
					]} />
				</GroupCol>
			</div>

			{confirm && (
				<Modal title={translate("onecMaintConfirmTitle")} onClose={() => setConfirm(null)}
					onApply={() => apply.mutate(confirm.job)}>
					<div className={styles.ConfirmText}>
						<div className={styles.ConfirmDetails}>{translate("onecBase")}: {baseKey}</div>
						{/* Текст плана — от агента: он точнее нашего пересказа. */}
						<Notice inline items={[{ type: "attention", text: confirm.plan }]} />
					</div>
				</Modal>
			)}
		</div>
	);
};

export default BaseMaintenance;
