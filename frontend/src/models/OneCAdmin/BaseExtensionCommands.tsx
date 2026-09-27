/**
 * Команды над расширениями ОДНОЙ базы — из командной панели таблицы «Расширения» в карточке базы (27.09):
 * «Загрузить расширение *.cfe» и «Выгрузить расширение в .cfe».
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ГРУППОВЫХ. Групповая форма «Установить расширение» — про раскатку одного файла на много
 * отмеченных баз из списка. Здесь наоборот: открыли карточку базы и ставите или забираете расширение ИМЕННО
 * в неё — без похода в список, отметки одной строки и мастера на три шага.
 *
 * ЗАГРУЗКА — тем же заданием, что и групповая (runBatch по одной базе): сервис перед установкой закрывает
 * базу (запрет заданий → вход → сеансы, exclusiveOps), поэтому и здесь об этом предупреждаем до нажатия.
 * Имя расширения — идентификатор конфигуратора; по умолчанию берётся из имени файла без «.cfe».
 *
 * ВЫГРУЗКА — команда чтения `IB_EXPORT_EXTENSION`: агент входит в базу и отдаёт файл в ответе; панель
 * скачивает его как `<имя>.cfe`. Сборка агента без этой команды — отказ сразу, до постановки.
 */
import { FC, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { translate } from "src/i18";
import Modal from "src/components/Modal";
import Notice from "src/components/Notice";
import { Field, FieldFile, FieldSelect } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import { exportExtension, runBatch, type BatchStart, type IbExtension } from "src/services/onec/api";
import { attachBatch, finishOp, startOp } from "./progress";
import { reportBatchStart, useOnecErrorActions, useOnecPermissions } from "./shared";
import { nothingQueued } from "./batchStart";
import { sectionAllows } from "./onecPermissions";
import styles from "./OneCAdmin.module.scss";

/** Имя расширения из имени файла: «buhprof_api.cfe» → «buhprof_api»; в идентификатор входят только буквы, цифры и «_». */
export const extensionNameFromFile = (fileName: string): string =>
	fileName.replace(/\.cfe$/i, "").replace(/[^A-Za-zА-Яа-яЁё0-9_]/g, "_").replace(/^[^A-Za-zА-Яа-яЁё]+/, "");

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const r = new FileReader();
	r.onload = () => resolve((typeof r.result === "string" ? r.result : "").split(",")[1] ?? "");
	r.onerror = () => reject(r.error ?? new Error("файл не прочитан"));
	r.readAsDataURL(file);
});

