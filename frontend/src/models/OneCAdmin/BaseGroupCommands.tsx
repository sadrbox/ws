/**
 * Групповые команды по отмеченным базам — командная панель списка «Базы».
 *
 * ЗАЧЕМ ЗДЕСЬ. Базы выбирают в списке баз. Раньше групповые операции жили на вкладках
 * «Расширения» и «Пользователи» и требовали сначала уйти туда, а потом заново искать
 * нужные базы во второй таблице. Здесь набор отмеченных строк уже есть — команды
 * применяются к нему.
 *
 * ПРИМЕНИМОСТЬ ПРОВЕРЯЕТСЯ ДО ОТПРАВКИ. Команда, посланная в пропавшую или отключённую
 * базу, возвращается ошибкой по каждой такой базе, и отчёт задания из ста строк приходится
 * читать целиком, чтобы понять: половина целей была заведомо непригодна. Поэтому окно
 * подтверждения показывает, сколько баз пригодно и почему остальные пропущены, а команда
 * уходит только в пригодные.
 *
 * ПУБЛИКАЦИЯ ОПЕРАЦИЯМ НЕ НУЖНА. Пользователи и расширения идут через COM-соединение с
 * сервером 1С — веб-публикация в этом не участвует вовсе. Она нужна только каналу HTTP
 * (расширение buhprof_api бизнес-агента). Поэтому неопубликованная база остаётся полноценной
 * целью для создания пользователя и установки расширения, и отбирать её здесь было бы
 * ошибкой: администратор не смог бы подготовить базу, которую как раз собирается публиковать.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import Modal from "src/components/Modal";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { showToast } from "src/components/UIToast";
import type { TDataItem } from "src/components/Table/types";
import { asText } from "src/utils/asText";
import { refreshPublications, runBatch, type BatchType } from "src/services/onec/api";
import { isApplicable, type OnecOperation } from "./shared";
import styles from "./OneCAdmin.module.scss";

/** Что именно делаем: у каждой команды свои поля и своя применимость. */
type Op =
	| "publish" | "unpublish"
	| "createUser" | "deleteUser"
	| "installExt" | "deleteExt"
	| "backup";

type OpSpec = {
	type: BatchType;
	title: string;
	warning: string;
	/** Применимость: какой канал нужен операции. */
	needs: OnecOperation;
	/** Нужно ли имя (пользователя или расширения). */
	needsName?: "user" | "extension";
	needsFile?: boolean;
	/** Каталог назначения — необязательный: без него агент берёт свой из настроек. */
	needsDir?: boolean;
};

const SPECS: Record<Op, OpSpec> = {
	publish: { type: "IB_PUBLISH", title: "onecPublish", warning: "onecPublishWarning", needs: "publish" },
	unpublish: { type: "IB_UNPUBLISH", title: "onecUnpublish", warning: "onecUnpublishWarning", needs: "unpublish" },
	createUser: { type: "IB_CREATE_USER", title: "onecUserCreate", warning: "onecUserCreateWarning", needs: "ib", needsName: "user" },
	deleteUser: { type: "IB_DELETE_USER", title: "onecUserDelete", warning: "onecUserDeleteWarning", needs: "ib", needsName: "user" },
	installExt: { type: "IB_INSTALL_EXTENSION", title: "onecExtInstall", warning: "onecExtInstallWarning", needs: "ib", needsName: "extension", needsFile: true },
	deleteExt: { type: "IB_DELETE_EXTENSION", title: "onecExtRemove", warning: "onecExtRemoveWarning", needs: "ib", needsName: "extension" },
	backup: { type: "IB_BACKUP", title: "onecBackup", warning: "onecBackupWarning", needs: "ib", needsDir: true },
};

/** Строка списка баз ERP-прокси в терминах применимости. */
type BaseRow = { key: string; status: string; disabled: boolean; published: boolean | null };

const toBase = (r: TDataItem): BaseRow => ({
	key: asText(r.baseKey),
	status: asText(r.status),
	disabled: r.disabled === true,
	published: typeof r.published === "boolean" ? r.published : null,
});

/**
 * Почему база не годится — по-русски и по делу; на этом основан отчёт «пропущено».
 *
 * ЗДЕСЬ ТОЛЬКО НЕВОЗМОЖНОЕ. Состояние публикации из реестра целью НЕ отбирает: оно
 * кэшированное и отстаёт от жизни. Публикацию сняли мимо панели — реестр по-прежнему
 * считает базу опубликованной, и «уже опубликована» превращалось в тупик: повторная
 * публикация, которой и лечится расхождение, оказывалась запрещена. Обе команды
 * идемпотентны (это в контракте), поэтому лишний запуск безвреден, а запрет — вреден.
 */
const skipReason = (b: BaseRow, _needs: OnecOperation): string | null => {
	if (b.disabled) return translate("onecBaseDisabled");
	if (b.status === "MISSING") return translate("onecBaseMissing");
	return null;
};

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const reader = new FileReader();
	reader.onerror = () => reject(new Error(translate("onecExtFileRequired")));
	reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
	reader.readAsDataURL(file);
});

