// Кнопка «Заполнить из eGov» для форм Организации/Контрагента. По БИН тянет
// регистрационные данные ЮЛ из Открытых данных eGov. Для сохранённой записи
// пишет name/legalName + юр.адрес (Контакты) + руководителя (Контактные лица)
// на сервере и перезагружает форму; для новой — заполняет наименование в форме.
import { FC, useState, useCallback } from "react";
import { translate } from "src/i18";
import { showToast } from "src/components/UIToast";
import { fetchEgovLegalEntity, applyEgov } from "src/services/egov/api";
import styles from "src/components/Toolbar/Toolbar.module.scss";

interface Props {
	ownerType: "organization" | "counterparty";
	bin: string | undefined;
	uuid: string | undefined;
	disabled?: boolean;
	/** Заполнить поля наименования (для несохранённой записи). */
	onFillName: (name: string) => void;
	/** Перезагрузить форму после серверной записи (для сохранённой). */
	onReload?: () => void;
}

const EgovFillButton: FC<Props> = ({ ownerType, bin, uuid, disabled, onFillName, onReload }) => {
	const [busy, setBusy] = useState(false);
	const valid = !!bin && /^\d{12}$/.test(bin);

	const run = useCallback(async () => {
		if (!valid || !bin) { showToast(translate("egovNeedBin"), "error"); return; }
		setBusy(true);
		try {
			if (uuid) {
				const { data, applied } = await applyEgov(ownerType, uuid, bin);
				const parts = [applied.name && translate("name"), applied.address && translate("address"), applied.director && translate("egovDirector")].filter(Boolean);
				showToast(`${translate("egovFilled")}: ${parts.join(", ") || "—"}${data.status ? ` · ${data.status}` : ""}`, "success", 6000);
				onReload?.();
			} else {
				const { data } = await fetchEgovLegalEntity(bin);
				if (data.name) onFillName(data.name);
				showToast(`${translate("egovFetched")}${data.status ? ` · ${data.status}` : ""}. ${translate("egovSaveForContacts")}`, "success", 6000);
			}
		} catch (e) {
			const a = e as { response?: { data?: { message?: string } }; message?: string };
			showToast(a?.response?.data?.message || a?.message || "eGov", "error", 6000);
		} finally { setBusy(false); }
	}, [valid, bin, uuid, ownerType, onFillName, onReload]);

	return (
		<button type="button" className={styles.ActionsButton} disabled={busy || disabled || !valid}
			title={translate("egovFillHint")} onClick={() => void run()}>
			{busy ? "…" : `⭳ ${translate("egovFill")}`}
		</button>
	);
};

export default EgovFillButton;
