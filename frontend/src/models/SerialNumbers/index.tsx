// Справочник серийных номеров (T6.1) — только чтение. Серии не создаются вручную:
// они появляются при приёмке товара и выбывают при продаже/списании. Здесь —
// просмотр и фильтрация (статус, товар).
import { FC, useMemo } from "react";
import { translate } from "src/i18";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { Field } from "src/components/Field";
import { Group, GroupCol } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import Notice from "src/components/Notice";
import { useFormNotices } from "src/hooks/useFormNotices";

const MODEL_ENDPOINT = "serialnumbers";

const STATUS_KEYS: Record<string, string> = {
  in_stock: "serialInStock", issued: "serialIssued", written_off: "serialWrittenOff",
};

interface TFields { id?: number; uuid?: string; serialNumber: string; status: string; productName: string; }
const DEFAULT_FIELDS: TFields = { serialNumber: "", status: "", productName: "" };

const SerialNumbersForm: FC<Partial<TPane>> = (paneProps) => {
  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT, storageKey: "serial-numbers-form", defaultFields: DEFAULT_FIELDS, paneProps,
    mapServerToForm: (d) => ({
      id: d.id, uuid: d.uuid,
      serialNumber: d.serialNumber ?? "",
      status: d.status ?? "",
      productName: d.product?.name ?? "",
    }),
    // Запись невозможна: у роутера serialnumbers нет POST/PUT. Форма — только
    // просмотр карточки серии (номер, статус, товар), открывается двойным кликом.
    buildPayload: () => ({}),
    buildPaneLabel: (saved) => makePaneLabel("SerialNumbersList", "Серийный номер", saved, saved.serialNumber || undefined),
  });

  // Ошибки ДАННЫХ формы → <Notice /> внутри формы (системные — в <UIToast />).
  const notices = useFormNotices(form);

  const tabs = useMemo(() => [{
    id: "tab-details", label: translate("general"), component: (
      <div className={styles.FormWrapper}>
        <div className={styles.Form}>
          <GroupCol>
            {/* Серии создаются документами приёмки и выбывают продажей/списанием;
                ручное редактирование не предусмотрено — это справочник для просмотра. */}
            <div className={styles.SettingHint}>{translate("serialReadOnlyNote")}</div>
            <Group>
              <Field label={translate("serialNumber")} name={`${form.formUid}_sn`} value={form.fields.serialNumber} disabled />
              <Field label={translate("serialStatus")} name={`${form.formUid}_st`} value={form.fields.status ? translate(STATUS_KEYS[form.fields.status] ?? form.fields.status) : ""} disabled />
            </Group>
            <Group>
              <Field label={translate("ProductsList")} name={`${form.formUid}_p`} value={form.fields.productName} disabled />
            </Group>
          </GroupCol>
        </div>
        <GroupCol className={styles.FormNotice}>
          <Notice items={notices} />
        </GroupCol>
      </div>
    ),
  }], [form.fields, form.formUid]);

  return (
    <ModelForm paneId={form.paneId} tabs={tabs} readonly
      onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading} />
  );
};
SerialNumbersForm.displayName = "SerialNumbersForm";

/** Статус серии — на языке интерфейса. */
function renderSerialCell(row: TDataItem, col: TColumn) {
  if (col.identifier === "status") {
    const key = STATUS_KEYS[String(row.status)];
    return <span>{key ? translate(key) : String(row.status ?? "")}</span>;
  }
  return undefined;
}

const SerialNumbersList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; ownerUuid?: string; ownerField?: string; extraQueryParams?: Record<string, string> }> = ({ variant, onSelectItem, ownerUuid, ownerField, extraQueryParams }) => (
  <ModelList endpoint={MODEL_ENDPOINT} listName="SerialNumbersList" columnsJson={columnsJson} FormComponent={SerialNumbersForm}
    getLabel={(d) => (d?.serialNumber as string | undefined) || ""} variant={variant} onSelectItem={onSelectItem}
    ownerUuid={ownerUuid} ownerField={ownerField} extraQueryParams={extraQueryParams} defaultSort={{ id: "desc" }} renderCell={renderSerialCell}
    // Серии не создаются и не удаляются вручную: они появляются при приёмке и выбывают
    // при продаже/списании. У роутера serialnumbers НЕТ ни POST /, ни DELETE /:id, ни
    // batch-delete — кнопки «Добавить»/«Удалить» просто падали с ошибкой. Ручное
    // удаление к тому же ломало бы инвариант «число серий == количеству в документе».
    hideAddDelete
  />
);
SerialNumbersList.displayName = "SerialNumbersList";

export { SerialNumbersList, SerialNumbersForm };