export const BaseGroupCommands: FC<{
	selected: TDataItem[];
	/** Запущенное задание открывают сразу: групповая операция не должна уходить «в никуда». */
	onBatchStarted?: (batchId: string) => void;
}> = ({ selected, onBatchStarted }) => {
	const qc = useQueryClient();
	const [op, setOp] = useState<Op | null>(null);
	const [name, setName] = useState("");
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);
	const [dir, setDir] = useState("");

	const spec = op ? SPECS[op] : null;

	// Разбор целей на пригодные и пропущенные — до отправки, а не по отчёту задания.
	const { targets, skipped, note } = useMemo(() => {
		if (!spec) return { targets: [] as string[], skipped: [] as { key: string; reason: string }[], note: "" };
		const rows = selected.map(toBase);
		// Состояние публикации не отбирает цели, но сказать о нём стоит: «из десяти баз
		// восемь уже опубликованы» меняет ожидания, не мешая нажать.
		const already = spec.needs === "publish"
			? rows.filter((b) => b.published === true).length
			: spec.needs === "unpublish"
				? rows.filter((b) => b.published === false).length
				: 0;
		return {
			targets: rows.filter((b) => isApplicable(b, spec.needs) && !skipReason(b, spec.needs)).map((b) => b.key),
			skipped: rows.map((b) => ({ key: b.key, reason: skipReason(b, spec.needs) ?? "" }))
				.filter((x) => x.reason),
			note: already
				? `${spec.needs === "publish" ? translate("onecPublished") : translate("onecNotPublished")}: ${already}`
				: "",
		};
	}, [selected, spec]);

	const close = () => { setOp(null); setName(""); setFullName(""); setPassword(""); setFile(null); };

	const batch = useMutation({
		mutationFn: async () => {
			if (!spec) throw new Error(translate("unknownError"));
			const payload: Record<string, unknown> =
				spec.type === "IB_CREATE_USER"
					? { name: name.trim(), ...(fullName.trim() ? { fullName: fullName.trim() } : {}), ...(password ? { password } : {}) }
					: spec.type === "IB_INSTALL_EXTENSION"
						? { name: name.trim(), safeMode, contentBase64: file ? await toBase64(file) : "" }
						: spec.needsDir
							? (dir.trim() ? { dir: dir.trim() } : {})
							: spec.needsName ? { name: name.trim() } : {};
			return runBatch(spec.type, targets, payload);
		},
		onSuccess: (d) => {
			const tail = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${tail}`, d.skipped.length ? "warning" : "success");
			// Публикация меняет состояние базы в реестре — список обновляем сразу.
			void qc.invalidateQueries({ queryKey: ["onec", "bases"] });
			onBatchStarted?.(d.batchId);
			close();
		},
		onError: (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const apply = () => {
		if (!spec || !targets.length) return;
		if (spec.needsName && !name.trim()) return;
		if (spec.needsFile && !file) { showToast(translate("onecExtFileRequired"), "error"); return; }
		batch.mutate();
	};

	// Чтение публикаций: одна команда на весь веб-сервер, отметки строк ей не нужны —
	// поэтому кнопка активна всегда, в отличие от групповых операций.
	const checkPublications = useMutation({
		mutationFn: refreshPublications,
		onSuccess: (d) => {
			qc.setQueryData(["onec", "bases"], { items: d.items });
			void qc.invalidateQueries({ queryKey: ["onec-bases"] });
			showToast(`${translate("onecPublicationsChecked")}: ${d.found}`, "success");
		},
		onError: (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const btn = (o: Op, label: string) => (
		<Button variant="secondary" disabled={!selected.length} onClick={() => { setName(""); setOp(o); }}>
			{translate(label)}
		</Button>
	);

	return (
		<>
			<Button variant="secondary" disabled={checkPublications.isPending} onClick={() => checkPublications.mutate()}>
				{translate("onecPublicationsCheck")}
			</Button>
			{btn("publish", "onecPublish")}
			{btn("unpublish", "onecUnpublish")}
			{btn("createUser", "onecUserCreate")}
			{btn("deleteUser", "onecUserDelete")}
			{btn("installExt", "onecExtInstall")}
			{btn("deleteExt", "onecExtRemove")}
			{btn("backup", "onecBackup")}

			{spec && (
				<Modal title={translate(spec.title)} onClose={close} onApply={apply}>
					<div className={styles.ModalForm}>
						<div>{translate("onecBatchTargets")}: {targets.length} / {selected.length}</div>
						{note && (
							// Не отказ, а состояние по данным реестра: они могли устареть,
							// поэтому это подпись, а не запрет.
							<div className={styles.Hint}>{note}</div>
						)}
						{skipped.length > 0 && (
							// Пропущенные называем поимённо: «применимо 40 из 100» без причин
							// выглядит как потеря половины выбора.
							<div className={styles.Hint}>
								{translate("onecSkippedBases")}: {skipped.map((s) => `${s.key} (${s.reason})`).join(", ")}
							</div>
						)}
						{spec.needsName && (
							<Field
								name="onec_group_name"
								label={translate(spec.needsName === "user" ? "onecUserName" : "onecExtName")}
								value={name}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
							/>
						)}
						{spec.type === "IB_CREATE_USER" && (
							<>
								<Field name="onec_group_full" autoComplete="off" label={translate("onecUserFullName")} value={fullName}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)} />
								<Field name="onec_group_pwd" autoComplete="new-password" label={translate("onecUserPassword")} type="password" value={password}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
							</>
						)}
						{spec.needsDir && (
							// Каталог необязателен: раскладку дисков сервера 1С знает агент,
							// панель лишь позволяет отправить выгрузку в другое место.
							<Field name="onec_group_dir" label={translate("onecBackupDir")} value={dir}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDir(e.target.value)} />
						)}
						{spec.needsFile && (
							<>
								<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
								<FieldToggle name="onec_group_safe" label={translate("onecExtSafeMode")}
									value={safeMode} onChange={setSafeMode} />
							</>
						)}
						<div className={styles.ConfirmWarning}>{translate(spec.warning)}</div>
					</div>
				</Modal>
			)}
		</>
	);
};

export default BaseGroupCommands;
