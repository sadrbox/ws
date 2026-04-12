import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { translate } from "src/i18";
import type { TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useQueryClient } from "@tanstack/react-query";
import { Divider, Field } from "src/components/Field";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import Tabs from "src/components/Tabs";
import BankAccountsTable from "../BankAccounts/BankAccountsTable";
import ContractsTable from "../Contracts/ContractsTable";
import ContactsTable from "../Contacts/ContactsTable";
import { ActivityHistoriesList } from "../ActivityHistories";
import FormError from "src/components/FormError";
import { useFormError } from "src/hooks/useFormError";
import { useFormSessionStore } from "src/hooks/useFormSessionStore";
import { commitPendingRows } from "src/services/commitPendingRows";
import FormPanel from "src/components/FormPanel";
import { useModelListState } from "src/hooks/useModelListState";
import { useAccessRight } from "src/hooks/useAccessRight";

const MODEL_ENDPOINT = "organizations";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  bin: string;
  shortName: string;
  displayName: string;
  /** Pending-строки SubTable контактов (сохраняются в sessionStorage вместе с формой) */
  _pendingContacts?: TDataItem[];
  /** Pending-строки SubTable банковских счетов */
  _pendingBankAccounts?: TDataItem[];
  /** Pending-строки SubTable договоров */
  _pendingContracts?: TDataItem[];
}

const EMPTY_FORM: TFormData = { bin: "", shortName: "", displayName: "" };

const OrganizationsForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const { canWrite } = useAccessRight("Organization");
  const formUid = useUID();

  const [formData, setFormData, clearFormStorage, hadStoredData] = useFormSessionStore<TFormData>(
    "organizations-form", uuid ?? "new", EMPTY_FORM,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError, errorRevision] = useFormError();
  const [isEditMode, setIsEditMode] = useState(!!uuid);
  const contactsPendingRef = useRef<TDataItem[]>([]);
  const bankAccountsPendingRef = useRef<TDataItem[]>([]);
  const contractsPendingRef = useRef<TDataItem[]>([]);
  const queryClient = useQueryClient();

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const tabs = useMemo(() => [
    {
      id: 'tab0', label: translate("general") || 'Общие сведения', component: (
        <div className={styles.FormBodyParts}>
          <Group align="row" gap="12px" className={styles.Form}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
              <Field label="Наименование" name={`${formUid}_shortName`} minWidth="339px" value={formData.shortName} onChange={e => handleFieldChange("shortName", e.target.value)} disabled={isLoading} />
              <Field label="Полное наименование" name={`${formUid}_displayName`} minWidth="339px" value={formData.displayName} onChange={e => handleFieldChange("displayName", e.target.value)} disabled={isLoading} />
              <Field label="БИН / ИНН *" name={`${formUid}_bin`} minWidth="339px" value={formData.bin} onChange={e => handleFieldChange("bin", e.target.value)} disabled={isLoading || isEditMode} />
            </div>
          </Group>
          {isEditMode && (
            <>
              <Divider />
              <Group align="row" gap="12px" className={styles.Form}>
                <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "12px" }}>
                  <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                  <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                </div>
              </Group>
            </>
          )}
        </div>
      ),
    },
    { id: 'tab1', label: 'Банковские счета', component: <BankAccountsTable
      deferRemoteChanges={true}
      ownerType="organization"
      parentUuid={formData.uuid ?? ""}
      parentName={formData.shortName}
      initialPendingRows={formData._pendingBankAccounts}
      onItemsChange={(items) => {
        const all = items ?? [];
        const pending = all.filter((r: any) => r._pendingAction);
        bankAccountsPendingRef.current = pending;
        setFormData(prev => {
          const next = pending.length ? pending : undefined;
          if (JSON.stringify(prev._pendingBankAccounts) === JSON.stringify(next)) return prev;
          return { ...prev, _pendingBankAccounts: next };
        });
      }}
    /> },
    { id: 'tab2', label: 'Договора', component: <ContractsTable
      deferRemoteChanges={true}
      ownerType="organization"
      parentUuid={formData.uuid ?? ""}
      parentName={formData.shortName}
      initialPendingRows={formData._pendingContracts}
      onItemsChange={(items) => {
        const all = items ?? [];
        const pending = all.filter((r: any) => r._pendingAction);
        contractsPendingRef.current = pending;
        setFormData(prev => {
          const next = pending.length ? pending : undefined;
          if (JSON.stringify(prev._pendingContracts) === JSON.stringify(next)) return prev;
          return { ...prev, _pendingContracts: next };
        });
      }}
    /> },
  { id: 'tab3', label: 'Контакты', component: <ContactsTable
      deferRemoteChanges={true}
      ownerType="organization"
      parentUuid={formData.uuid ?? ""}
      parentName={formData.shortName}
      initialPendingRows={formData._pendingContacts}
      onItemsChange={(items) => {
        const all = items ?? [];
        const pending = all.filter((r: any) => r._pendingAction);
        contactsPendingRef.current = pending;
        setFormData(prev => {
          const next = pending.length ? pending : undefined;
          if (JSON.stringify(prev._pendingContacts) === JSON.stringify(next)) return prev;
          return { ...prev, _pendingContacts: next };
        });
      }}
    /> },
    { id: 'tab4', label: 'История действий', component: <ActivityHistoriesList ownerUuid={formData.uuid} ownerField="organizationUuid" /> },
  ], [formData, formUid, isLoading, isEditMode, handleFieldChange]);

  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = response.data?.item ?? response.data;
      setFormData({
        bin: d.bin ?? "", shortName: d.shortName ?? "", displayName: d.displayName ?? "",
        id: d.id, uuid: d.uuid,
      });
      // Обновляем вложенные SubTable — invalidate их кэши
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["bankaccounts"] });
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
    } catch (err: any) {
      setError(err.response?.data?.message || "Не удалось загрузить данные");
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  /** Универсальный коммит pending-строк SubTable на сервер (без refetch — он будет позже) */
  const commitPending = useCallback(async (
    endpoint: string,
    ownerType: string,
    savedParentUuid: string,
    pendingRef: React.MutableRefObject<TDataItem[]>,
    tableName: string,
  ) => {
    await commitPendingRows(endpoint, pendingRef.current || [], savedParentUuid, "ownerUuid", tableName, {
      extraFields: { ownerType },
    });
  }, []);

  useEffect(() => {
    // Если данные восстановлены из sessionStorage — не грузим с сервера
    if (uuid && !hadStoredData) loadFormData(uuid);
  }, [uuid, loadFormData, hadStoredData]);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    const binTrimmed = formData.bin?.trim() ?? "";
    if (!binTrimmed || !/^\d{12}$/.test(binTrimmed)) {
      setError("БИН должен состоять ровно из 12 цифр");
      setIsLoading(false);
      return false;
    }
    const payload = { bin: binTrimmed, shortName: formData.shortName?.trim() || null, displayName: formData.displayName?.trim() || null };
    try {
      const response = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = response.data?.item ?? response.data;
      setFormData(prev => ({ ...prev, ...saved, bin: saved.bin ?? prev.bin, shortName: saved.shortName ?? "", displayName: saved.displayName ?? "" }));
      setIsEditMode(true);
      if (uniqId) {
        const label = `${translate("OrganizationsList") || "OrganizationsList"}: ${saved.shortName || saved.bin || "?"} • ${saved.id ?? "?"}`;
        updatePaneLabel(uniqId, label);
      }
      // Commit pending SubTable rows
      try {
        const parentUuid = saved.uuid ?? saved.id ?? "";
        await commitPending("contacts", "organization", parentUuid, contactsPendingRef, translate("ContactsList") || "Контакты");
        await commitPending("bankaccounts", "organization", parentUuid, bankAccountsPendingRef, translate("BankAccountsList") || "Банковские счета");
        await commitPending("contracts", "organization", parentUuid, contractsPendingRef, translate("ContractsList") || "Договора");
        // Очистить pending после успешного коммита
        contactsPendingRef.current = [];
        bankAccountsPendingRef.current = [];
        contractsPendingRef.current = [];
        setFormData(prev => ({ ...prev, _pendingContacts: undefined, _pendingBankAccounts: undefined, _pendingContracts: undefined }));
        // Отложенный invalidate — ждём один тик рендера, чтобы SubTable
        // успел получить новый parentUuid и включить свой query (enabled: true).
        // Без этого при создании нового элемента query ещё disabled и invalidate бесполезен.
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["contacts"] });
          queryClient.invalidateQueries({ queryKey: ["bankaccounts"] });
          queryClient.invalidateQueries({ queryKey: ["contracts"] });
        }, 0);
      } catch (e: any) {
        const msg = e?.message || "Не удалось сохранить вложенные данные";
        setError(msg);
        return false;
      }
      onSave?.();
      return true;
    } catch (err: any) {
      let msg = "Не удалось сохранить";
      if (err.response?.status === 409) msg = "Организация с таким БИН уже существует";
      else if (err.response?.status === 400) msg = err.response.data?.message || "Ошибка валидации";
      else if (err.message) msg = err.message;
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [formData, isEditMode, uuid, onSave, commitPending]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId, clearFormStorage]);
  const handleClose = useCallback(() => { clearFormStorage(); onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId, clearFormStorage]);

  return (
    <div className={styles.FormWrapper}>
      <FormPanel
        onSaveAndClose={handleSaveAndClose}
        onSave={handleSave}
        onClose={handleClose}
        onReload={uuid ? () => loadFormData(uuid) : undefined}
        isLoading={isLoading}
        showReload={isEditMode}
        readonly={!canWrite}
      />
      <FormError message={error} revision={errorRevision} onDismiss={() => setError(null)} />
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
OrganizationsForm.displayName = "OrganizationsForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const LIST_NAME = "OrganizationsList";

const OrganizationsList: FC<{ variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void }> = ({ variant = 'default', onSelectItem } = {}) => {
  const { addPane } = useAppContext().windows;
  const t = (key: string) => translate(key) || key;

  const { error, refetch, buildTableProps } = useModelListState({
    model: MODEL_ENDPOINT,
    componentName: LIST_NAME,
    columnsJson,
  });

  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(LIST_NAME)}: ${d?.shortName || t("noName")} • ${d?.id ?? "?"}` : `${t(LIST_NAME)}: ${t("new")}`,
      component: OrganizationsForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch]);

  const tableProps = useMemo(() => buildTableProps({ variant, onSelectItem, openModelForm }), [buildTableProps, variant, onSelectItem, openModelForm]);

  if (error) {
    return (
      <div className="error-container"><div className="error-message">
        <h3>{t("errorTitle") || "Ошибка загрузки"}</h3>
        <p>{(error as Error)?.message || "Неизвестная ошибка"}</p>
        <button onClick={() => refetch()} className="retry-button">{t("retry") || "Повторить"}</button>
      </div></div>
    );
  }

  return <Table {...tableProps} />;
};

OrganizationsList.displayName = "OrganizationsList";
export { OrganizationsList, OrganizationsForm };