/** Отдать файл на скачивание: base64 из ответа агента → Blob → ссылка. */
export function downloadBase64(base64: string, fileName: string): void {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
	const a = document.createElement("a");
	a.href = url; a.download = fileName;
	document.body.appendChild(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const BaseExtensionCommands: FC<{
	baseKey: string;
	/** Расширение, выбранное в таблице, — цель «Выгрузить» по умолчанию. */
	activeExt: string;
	/** Расширения базы из реестра — варианты для выгрузки. */
	extensions: Pick<IbExtension, "name" | "synonym">[];
	onDone?: () => void;
}> = ({ baseKey, activeExt, extensions, onDone }) => {
	const perms = useOnecPermissions();
	const canInstall = sectionAllows(perms, "extensions", "create", 1);
	const [dialog, setDialog] = useState<null | "upload" | "export">(null);
	const [file, setFile] = useState<File | null>(null);
	const [name, setName] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [exportName, setExportName] = useState("");

	const close = () => { setDialog(null); setFile(null); setName(""); setSafeMode(true); };
	const actionsFor = useOnecErrorActions();

	const upload = useMutation({
		mutationFn: async (): Promise<BatchStart> => {
			if (!file) throw new Error(translate("onecExtPickFile"));
			const op = startOp({ kind: "create", title: translate("onecExtInstall"), target: `${name.trim()} — ${baseKey}`, total: 1 });
			try {
				const r = await runBatch("IB_INSTALL_EXTENSION", [baseKey], { name: name.trim(), safeMode, contentBase64: await toBase64(file) });
				attachBatch(op, r.batchId, r.total, r.skipped.length ? `${translate("onecSkipped")}: ${r.skipped.length}` : "");
				return r;
			} catch (e) {
				finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e), error: e });
				throw e;
			}
		},
		onSuccess: (r) => {
			// «queued: 0» (агент не на связи) — не зелёный успех: причина словами, окно с файлом остаётся (И26).
			reportBatchStart(r, translate("onecExtension"));
			if (nothingQueued(r)) return;
			onDone?.();
			close();
		},
		onError: (e): void => reportError(e, { source: translate("onecExtension"), actions: actionsFor(e, { baseKey, retry: () => { upload.mutate(); } }) }),
	});

	const download = useMutation({
		mutationFn: async () => {
			const target = exportName || activeExt;
			const op = startOp({ kind: "read", title: translate("onecExtDownload"), target: `${target} — ${baseKey}`, total: 1 });
			try {
				const r = await exportExtension(baseKey, target);
				if (!r?.contentBase64) throw new Error(translate("onecExtNoneToExport"));
				downloadBase64(r.contentBase64, r.fileName || `${r.name || target}.cfe`);
				finishOp(op, {});
				return target;
			} catch (e) {
				finishOp(op, { failed: 1, note: e instanceof Error ? e.message : String(e), error: e });
				throw e;
			}
		},
		onSuccess: (target) => { showToast(`${translate("onecExtExported")}: ${target}`, "success"); close(); },
		onError: (e): void => reportError(e, { source: translate("onecExtension"), actions: actionsFor(e, { baseKey, retry: () => { download.mutate(); } }) }),
	});

	const busy = upload.isPending || download.isPending;
	const options = [
		...(canInstall ? [{ id: "upload", label: translate("onecExtUpload"), icon: "plus" as const }] : []),
		{ id: "export", label: translate("onecExtDownload"), icon: "download" as const,
			disabled: !extensions.length, hint: extensions.length ? undefined : translate("onecExtNoneToExport") },
	];

	return (
		<>
			<ActionsDropdownButton label={translate("onecExtActions")} icon="settings" options={options} disabled={!baseKey || busy}
				title={baseKey ? undefined : translate("onecPickBaseFirst")}
				onSelect={(id) => {
					if (id === "upload") setDialog("upload");
					else if (id === "export") { setExportName(activeExt || extensions[0]?.name || ""); setDialog("export"); }
				}} />

			{dialog === "upload" && (
				<Modal title={`${translate("onecExtInstall")}: ${baseKey}`} onClose={close}
					applyDisabled={!file || !name.trim() || busy}
					onApply={() => { if (file && name.trim()) upload.mutate(); }}>
					<div className={styles.ModalForm}>
						<FieldFile name="bec_file" label={translate("onecExtFile")} accept=".cfe" disabled={busy}
							onSelect={(f) => { setFile(f); if (f && !name.trim()) setName(extensionNameFromFile(f.name)); }} />
						<Field name="bec_name" label={translate("onecExtName")} value={name} noAutofill hint={translate("onecExtNameHint")}
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
						<FieldToggle name="bec_safe" label={translate("onecExtSafeMode")} value={safeMode} onChange={setSafeMode} />
						<Notice inline items={[{ type: "warning", text: translate("onecExtUploadHere") }]} />
					</div>
				</Modal>
			)}

			{dialog === "export" && (
				<Modal title={`${translate("onecExtDownload")}: ${baseKey}`} onClose={close}
					applyDisabled={!exportName || busy}
					onApply={() => { if (exportName) download.mutate(); }}>
					<div className={styles.ModalForm}>
						<FieldSelect name="bec_export" label={translate("onecExtExportPick")} value={exportName}
							options={extensions.map((x) => ({ value: x.name, label: x.synonym ? `${x.name} — ${x.synonym}` : x.name }))}
							onChange={(e) => setExportName(e.target.value)} />
						<Notice inline items={[{ type: "info", text: translate("onecExtExportHere") }]} />
					</div>
				</Modal>
			)}
		</>
	);
};

export default BaseExtensionCommands;
