/**
 * Организации заявки на подключение базы, которых нет в ERP, — с кнопкой «Создать организацию» (26.09).
 *
 * Одобрить заявку без организации ERP нельзя: на неё выпускается токен базы, ей принадлежат диалоги чата в 1С,
 * задачи и находки проверок учёта. Раньше, если базу подключал новый клиент, администратор BuhProf уходил в
 * справочник организаций и переписывал реквизиты с экрана 1С. Теперь 1С присылает реквизиты в заявке, и организация
 * создаётся здесь одной кнопкой — вместе с адресами, телефонами, руководителем и банковскими счетами (ERP,
 * `POST /organizations/from-onec`). Созданная сразу подставляется в поле «Организация ERP».
 *
 * Реквизиты видны ДО нажатия: они пришли из анонимной заявки, и записываться вслепую не должны. Заявка старого
 * расширения реквизитов не несёт — тогда создаётся организация с наименованием и БИН, остальное дописывают в карточке.
 */
import { FC, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { translate } from "src/i18";
import { Button } from "src/components/Button";
import { showToast } from "src/components/UIToast";
import { reportError } from "src/services/errors/route";
import type { BaseRegistration, RegistrationOrganization } from "src/services/onec/api";
import { createOrganizationFromOnec } from "src/services/onec/orgFromOnec";
import { missingOrganizations, orgDetailsLines } from "./requestsView";
import styles from "./OneCAdmin.module.scss";

type Props = {
	reg: BaseRegistration;
	/** Организация создана (или нашлась уже созданной) — подставить её в поле. */
	onCreated: (organizationUuid: string) => void;
	disabled?: boolean;
};

export const MissingOrganizations: FC<Props> = ({ reg, onCreated, disabled }) => {
	const qc = useQueryClient();
	// Заявка в окне — снимок на момент открытия, поэтому созданные запоминаются здесь: иначе кнопка оставалась бы
	// у организации, которая уже есть.
	const [created, setCreated] = useState<string[]>([]);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["onec", "erp-organizations"] });
		void qc.invalidateQueries({ queryKey: ["onec", "registrations"] });
	};
	const settle = (bin: string, uuid: string) => {
		setCreated((prev) => [...prev, bin]);
		refresh();
		onCreated(uuid);
	};

	const create = useMutation({
		mutationFn: (m: { bin: string; org: RegistrationOrganization }) =>
			createOrganizationFromOnec({ bin: m.bin, name: m.org.name ?? null, details: m.org.details ?? null }),
		onSuccess: (d, m) => {
			showToast(`${translate("onecReqOrgCreated")}: ${d.item.name ?? m.bin}`, "success");
			settle(m.bin, d.item.uuid);
		},
		onError: (e, m) => {
			// Организацию успели завести (другой администратор, вторая вкладка) — берём её, а не показываем отказ.
			const existing = isAxiosError(e) && e.response?.status === 409 ? (e.response.data as { item?: { uuid?: string } } | undefined)?.item?.uuid : null;
			if (existing) settle(m.bin, existing);
			reportError(e, { source: translate("onecReqRegistrations") });
		},
	});

	const missing = missingOrganizations(reg).filter((m) => !m.bin || !created.includes(m.bin));
	if (!missing.length) return null;

	return (
		<>
			{missing.map(({ org, bin }) => {
				const lines = orgDetailsLines(org.details);
				return (
					<div key={`${org.id ?? ""}:${org.bin ?? ""}:${org.name ?? ""}`} className={styles.ModalChanges}>
						<div className={styles.ModalChangesTitle}>
							{org.name || "—"}{org.bin ? ` (${org.bin})` : ""} — {translate("onecReqOrgMissing")}
						</div>
						{!bin ? <div>{translate("onecReqOrgNoBin")}</div>
							: lines.length ? lines.map((l) => <div key={l.label}>{l.label}: {l.value}</div>)
								: <div className={styles.ConfirmDetails}>{translate("onecReqOrgNoDetails")}</div>}
						{bin && (
							<div>
								<Button disabled={disabled || create.isPending} onClick={() => create.mutate({ bin, org })}>
									{translate("onecReqOrgCreate")}
								</Button>
							</div>
						)}
					</div>
				);
			})}
		</>
	);
};

export default MissingOrganizations;
