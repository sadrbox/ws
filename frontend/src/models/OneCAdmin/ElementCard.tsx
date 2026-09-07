/**
 * Карточка элемента, который живёт СРАЗУ ВО МНОГИХ БАЗАХ: расширение или пользователь ИБ.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ФОРМА. Раньше групповая установка выглядела так: отметь базы в таблице,
 * нажми «Установить», введи имя в модалке. Реквизиты элемента и его распространение по базам
 * были разорваны, а увидеть «где это уже есть» в момент установки было нельзя вовсе — и
 * расширение ставили второй раз туда, где оно стояло.
 *
 * Здесь элемент — главный: сверху его реквизиты, ниже таблица баз с отметкой «уже есть».
 * Отмечаешь базы, применяешь — команда уходит именно в них.
 *
 * ПРИМЕНИМОСТЬ. В таблице только базы, к которым операция применима (живые в кластере);
 * остальные скрыты с возможностью показать — см. `isApplicable`. Это убирает основную массу
 * ошибок «база не найдена в кластере», которые раньше выяснялись уже в отчёте задания.
 */
import { FC, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import Modal from "src/components/Modal";
import Table from "src/components/Table";
import { Button } from "src/components/Button";
import { Field } from "src/components/Field";
import FieldToggle from "src/components/Field/FieldToggle";
import { GroupCol, GroupRow } from "src/components/UI";
import { showToast } from "src/components/UIToast";
import { getModelColumns } from "src/components/Table/services";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { buildStaticTableProps } from "src/utils/staticTableProps";
import { useStaticTableView } from "src/hooks/useStaticTableView";
import { fetchBases, runBatch, type BatchType } from "src/services/onec/api";
import { isApplicable, publishLabel } from "./shared";
import styles from "./OneCAdmin.module.scss";

export type ElementKind = "user" | "extension";

const cardColumns = (): TColumn[] => ([
	{ identifier: "baseKey", type: "string", width: "220px", minWidth: "130px", alignment: "left", visible: true, inlist: true },
	{ identifier: "name", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "presence", type: "string", width: "150px", minWidth: "100px", alignment: "left", visible: true, inlist: true },
	{ identifier: "published", type: "string", width: "140px", minWidth: "90px", alignment: "left", visible: true, inlist: true },
] as unknown as TColumn[]);

/** Файл расширения → base64 для передачи агенту (тот же способ, что во вкладке «Расширения»). */
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
	const reader = new FileReader();
	reader.onerror = () => reject(new Error(translate("onecExtFileRequired")));
	// readAsDataURL всегда даёт строку; проверка нужна типам, а не жизни.
	reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
	reader.readAsDataURL(file);
});

