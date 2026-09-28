/**
 * Карточка строки табличной части «Организации базы 1С» (28.09): банковский счёт, договор, контактное лицо или
 * контакт — все реквизиты 1С полями и поле-ссылка на объект ERP. Открывается двойным щелчком (или Enter) по строке
 * вложенной таблицы — как форма строки у SubTable.
 *
 * ОДНА КАРТОЧКА НА ЧЕТЫРЕ ВКЛАДКИ. Реквизиты строки у всех разные, но показываются одинаково — «подпись: значение 1С»,
 * — поэтому строка приносит их списком (OrgPartCardData.fields), а не каждая вкладка рисует свою форму.
 *
 * ЧТЕНИЕ, А НЕ ПРАВКА. Реквизиты правит 1С. Поле-ссылка открывается со значением из таблицы; выбор и «Создать» в нём
 * действуют в этой карточке — связь с ERP панель не хранит (см. IbOrganizationForm).
 */
import { FC, useCallback, useId, useState } from "react";
import { translate } from "src/i18";
import { useAppActions } from "src/app/context";
import ModelForm from "src/components/ModelForm";
import { FormArea, GroupCol, GroupRow } from "src/components/UI";
import { Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import main from "src/styles/main.module.scss";
import type { TPane } from "src/app/types";
import type { ErpRef, OrgPartCardData } from "./ibOrganizationFormView";

/** Значение 1С полем «только показ»: пустое — «—», а не пустая рамка («не нарисовалось»). */
export const OnecField: FC<{ name: string; label: string; value: string | null | undefined; width?: string }> = ({ name, label, value, width }) => (
	<Field name={name} label={label} value={value?.trim() || "—"} width={width ?? FIELD_WIDTH.wide} disabled onChange={() => { }} />
);

export const IbOrgPartCard: FC<Partial<TPane>> = (paneProps) => {
	const data = (paneProps.data ?? {}) as unknown as OrgPartCardData;
	const uid = useId();
	const { requestClose } = useAppActions().windows;
	const close = useCallback(() => { if (paneProps.uniqId) void requestClose(paneProps.uniqId); }, [requestClose, paneProps.uniqId]);
	const [ref, setRef] = useState<ErpRef>(data.erp?.value ?? { uuid: "", name: "" });
	// Поля — по два в ряд: ряд не переносится сам, а у договора реквизитов восемь.
	const fields = data.fields ?? [];
	const pairs = fields.flatMap((_, i) => (i % 2 ? [] : [fields.slice(i, i + 2)]));

	return (
		<ModelForm
			paneId={paneProps.uniqId}
			readonly
			isLoading={false}
			onSave={() => { }} onSaveAndClose={() => { }} onClose={close}
			tabs={[{
				id: "main", label: translate("general"),
				component: (
					<div className={main.FormContainer}>
						<div className={main.FormWrapper}>
							<div className={main.Form}>
								<FormArea title={translate("onecOrgGroupOnec")}>
									<GroupCol>
										{pairs.map((pair, r) => (
											<GroupRow key={r}>
												{pair.map((f, j) => (
													<OnecField key={f.label} name={`${uid}_f${r * 2 + j}`} label={f.label} value={f.value} width={FIELD_WIDTH.lg} />
												))}
											</GroupRow>
										))}
									</GroupCol>
								</FormArea>
								{data.erp && (
									<FormArea title={translate("onecOrgGroupErp")}>
										<GroupRow>
											<LookupField name={`${uid}_erp`} label={data.erp.label} endpoint={data.erp.endpoint}
												displayField={data.erp.displayField} value={ref.uuid} displayValue={ref.name} width={FIELD_WIDTH.xl}
												extraParams={data.erp.extraParams} createDefaults={data.erp.createDefaults}
												onSelect={(uuid, name) => setRef({ uuid, name })} onClear={() => setRef({ uuid: "", name: "" })} />
										</GroupRow>
									</FormArea>
								)}
							</div>
						</div>
					</div>
				),
			}]}
		/>
	);
};
IbOrgPartCard.displayName = "IbOrgPartCard";

export default IbOrgPartCard;