export const ElementCard: FC<{
	kind: ElementKind;
	/** Имя элемента; пусто — заводим новый. */
	initialName?: string;
	initialSynonym?: string;
	/** Ключи баз, где элемент уже есть (по кэшу сводки). */
	presentIn?: string[];
	onClose: () => void;
	onBatchStarted: (batchId: string) => void;
}> = ({ kind, initialName = "", initialSynonym = "", presentIn = [], onClose, onBatchStarted }) => {
	const bases = useQuery({ queryKey: ["onec", "bases"], queryFn: fetchBases });
	const [cols, setCols] = useState<TColumn[]>(() => getModelColumns(cardColumns(), `OneCAdmin_card_${kind}`));
	const [showAll, setShowAll] = useState(false);
	const [picked, setPicked] = useState<string[]>([]);

	const [name, setName] = useState(initialName);
	const [fullName, setFullName] = useState("");
	const [password, setPassword] = useState("");
	const [safeMode, setSafeMode] = useState(true);
	const [file, setFile] = useState<File | null>(null);

	const present = useMemo(() => new Set(presentIn.map((k) => k.toLowerCase())), [presentIn]);

	const rowsRaw = useMemo(() => (bases.data?.items ?? [])
		.filter((b) => showAll || isApplicable(b, "ib"))
		.map((b, i) => ({
			id: i + 1, uuid: b.key, baseKey: b.key, name: b.name || "—",
			presence: present.has(b.key.toLowerCase()) ? translate("onecPresent") : translate("onecAbsent"),
			published: publishLabel(b.published),
		})), [bases.data, showAll, present]);
	const view = useStaticTableView(rowsRaw, { presence: "asc", baseKey: "asc" });
	const hidden = (bases.data?.items ?? []).length - rowsRaw.length;

	const batch = useMutation({
		mutationFn: async () => {
			const type: BatchType = kind === "user" ? "IB_CREATE_USER" : "IB_INSTALL_EXTENSION";
			const payload = kind === "user"
				? { name: name.trim(), ...(fullName.trim() ? { fullName: fullName.trim() } : {}), ...(password ? { password } : {}) }
				: { name: name.trim(), safeMode, contentBase64: file ? await toBase64(file) : "" };
			return runBatch(type, picked, payload);
		},
		onSuccess: (d) => {
			const skipped = d.skipped.length ? ` ${translate("onecBatchSkipped")}: ${d.skipped.length}` : "";
			showToast(`${translate("onecBatchQueued")}: ${d.queued}/${d.total}.${skipped}`, d.skipped.length ? "warning" : "success");
			onBatchStarted(d.batchId);
			onClose();
		},
		onError: (e: unknown) => showToast(e instanceof Error ? e.message : String(e), "error"),
	});

	const apply = () => {
		if (!name.trim() || !picked.length) return;
		// Файл обязателен: установка расширения без содержимого — команда без предмета.
		if (kind === "extension" && !file) { showToast(translate("onecExtFileRequired"), "error"); return; }
		batch.mutate();
	};

	return (
		<Modal
			title={kind === "user" ? translate("onecUserCard") : translate("onecExtCard")}
			onClose={onClose}
			onApply={apply}
		>
			<div className={styles.CardForm}>
				<GroupCol>
					<GroupRow>
						<Field name="card_name" label={kind === "user" ? translate("onecUserName") : translate("onecExtName")}
							value={name} width="240px"
							onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
						{kind === "user" ? (
							<Field name="card_full" autoComplete="off" label={translate("onecUserFullName")} value={fullName} width="260px"
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)} />
						) : (
							<Field name="card_syn" label={translate("onecExtSynonym")} value={initialSynonym || "—"} disabled
								width="260px" onChange={() => {}} />
						)}
					</GroupRow>
					<GroupRow>
						{kind === "user" ? (
							<Field name="card_pwd" autoComplete="new-password" label={translate("onecUserPassword")} type="password" value={password}
								width="240px"
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} />
						) : (
							<>
								<input type="file" accept=".cfe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
								<FieldToggle name="card_safe" label={translate("onecExtSafeMode")} value={safeMode} onChange={setSafeMode} />
							</>
						)}
					</GroupRow>
				</GroupCol>

				<Table {...buildStaticTableProps({
					componentName: `OneCAdmin_card_${kind}`, rows: view.rows, columns: cols, setColumns: setCols,
					sorting: view.sorting, search: view.search,
					isLoading: bases.isLoading,
					onReload: () => void bases.refetch(),
					selectable: true,
					onSelectionChange: (sel: Set<number>, all: TDataItem[]) =>
						setPicked(all.filter((r) => sel.has(Number(r.id))).map((r) => String(r.baseKey))),
					extraButtons: (hidden > 0 || showAll) ? (
						<Button variant="secondary" active={showAll} onClick={() => setShowAll((v) => !v)}>
							{translate("onecShowInapplicable")}{hidden > 0 && !showAll ? ` (${hidden})` : ""}
						</Button>
					) : undefined,
				})} />

				<div className={styles.ConfirmWarning}>
					{translate("onecBatchTargets")}: {picked.length}.{" "}
					{kind === "user" ? translate("onecUserCreateWarning") : translate("onecExtInstallWarning")}
				</div>
			</div>
		</Modal>
	);
};

export default ElementCard;
