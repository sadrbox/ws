/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────────────────────
// createInvoiceLikeForm — фабрика для счёт-фактур, счёт на оплату, заявок.
// ─────────────────────────────────────────────────────────────────────────────
import { FC, useMemo, useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import type { TPane } from "src/app/types";
import type { TDataItem } from "src/components/Table/types";
import { Field, FieldDateTime, FieldSelect } from "src/components/Field";
import { useEsfDictionaries } from "src/services/esf/dictionaries";
import { useAssignNumber } from "src/hooks/useAssignNumber";
import HeaderTogglePosted from "src/components/PaneHeader/HeaderTogglePosted";
import { FormLookup } from "src/components/Field/FormLookup";
import Notice from "src/components/Notice";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import { useContractCounterpartyMismatch } from "src/hooks/useContractCounterpartyMismatch";
import { Group, GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { HelpBox } from "src/components/HelpBox";
import { useFormStore } from "src/hooks/useFormStore";
import { useContractSync } from "src/hooks/useContractSync";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";
import { useAccessPermission } from "src/hooks/useAccessPermission";
import useOrgAccountingSettings from "src/hooks/useOrgAccountingSettings";
import { useAutoFillPrimary } from "src/hooks/useAutoFillPrimary";
import { useUserDefaults, type UserDefaultsMap } from "src/hooks/useUserDefaults";
import { useApplyUserDefaults } from "src/hooks/useApplyUserDefaults";
import { makeDocLabel } from "src/utils/buildPaneLabel";
import { getFormatDateOnly, isoToLocalInput, localInputToIso } from "src/utils/datetime";
import ModelForm from "src/components/ModelForm";
import TradeDocumentItemsTable from "src/components/DocumentItemsTable/TradeDocumentItemsTable";
import { validateDocumentFields, formatValidationErrors, getDocumentFillHint } from "src/utils/validatePostedDocument";
import { FormRequiredScope, FormDirtyScope } from "src/hooks/useFormRequired";
import BasisDocumentField, { type BasisTypeConfig } from "src/components/Field/BasisDocumentField";
import { usePaneHeaderActions } from "src/hooks/usePaneToolbar";
import ShowInJournalButton from "src/components/ShowInJournalButton";
import NotesButton from "src/components/Notes/NotesButton";
import DeleteDocumentButton from "src/components/DeleteDocumentButton";
import PrintDocumentPane, { type PrintColumnDef } from "src/components/PrintPreview/PrintDocumentPane";
import PrintDropdownButton from "src/components/Toolbar/PrintDropdownButton";
import DocumentChainButton from "src/components/DocumentChain/DocumentChainButton";
import ActionsDropdownButton from "src/components/Toolbar/ActionsDropdownButton";
import RefillFromBasisButton from "src/models/_shared/RefillFromBasisButton";
import { useEsfInvoice } from "src/hooks/useEsfInvoice";
import type { NoticeItem } from "src/components/Notice";
import { useAppContext } from "src/app/context";
import { type BasisFromTarget, type OrgDependentField, openDocumentFromBasis, mapCommonTradeFields, resolveOrgChangeFields, runBasisRefill } from "src/utils/createFromBasis";
import { useExistingDependents, formatDependentOption } from "src/hooks/useExistingDependents";
import DocumentTotals from "src/components/DocumentTotals";
import { useBasisMismatch } from "src/hooks/useBasisMismatch";

export type { BasisTypeConfig };

export interface PrintConfig {
  buildLayout: (fields: TFields, items: any[], cols: Record<string, boolean>) => React.ReactNode;
  columnDefs: PrintColumnDef[];
  columnsKey: string;
  fileBaseName: (fields: TFields) => string;
  title: (fields: TFields) => string;
}

export interface InvoiceLikeFormConfig {
  endpoint: string;
  itemsEndpoint: string;
  itemsParentField: string;
  storageKey: string;
  listName: string;
  formLabel: string;
  itemsTabLabel: string;
  itemsComponentName: string;
  accessPermissionModel: string;
  formDisplayName: string;
  docType: "outgoing_invoice" | "incoming_invoice" | "payment_invoice" | "purchase_requisition" | "commercial_offer" | "sales_order" | "reservation" | "purchase_order";
  basisConfig?: { allowedTypes: BasisTypeConfig[] };
  printConfig?: PrintConfig;
  /** Документы, которые можно создать на основании этого. Кнопки появляются в шапке панели. */
  createFromBasisTargets?: BasisFromTarget[];
  /** Колонки позиций, скрытые по умолчанию для данного типа документа. */
  defaultHiddenItemColumns?: string[];
  /** Скрыть переключатель "Проведение" (напр. Счёт на оплату — не проводится). */
  hidePosted?: boolean;
  /**
   * Документ-«утверждение»: создавать документы «на основании» можно только когда он
   * ПРОВЕДЁН (утверждён). Так проведение получает смысл у документов, которые не
   * двигают регистры и не дают проводок (заявка на закупку). Бэкенд держит тот же
   * инвариант — assertBasisExists отдаёт 422 на непроведённое основание.
   */
  requirePostedForBasis?: boolean;
  /** Показать поле «Склад» в шапке (для заказов покупателя/поставщику, резерва). */
  hasWarehouse?: boolean;
  /**
   * Блокировать поля шапки и таблицу позиций, если у документа есть основание.
   * true — только для Счёт-фактуры исходящей; остальные документы не блокируются.
   */
  lockFieldsOnBasis?: boolean;
  /** Включить интеграцию с ИС ЭСФ РК (подпись NCALayer + отправка). Только для «Счёт-фактура исходящая». */
  hasEsf?: boolean;
}

interface TFields {
  id?: number; uuid?: string;
  number: string;
  date: string; comment: string;
  amount: number; vatAmount: number; discountAmount: number; amountWithoutVat: number;
  posted: boolean;
  organizationUuid: string; organizationName: string;
  counterpartyUuid: string; counterpartyName: string;
  contractUuid: string; contractName: string;
  warehouseUuid: string; warehouseName: string;
  authorUuid: string; authorName: string;
  basisDocumentType: string;
  basisDocumentUuid: string;
  basisDocumentLabel: string;
  esfSellerType: string;
  esfCustomerType: string;
  esfInvoiceType: string;
  esfRelatedInvoiceUuid: string;
  esfRelatedInvoiceName: string;
  esfConsignorUuid: string; esfConsignorName: string;
  esfConsigneeUuid: string; esfConsigneeName: string;
  // Поверенный (I/J, ссылка на контрагента/организацию) + госучреждение (C1) — Э5.
  esfCustomerAgentUuid: string; esfCustomerAgentName: string;
  esfCustomerAgentDocNum: string; esfCustomerAgentDocDate: string;
  esfSellerAgentUuid: string; esfSellerAgentName: string;
  esfSellerAgentDocNum: string; esfSellerAgentDocDate: string;
  esfPoBik: string; esfPoIik: string; esfPoPayPurpose: string; esfPoProductCode: string;
}

/** Плоские опциональные строковые ЭСФ-поля (Э5) — для DRY defaults/map/payload. */
const ESF_STR_KEYS = [
  "esfCustomerAgentDocNum", "esfCustomerAgentDocDate",
  "esfSellerAgentDocNum", "esfSellerAgentDocDate",
  "esfPoBik", "esfPoIik", "esfPoPayPurpose", "esfPoProductCode",
] as const;
type EsfStrKey = typeof ESF_STR_KEYS[number];
const esfStrDefaults = () => Object.fromEntries(ESF_STR_KEYS.map((k) => [k, ""])) as Record<EsfStrKey, string>;

const DEFAULT_FIELDS: TFields = {
  number: "",
  date: "", comment: "",
  amount: 0, vatAmount: 0, discountAmount: 0, amountWithoutVat: 0,
  posted: false,
  organizationUuid: "", organizationName: "",
  counterpartyUuid: "", counterpartyName: "",
  contractUuid: "", contractName: "",
  warehouseUuid: "", warehouseName: "",
  authorUuid: "", authorName: "",
  basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "",
  esfSellerType: "", esfCustomerType: "",
  esfInvoiceType: "", esfRelatedInvoiceUuid: "", esfRelatedInvoiceName: "",
  esfConsignorUuid: "", esfConsignorName: "", esfConsigneeUuid: "", esfConsigneeName: "",
  esfCustomerAgentUuid: "", esfCustomerAgentName: "", esfSellerAgentUuid: "", esfSellerAgentName: "",
  ...esfStrDefaults(),
};

/** Сид панели инвойс-подобной формы (paneProps.data). */
interface InvoicePaneData {
  uuid?: string;
  fromBasisFields?: Partial<TFields>;
  fromBasisItems?: TDataItem[];
  organizationUuid?: string;
  organizationName?: string;
  counterpartyUuid?: string;
  counterpartyName?: string;
}

/** Серверная запись инвойс-подобного документа (вход mapServerToForm). */
interface InvoiceServerRecord {
  id?: number;
  uuid?: string;
  number?: string | null;
  date?: string | null;
  comment?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
  discountAmount?: number | string | null;
  amountWithoutVat?: number | string | null;
  posted?: boolean;
  organizationUuid?: string | null; organization?: { name?: string | null } | null;
  counterpartyUuid?: string | null; counterparty?: { name?: string | null } | null;
  contractUuid?: string | null; contract?: { name?: string | null } | null;
  warehouseUuid?: string | null; warehouse?: { name?: string | null } | null;
  authorUuid?: string | null; author?: { uuid?: string | null; username?: string | null; email?: string | null } | null;
  basisDocumentType?: string | null;
  basisDocumentUuid?: string | null;
  basisDocumentLabel?: string | null;
  esfSellerType?: string | null;
  esfCustomerType?: string | null;
  esfInvoiceType?: string | null;
  esfRelatedInvoiceUuid?: string | null;
  esfRelatedInvoiceNumber?: string | null;
  esfConsignorUuid?: string | null; esfConsignorName?: string | null;
  esfConsigneeUuid?: string | null; esfConsigneeName?: string | null;
  esfCustomerAgentUuid?: string | null; esfCustomerAgentName?: string | null;
  esfSellerAgentUuid?: string | null; esfSellerAgentName?: string | null;
}

/** Строка позиции инвойса для печати (live-строки таблицы с relation-объектами). */
interface InvoiceItemRow extends TDataItem {
  product?: { name?: string | null } | null;
  productName?: string | null;
  unitOfMeasure?: { name?: string | null } | null;
  unitName?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  amount?: number | string | null;
  amountWithoutVat?: number | string | null;
  vatRate?: number | string | null;
  vatAmount?: number | string | null;
  exciseRate?: number | string | null;
  exciseAmount?: number | string | null;
  discountPercent?: number | string | null;
  discountAmount?: number | string | null;
}

export function createInvoiceLikeForm(cfg: InvoiceLikeFormConfig): FC<Partial<TPane>> {
  const dependentEndpoints = (cfg.createFromBasisTargets ?? [])
    .map((t) => t.existingCheckEndpoint)
    .filter((e): e is string => !!e);

  const Form: FC<Partial<TPane>> = (paneProps) => {
    const defaultOrg = useDefaultOrganization();
    const queryClient = useQueryClient();
    const { canWrite } = useAccessPermission(cfg.accessPermissionModel);
    const { windows: { addPane }, auth: { user: currentUser } } = useAppContext();

    const initialFields: TFields | undefined = (() => {
      const data = paneProps.data as InvoicePaneData | undefined;
      if (data?.uuid) return undefined;
      if (data?.fromBasisFields) return { ...DEFAULT_FIELDS, ...data.fromBasisFields };
      const init = { ...DEFAULT_FIELDS };
      init.date = isoToLocalInput(new Date().toISOString());
      if (data?.organizationUuid) {
        init.organizationUuid = data.organizationUuid;
        init.organizationName = data.organizationName || "";
      } else if (defaultOrg.organizationUuid) {
        init.organizationUuid = defaultOrg.organizationUuid;
        init.organizationName = defaultOrg.organizationName;
      }
      if (data?.counterpartyUuid) {
        init.counterpartyUuid = data.counterpartyUuid;
        init.counterpartyName = data.counterpartyName || "";
      }
      return init;
    })();

    const [basisItems, setBasisItems] = useState<TDataItem[]>(() => {
      const data = paneProps.data as InvoicePaneData | undefined;
      return Array.isArray(data?.fromBasisItems) && data.fromBasisItems.length > 0
        ? data.fromBasisItems : [];
    });
    const [itemsTableKey, setItemsTableKey] = useState(0);
    const [isRefilling, setIsRefilling] = useState(false);

    const invalidateSubTables = useCallback(async () => {
      await queryClient.invalidateQueries({ queryKey: [cfg.itemsEndpoint], refetchType: "active" });
    }, [queryClient]);

    const afterSave = useCallback(async () => {
      setBasisItems([]);
      await invalidateSubTables();
    }, [invalidateSubTables]);

    const afterReload = useCallback(() => { setBasisItems([]); }, []);

    const form = useFormStore<TFields>({
      endpoint: cfg.endpoint,
      storageKey: cfg.storageKey,
      defaultFields: DEFAULT_FIELDS,
      initialFields,
      paneProps,
      derivedFields: ["amount", "vatAmount", "amountWithoutVat", "discountAmount"],
      tables: {
        items: {
          endpoint: cfg.itemsEndpoint, parentField: cfg.itemsParentField,
          label: cfg.itemsTabLabel,
          batchEndpoint: `${cfg.itemsEndpoint}/batch`,
          createPayload: (r: TDataItem) => ({
            sourceRowId: r.sourceRowId ?? null,
            productUuid: r.productUuid ?? null,
            quantity: r.quantity ?? 0,
            price: r.price ?? 0,
            unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
            vatRate: r.vatRate ?? 0,
            exciseRate: r.exciseRate ?? 0,
            discountPercent: r.discountPercent ?? 0,
            ...(cfg.hasEsf ? { tnvedCode: r.tnvedCode ?? null, truOriginCode: r.truOriginCode ?? null, productDeclaration: r.productDeclaration ?? null, productNumberInDeclaration: r.productNumberInDeclaration ?? null } : {}),
          }),
          updatePayload: (r: TDataItem) => ({
            sourceRowId: r.sourceRowId ?? null,
            productUuid: r.productUuid ?? null,
            quantity: r.quantity ?? 0,
            price: r.price ?? 0,
            unitOfMeasureUuid: r.unitOfMeasureUuid ?? null,
            vatRate: r.vatRate ?? 0,
            exciseRate: r.exciseRate ?? 0,
            discountPercent: r.discountPercent ?? 0,
            ...(cfg.hasEsf ? { tnvedCode: r.tnvedCode ?? null, truOriginCode: r.truOriginCode ?? null, productDeclaration: r.productDeclaration ?? null, productNumberInDeclaration: r.productNumberInDeclaration ?? null } : {}),
          }),
          extraSkipFields: [cfg.itemsParentField],
        },
      },
      mapServerToForm: (d: InvoiceServerRecord, prev) => ({
        ...(prev ?? DEFAULT_FIELDS), ...d,
        number: d.number ?? "",
        date: isoToLocalInput(d.date),
        comment: d.comment ?? "",
        amount: d.amount != null ? Number(d.amount) : 0,
        vatAmount: d.vatAmount != null ? Number(d.vatAmount) : 0,
        discountAmount: d.discountAmount != null ? Number(d.discountAmount) : 0,
        amountWithoutVat: d.amountWithoutVat != null ? Number(d.amountWithoutVat) : 0,
        posted: d.posted === true,
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.name ?? "",
        counterpartyUuid: d.counterpartyUuid ?? "",
        counterpartyName: d.counterparty?.name ?? "",
        contractUuid: d.contractUuid ?? "",
        contractName: d.contract?.name ?? "",
        warehouseUuid: d.warehouseUuid ?? "",
        warehouseName: d.warehouse?.name ?? "",
        authorUuid: d.authorUuid ?? d.author?.uuid ?? "",
        authorName: d.author?.username ?? d.author?.email ?? "",
        basisDocumentType: d.basisDocumentType ?? "",
        basisDocumentUuid: d.basisDocumentUuid ?? "",
        basisDocumentLabel: d.basisDocumentLabel ?? "",
        esfSellerType: d.esfSellerType ?? "",
        esfCustomerType: d.esfCustomerType ?? "",
        esfInvoiceType: d.esfInvoiceType ?? "",
        esfRelatedInvoiceUuid: d.esfRelatedInvoiceUuid ?? "",
        esfRelatedInvoiceName: d.esfRelatedInvoiceNumber ?? "",
        esfConsignorUuid: d.esfConsignorUuid ?? "", esfConsignorName: d.esfConsignorName ?? "",
        esfConsigneeUuid: d.esfConsigneeUuid ?? "", esfConsigneeName: d.esfConsigneeName ?? "",
        esfCustomerAgentUuid: d.esfCustomerAgentUuid ?? "", esfCustomerAgentName: d.esfCustomerAgentName ?? "",
        esfSellerAgentUuid: d.esfSellerAgentUuid ?? "", esfSellerAgentName: d.esfSellerAgentName ?? "",
        ...Object.fromEntries(ESF_STR_KEYS.map((k) => [k, (d as Record<string, unknown>)[k] ?? ""])) as Record<EsfStrKey, string>,
      }),
      buildPayload: (fd) => {
        const validation = validateDocumentFields(cfg.docType, fd as unknown as Record<string, unknown>);
        if (!validation.isValid) return formatValidationErrors(validation.errors);

        return {
          number: fd.number?.trim() || null,
          date: localInputToIso(fd.date),
          comment: fd.comment?.trim() || null,
          amount: fd.amount ? fd.amount : null,
          vatAmount: fd.vatAmount ? fd.vatAmount : 0,
          discountAmount: fd.discountAmount ? fd.discountAmount : 0,
          amountWithoutVat: fd.amountWithoutVat ? fd.amountWithoutVat : 0,
          posted: fd.posted === true,
          organizationUuid: fd.organizationUuid || null,
          counterpartyUuid: fd.counterpartyUuid || null,
          contractUuid: fd.contractUuid || null,
          ...(cfg.hasWarehouse ? { warehouseUuid: fd.warehouseUuid || null } : {}),
          basisDocumentType: fd.basisDocumentType || null,
          basisDocumentUuid: fd.basisDocumentUuid || null,
          basisDocumentLabel: fd.basisDocumentLabel || null,
          ...(cfg.hasEsf ? {
            esfSellerType: fd.esfSellerType || null,
            esfCustomerType: fd.esfCustomerType || null,
            esfInvoiceType: fd.esfInvoiceType || null,
            esfRelatedInvoiceUuid: fd.esfInvoiceType && fd.esfInvoiceType !== "ORDINARY_INVOICE" ? (fd.esfRelatedInvoiceUuid || null) : null,
            esfConsignorUuid: fd.esfConsignorUuid || null,
            esfConsigneeUuid: fd.esfConsigneeUuid || null,
            esfCustomerAgentUuid: fd.esfCustomerAgentUuid || null,
            esfSellerAgentUuid: fd.esfSellerAgentUuid || null,
            ...Object.fromEntries(ESF_STR_KEYS.map((k) => [k, fd[k] || null])),
          } : {}),
        };
      },
      buildPaneLabel: (saved) => makeDocLabel(cfg.listName, cfg.formLabel, saved, "date"),
      afterSave,
      afterReload,
    });

    const items = form.useTable("items");
    const allItemsRef = useRef<TDataItem[]>([]);
    const permDefaultsRef = useRef<UserDefaultsMap>({});

    // Подсказка о несоответствии документу-основанию (шапка + строки).
    const basisMismatch = useBasisMismatch({
      basisType: form.fields.basisDocumentType,
      basisUuid: form.fields.basisDocumentUuid,
      currentFields: form.fields,
      currentItems: allItemsRef.current,
      mapFields: mapCommonTradeFields,
      // У документов без склада (счёт-фактура, счёт на оплату) поля «Склад» нет —
      // не считаем расхождением с основанием, у которого склад есть.
      ignoreFields: cfg.hasWarehouse ? undefined : ["warehouseUuid"],
    });

    const hasBasis = !!form.fields.basisDocumentUuid;
    const basisLock = hasBasis && (cfg.lockFieldsOnBasis ?? false);
    const effectiveReadonly = !canWrite;

    const contractMismatch = useContractCounterpartyMismatch(form.fields.contractUuid, form.fields.counterpartyUuid);
    const notices = useDocumentNotices({
      docType: cfg.docType,
      fields: form.fields as unknown as Record<string, unknown>,
      basisMismatch,
      contractMismatch,
      // Ошибка ДАННЫХ формы → в <Notice /> (системные сбои уходят в тост, см. useFormStore).
      formError: form.errorKind === "form" ? form.error : null,
    });

    // ── Интеграция ИС ЭСФ (только для «Счёт-фактура исходящая», cfg.hasEsf) ──
    const esf = useEsfInvoice();
    const esfDict = useEsfDictionaries();
    const esfFields = form.fields as unknown as {
      esfStatus?: string | null; esfRegistrationNumber?: string | null;
      esfInvoiceId?: string | null; esfNum?: string | null;
    };
    const handleEsfAction = useCallback(async (id: string) => {
      const uuid = form.fields.uuid;
      if (!uuid) return;
      try {
        if (id === "send") {
          const r = await esf.sendToEsf(uuid);
          form.setFields({
            esfStatus: r.esfStatus, esfRegistrationNumber: r.esfRegistrationNumber,
            esfInvoiceId: r.esfInvoiceId, esfNum: r.esfNum,
          } as unknown as Partial<TFields>);
        } else if (id === "refresh") {
          const r = await esf.refresh(uuid);
          form.setFields({
            esfStatus: r.esfStatus, esfRegistrationNumber: r.esfRegistrationNumber,
          } as unknown as Partial<TFields>);
        } else if (id === "errors") {
          await esf.loadErrors(uuid);
        }
      } catch {
        /* сообщение об ошибке отображается через esf.error → <Notice/> */
      }
    }, [form.fields.uuid, form.setFields, esf]);

    const esfNotices = useMemo<NoticeItem[]>(() => {
      if (!cfg.hasEsf) return [];
      const out: NoticeItem[] = [];
      if (esfFields.esfStatus) {
        const reg = esfFields.esfRegistrationNumber ? ` · ${translate("esfRegNo")} ${esfFields.esfRegistrationNumber}` : "";
        const ok = ["DELIVERED", "CONFIRMED", "PROCESSED", "IMPORTED", "CREATED"].includes(esfFields.esfStatus);
        out.push({ type: ok ? "success" : "warning", text: `${translate("esf")}: ${esfFields.esfStatus}${reg}` });
      }
      if (esf.error) out.push({ type: "attention", text: `${translate("esf")}: ${esf.error}` });
      // Детальные ошибки ИС ЭСФ (queryInvoiceErrorById) — по кнопке «Показать ошибки».
      for (const e of esf.errors) {
        const code = e.errorCode ? `[${e.errorCode}] ` : "";
        out.push({ type: "attention", text: `${code}${e.text || ""}` });
      }
      return out;
    }, [esfFields.esfStatus, esfFields.esfRegistrationNumber, esf.error, esf.errors]);

    const handleRefillFromBasis = useCallback(async (skipFields = false) => {
      setIsRefilling(true);
      try {
        // Склад — только для документов со складом (заказы/резерв).
        const orgFields: OrgDependentField[] = [
          { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
        ];
        if (cfg.hasWarehouse) orgFields.push({ valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" });
        await runBasisRefill({
          form, skipFields,
          currentUserUuid: currentUser?.uuid ?? "",
          permDefaults: permDefaultsRef.current,
          itemsEndpoint: cfg.itemsEndpoint, itemsParentField: cfg.itemsParentField,
          orgFields,
          allItemsRef, setBasisItems, bumpItemsTableKey: () => setItemsTableKey(k => k + 1),
        });
      } catch (e) {
        console.error("[refill] failed", e);
      } finally {
        setIsRefilling(false);
      }
    }, [form, currentUser?.uuid, cfg.itemsEndpoint, cfg.itemsParentField, cfg.hasWarehouse]);

    const { isVatEnabled, useDiscount } = useOrgAccountingSettings(
      form.fields.organizationUuid || null,
      form.fields.date || null,
    );

    const handlePrint = useCallback(() => {
      if (!cfg.printConfig || !form.fields.uuid) return;
      try {
        const rows = allItemsRef.current.map((raw, i) => {
          const r = raw as InvoiceItemRow;
          return {
            number: i + 1,
            name: r.product?.name ?? r.productName ?? "",
            unit: r.unitOfMeasure?.name ?? r.unitName ?? "",
            quantity: Number(r.quantity ?? 0),
            price: Number(r.price ?? 0),
            amount: Number(r.amount ?? 0),
            amountWithoutVat: Number(r.amountWithoutVat ?? 0),
            vatRate: Number(r.vatRate ?? 0),
            vatAmount: Number(r.vatAmount ?? 0),
            exciseRate: Number(r.exciseRate ?? 0),
            exciseAmount: Number(r.exciseAmount ?? 0),
            discountPercent: Number(r.discountPercent ?? 0),
            discountAmount: Number(r.discountAmount ?? 0),
          };
        });
        const titleStr = cfg.printConfig.title(form.fields);
        const fileBase = cfg.printConfig.fileBaseName(form.fields);
        addPane({
          component: PrintDocumentPane,
          isSelector: true,
          label: titleStr,
          data: {
            id: Number(form.fields.id ?? 0),
            uuid: String(form.fields.uuid ?? ""),
            columnsKey: cfg.printConfig.columnsKey,
            columnDefs: cfg.printConfig.columnDefs,
            buildLayout: (cols: Record<string, boolean>) => cfg.printConfig!.buildLayout(form.fields, rows, cols),
            fileBaseName: fileBase,
            title: titleStr,
          },
        });
      } catch (e) {
        console.error("[print] failed", e);
      }
    }, [form.fields, addPane]);

    const hasDirtyItems = (items.pending?.length ?? 0) > 0;
    const printDisabled = form.isLoading || form.isDirty || hasDirtyItems;
    const isSavedDoc = form.isEditMode && !!form.fields.uuid;
    const existingDeps = useExistingDependents(isSavedDoc ? form.fields.uuid : undefined, dependentEndpoints);

    const handleCreateFromBasis = useCallback(async (target: BasisFromTarget) => {
      const withKnown: BasisFromTarget = { ...target, knownExisting: target.existingCheckEndpoint ? (existingDeps[target.existingCheckEndpoint] ?? null) : null };
      await openDocumentFromBasis(form.fields as any, cfg.formLabel, withKnown, addPane);
    }, [form.fields, addPane, existingDeps]);
    const showHeaderActions = isSavedDoc || hasBasis;
    const headerActionsPortal = usePaneHeaderActions(
      form.paneId,
      (
        <>
          {/* «На основании» — первым в ряду шапки (по требованию). */}
          {isSavedDoc && cfg.createFromBasisTargets && cfg.createFromBasisTargets.length > 0 && (
            <ActionsDropdownButton
              icon="fromBasis"
              label="На основании"
              disabled={cfg.requirePostedForBasis === true && form.fields.posted !== true}
              title={cfg.requirePostedForBasis === true && form.fields.posted !== true ? translate("basisNotPostedHint") : undefined}
              options={cfg.createFromBasisTargets.map((t, i) => ({
                // id — индекс цели: basisType одинаков у всех целей одного источника,
                // поэтому по нему нельзя различить цели (открывалась бы первая).
                id: String(i),
                label: formatDependentOption(t.docLabel, t.existingCheckEndpoint ? existingDeps[t.existingCheckEndpoint] : null),
              }))}
              onSelect={(id) => {
                const target = cfg.createFromBasisTargets![Number(id)];
                if (target) void handleCreateFromBasis(target);
              }}
            />
          )}
          {!cfg.hidePosted && <HeaderTogglePosted name={`${form.formUid}_posted`} value={form.fields.posted === true} onChange={(v) => form.setField("posted", v)} disabled={form.isLoading || !canWrite} />}
          {showHeaderActions && (<>
            {isSavedDoc && <DocumentChainButton documentType={cfg.docType} documentUuid={form.fields.uuid} />}
            {isSavedDoc && <><NotesButton endpoint={cfg.endpoint} uuid={form.fields.uuid} /> <ShowInJournalButton endpoint={cfg.endpoint} uuid={form.fields.uuid} /></>} {isSavedDoc && <DeleteDocumentButton endpoint={cfg.endpoint} uuid={form.fields.uuid} paneId={form.paneId} />}
            {hasBasis && (
              <RefillFromBasisButton
                mismatch={basisMismatch.mismatch}
                mismatchDetails={basisMismatch.differences}
                disabled={form.isLoading || isRefilling}
                loading={isRefilling}
                onClick={() => void handleRefillFromBasis()}
              />
            )}
            {isSavedDoc && cfg.printConfig && (
              <PrintDropdownButton
                disabled={printDisabled}
                title={printDisabled ? "Сохраните изменения перед печатью" : "Печать"}
                options={[{ id: "print", label: "Печать" }]}
                onSelect={handlePrint}
              />
            )}
            {cfg.hasEsf && isSavedDoc && (
              <ActionsDropdownButton
                icon="download"
                label={translate("esf")}
                disabled={esf.busy || form.isLoading || form.isDirty || hasDirtyItems}
                options={[
                  { id: "send", label: esfFields.esfStatus ? translate("esfResend") : translate("esfSignAndSend") },
                  ...(esfFields.esfInvoiceId ? [
                    { id: "refresh", label: translate("esfRefreshStatus") },
                    { id: "errors", label: translate("esfShowErrors") },
                  ] : []),
                ]}
                onSelect={(id) => void handleEsfAction(id)}
              />
            )}
          </>)}
        </>
      ),
    );

    const syncContract = useContractSync();
    const handleContractSelect = useCallback((uuid: string, displayValue: string, item: Record<string, any>) => {
      const updates: Partial<TFields> = { contractUuid: uuid, contractName: displayValue };
      if (item.organizationUuid) { updates.organizationUuid = item.organizationUuid; updates.organizationName = item.organization?.name ?? ""; }
      if (item.counterpartyUuid) { updates.counterpartyUuid = item.counterpartyUuid; updates.counterpartyName = item.counterparty?.name ?? ""; }
      form.setFields(updates);
    }, [form.setFields]);

    // Выбор контрагента: ЭСФ — грузополучатель = контрагент; категория получателя из карточки.
    const handleCounterpartySelect = useCallback(async (uuid: string, displayValue: string, item?: Record<string, any>) => {
      const updates: Partial<TFields> = { counterpartyUuid: uuid, counterpartyName: displayValue };
      if (cfg.hasEsf) {
        updates.esfConsigneeUuid = uuid; updates.esfConsigneeName = displayValue;
        if (item?.enterpriseCategory) updates.esfCustomerType = item.enterpriseCategory;
      }
      form.setFields(updates);
      // Договор: основной у нового контрагента → подставить, чужой → очистить.
      const cur = form.store.getSnapshot().fields;
      const patch = await syncContract({
        counterpartyUuid: uuid,
        organizationUuid: cur.organizationUuid,
        currentContractUuid: cur.contractUuid,
      });
      if (patch) form.setFields(patch as Partial<TFields>);
    }, [form.setFields, form.store, syncContract]);

    // Смена организации: зависимые поля (договор, склад если есть) →
    // дефолт пользователя для новой орг, иначе очистка.
    const handleOrganizationSelect = useCallback(async (uuid: string, displayValue: string, item?: Record<string, any>) => {
      const cur = form.store.getSnapshot().fields;
      if (cur.organizationUuid === uuid) return;
      const patch0: Partial<TFields> = { organizationUuid: uuid, organizationName: displayValue };
      // ЭСФ: грузоотправитель = организация; категория поставщика — из карточки организации.
      if (cfg.hasEsf) {
        patch0.esfConsignorUuid = uuid; patch0.esfConsignorName = displayValue;
        if (item?.enterpriseCategory) patch0.esfSellerType = item.enterpriseCategory;
      }
      form.setFields(patch0);
      const orgFields: Array<{ valueType: "warehouse" | "contract"; uuidKey: string; nameKey: string }> = [
        { valueType: "contract", uuidKey: "contractUuid", nameKey: "contractName" },
      ];
      if (cfg.hasWarehouse) orgFields.push({ valueType: "warehouse", uuidKey: "warehouseUuid", nameKey: "warehouseName" });
      const patch = await resolveOrgChangeFields(uuid, currentUser?.uuid ?? "", orgFields);
      form.setFields(patch as Partial<TFields>);
    }, [form.setFields, form.store, currentUser?.uuid]);

    const contractScope = useMemo<Record<string, string> | null>(() => {
      if (!form.fields.organizationUuid) return null;
      const s: Record<string, string> = { organizationUuid: form.fields.organizationUuid };
      if (form.fields.counterpartyUuid) s.counterpartyUuid = form.fields.counterpartyUuid;
      return s;
    }, [form.fields.organizationUuid, form.fields.counterpartyUuid]);
    useAutoFillPrimary({
      endpoint: "contracts", scope: contractScope, currentUuid: form.fields.contractUuid,
      isEditMode: form.isEditMode, isLoading: form.isLoading,
      apply: (uuid, name) => form.setFieldsInitial({ contractUuid: uuid, contractName: name } as Partial<TFields>),
    });

    const permDefaults = useUserDefaults(
      currentUser?.uuid ?? "",
      form.fields.organizationUuid,
    );
    permDefaultsRef.current = permDefaults;
    useApplyUserDefaults({
      defaults: permDefaults,
      organizationUuid: form.fields.organizationUuid,
      isEditMode: form.isEditMode,
      isLoading: form.isLoading,
      fieldMappings: [{ type: "contract", uuidKey: "contractUuid", nameKey: "contractName" }],
      currentValues: { contractUuid: form.fields.contractUuid },
      apply: (fields) => form.setFieldsInitial(fields as Partial<TFields>),
    });

    const handleTotalChange = useCallback((total: number, rows?: TDataItem[]) => {
      form.setField("amount", Number(total));
      if (rows) {
        const vatSum = rows.reduce((s, r) => s + (Number(r.vatAmount) || 0), 0);
        const discSum = rows.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0);
        const amtWithoutVat = Math.round((total - vatSum) * 100) / 100;
        form.setFields({
          vatAmount: Number(Math.round(vatSum * 100) / 100),
          discountAmount: Number(Math.round(discSum * 100) / 100),
          amountWithoutVat: Number(amtWithoutVat),
        } as Partial<TFields>);
      }
    }, [form.setField, form.setFields]);

    const assignNumber = useAssignNumber();
    const tabs = useMemo(() => [
      {
        id: "tab-details", label: translate("general"), component: (
          <div className={styles.FormContainer}>
            <div className={styles.FormWrapper}>
              <GroupCol className={styles.Form}>
                {/* ── Левая колонка: поля ── */}
                {basisLock && (
                  <HelpBox title="🔒 Поля заблокированы — документ заполнен по основанию">
                    <p>
                      Поля и позиции этого документа недоступны для ручного
                      редактирования, потому что он создан <b>на основании</b> документа
                      {form.fields.basisDocumentLabel ? <>: «{form.fields.basisDocumentLabel}»</> : null}.
                      Значения берутся из документа-основания и синхронизируются с ним.
                    </p>
                    <p>
                      Чтобы редактировать вручную — <b>очистите поле «Основание»</b> внизу
                      формы (кнопка очистки в этом поле). После очистки поля разблокируются.
                    </p>
                  </HelpBox>
                )}
                <GroupRow className={styles.FormHeaderRow}>
                  <FieldDateTime label={translate("date")} name={`${form.formUid}_date`} value={form.fields.date} onChange={e => form.setField("date", e.target.value)} disabled={form.isLoading} width="200px" />
                  <Field label={translate("documentNumber")} name={`${form.formUid}_number`} value={form.fields.number} onChange={e => form.setField("number", e.target.value)} disabled={form.isLoading} width="200px" maxLength={9}
                    actions={[
                      { type: "assignNumber", onClick: () => void assignNumber(cfg.endpoint, form.fields.organizationUuid, form.fields.number, (n) => form.setField("number", n), form.fields.date, form.fields.uuid) },
                    ]} />
                </GroupRow>

                <Group>
                  <FormLookup form={form} field="organization" endpoint="organizations"
                    onSelect={handleOrganizationSelect}
                    disabled={form.isLoading || basisLock} />
                  {cfg.hasWarehouse && (
                    <FormLookup form={form} field="warehouse" endpoint="warehouses"
                      disabled={form.isLoading || basisLock}
                      extraParams={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : undefined}
                      createDefaults={form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid, organizationName: form.fields.organizationName } : undefined} />
                  )}
                </Group>

                <Group>
                  <FormLookup form={form} field="counterparty" endpoint="counterparties"
                    onSelect={handleCounterpartySelect}
                    disabled={form.isLoading || basisLock} />
                  <FormLookup form={form} field="contract" endpoint="contracts"
                    onSelect={handleContractSelect}
                    disabled={form.isLoading || basisLock}
                    extraParams={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid } : {}),
                    }}
                    createDefaults={{
                      ...(form.fields.organizationUuid ? { organizationUuid: form.fields.organizationUuid, organizationName: form.fields.organizationName } : {}),
                      ...(form.fields.counterpartyUuid ? { counterpartyUuid: form.fields.counterpartyUuid, counterpartyName: form.fields.counterpartyName } : {}),
                    }} />
                </Group>

                {cfg.basisConfig && (
                  <GroupCol>
                    <BasisDocumentField
                      allowedTypes={cfg.basisConfig.allowedTypes}
                      basisDocumentType={form.fields.basisDocumentType}
                      // Подбор основания — только документы организации этого документа.
                      organizationUuid={form.fields.organizationUuid}
                      organizationName={form.fields.organizationName}
                      counterpartyUuid={form.fields.counterpartyUuid}
                      counterpartyName={form.fields.counterpartyName}
                      warehouseUuid={form.fields.warehouseUuid}
                      warehouseName={form.fields.warehouseName}
                      basisDocumentUuid={form.fields.basisDocumentUuid}
                      basisDocumentLabel={form.fields.basisDocumentLabel}
                      formUid={form.formUid}
                      disabled={form.isLoading}
                      onSelect={(type, uuid, label) => form.setFields({ basisDocumentType: type, basisDocumentUuid: uuid, basisDocumentLabel: label } as Partial<TFields>)}
                      onClear={() => form.setFields({ basisDocumentType: "", basisDocumentUuid: "", basisDocumentLabel: "" } as Partial<TFields>)}
                      mismatch={basisMismatch.mismatch}
                      mismatchDetails={basisMismatch.differences}
                      hint={getDocumentFillHint(cfg.docType, form.fields as unknown as Record<string, unknown>)}
                    />
                  </GroupCol>
                )}

                {/* Реквизиты ЭСФ вынесены в отдельную вкладку «Метаданные ЭСФ» (tab-esf). */}
              </GroupCol>
              <GroupCol className={styles.FormTotals}>
                <DocumentTotals
                  amount={form.fields.amount}
                  vatAmount={form.fields.vatAmount}
                  discountAmount={form.fields.discountAmount}
                  amountWithoutVat={form.fields.amountWithoutVat}
                  isVatEnabled={isVatEnabled}
                  useDiscount={useDiscount}
                />
              </GroupCol>
              <GroupCol className={styles.FormNotice}>
                <Notice items={notices} />
                {cfg.hasEsf && <Notice items={esfNotices} />}
              </GroupCol>
            </div>
            <GroupRow>
              <Field label={translate("Comment")} name={`${form.formUid}_comment`} value={form.fields.comment} onChange={e => form.setField("comment", e.target.value)} disabled={form.isLoading} />
              <Field label={translate("Author")} name={`${form.formUid}_author`} value={form.fields.authorName || ""} disabled width="auto" />
            </GroupRow>
          </div>
        )
      },
      {
        id: "tab-items", label: cfg.itemsTabLabel, component: (
          <TradeDocumentItemsTable
            parentUuid={form.fields.uuid ?? ""} parentField={cfg.itemsParentField}
            endpoint={cfg.itemsEndpoint} componentName={cfg.itemsComponentName}
            organizationUuid={form.fields.organizationUuid} documentDate={form.fields.date || null}
            disabled={form.isLoading}
            disableAddRows={basisLock}
            disableDeleteRows={basisLock}
            fieldsReadOnly={basisLock}
            deferRemoteChanges
            onRefresh={hasBasis ? () => void handleRefillFromBasis(true) : undefined}
            parentLabel={`${cfg.formLabel}: ID ${form.fields.id ?? "?"}${form.fields.date ? " - " + getFormatDateOnly(String(form.fields.date)) : ""}`}
            key={itemsTableKey}
            initialPendingRows={itemsTableKey > 0 ? basisItems : (items.pending.length > 0 ? items.pending : basisItems)}
            onTotalChange={handleTotalChange}
            onItemsChange={items.onItemsChange}
            onAllItemsChange={(rows) => { allItemsRef.current = rows; }}
            showRequiredHighlight
            defaultHiddenColumns={cfg.defaultHiddenItemColumns}
            showEsfColumns={cfg.hasEsf}
          />
        )
      },
      // Вкладка «Метаданные ЭСФ» — только для СФ исходящей (cfg.hasEsf).
      ...(cfg.hasEsf ? [{
        id: "tab-esf", label: translate("esfMetaTab"), component: (
          <div className={styles.FormContainer}>
            <GroupCol className={styles.Form}>
              <HelpBox title="❔ Как отправить ЭСФ в ИС ЭСФ">
                <p><b>1.</b> Проведите документ и заполните реквизиты. <b>2.</b> В шапке — кнопка
                  «{translate("esf")}» → «{translate("esfSignAndSend")}»: система соберёт XML, вы подпишете
                  его ЭЦП в NCALayer, и документ уйдёт в ИС ЭСФ (нужен запущенный NCALayer и ключ ЭЦП).</p>
                <p><b>3.</b> После отправки статус <b>SENT/PROCESSING</b> — в обработке; нажмите
                  «{translate("esfRefreshStatus")}», чтобы увидеть итог: <b>DELIVERED/CONFIRMED</b> — принято,
                  <b> FAILED/DECLINED</b> — ошибка (см. «{translate("esfShowErrors")}»).</p>
              </HelpBox>
              <Group>
                <FieldSelect label={translate("esfInvoiceTypeLabel")} name={`${form.formUid}_esfInvoiceType`}
                  value={form.fields.esfInvoiceType} disabled={form.isLoading}
                  onChange={(e) => form.setFields({ esfInvoiceType: e.target.value, ...(e.target.value === "" || e.target.value === "ORDINARY_INVOICE" ? { esfRelatedInvoiceUuid: "", esfRelatedInvoiceName: "" } : {}) } as Partial<TFields>)}
                  options={[{ value: "", label: "—" }, ...(esfDict?.invoiceType ?? []).map((o) => ({ value: o.code, label: o.label || o.code }))]} />
                {form.fields.esfInvoiceType && form.fields.esfInvoiceType !== "ORDINARY_INVOICE" && (
                  <FormLookup form={form} field="esfRelatedInvoice" endpoint="outgoing-invoices" displayField="number" disabled={form.isLoading}
                    createDefaults={{
                      organizationUuid: form.fields.organizationUuid, organizationName: form.fields.organizationName,
                      counterpartyUuid: form.fields.counterpartyUuid, counterpartyName: form.fields.counterpartyName,
                    }} />
                )}
              </Group>
              <Group>
                <FieldSelect label={translate("esfSellerCategory")} name={`${form.formUid}_esfSellerType`}
                  value={form.fields.esfSellerType} disabled={form.isLoading}
                  onChange={(e) => form.setField("esfSellerType", e.target.value)}
                  options={[{ value: "", label: "—" }, ...(esfDict?.sellerType ?? []).map((o) => ({ value: o.code, label: o.label || o.code }))]} />
                <FieldSelect label={translate("esfCustomerCategory")} name={`${form.formUid}_esfCustomerType`}
                  value={form.fields.esfCustomerType} disabled={form.isLoading}
                  onChange={(e) => form.setField("esfCustomerType", e.target.value)}
                  options={[{ value: "", label: "—" }, ...(esfDict?.customerType ?? []).map((o) => ({ value: o.code, label: o.label || o.code }))]} />
              </Group>
              <Group>
                <FormLookup form={form} field="esfConsignor" endpoint="organizations" disabled={form.isLoading} />
                <FormLookup form={form} field="esfConsignee" endpoint="counterparties" disabled={form.isLoading} />
              </Group>
              {form.fields.esfCustomerType === "PUBLIC_OFFICE" && (
                <Group>
                  <Field label={translate("esfPoBik")} name={`${form.formUid}_esfPoBik`} value={form.fields.esfPoBik} onChange={(e) => form.setField("esfPoBik", e.target.value)} disabled={form.isLoading} />
                  <Field label={translate("esfPoIik")} name={`${form.formUid}_esfPoIik`} value={form.fields.esfPoIik} onChange={(e) => form.setField("esfPoIik", e.target.value)} disabled={form.isLoading} />
                  <Field label={translate("esfPoPayPurpose")} name={`${form.formUid}_esfPoPayPurpose`} value={form.fields.esfPoPayPurpose} onChange={(e) => form.setField("esfPoPayPurpose", e.target.value)} disabled={form.isLoading} />
                  <Field label={translate("esfPoProductCode")} name={`${form.formUid}_esfPoProductCode`} value={form.fields.esfPoProductCode} onChange={(e) => form.setField("esfPoProductCode", e.target.value)} disabled={form.isLoading} />
                </Group>
              )}
            </GroupCol>
          </div>
        )
      }] : []),
    ], [form.fields, form.formUid, form.isLoading, form.isEditMode, form.setField, form.setFields, handleContractSelect, handleOrganizationSelect, handleCounterpartySelect, handleTotalChange, canWrite, items, isVatEnabled, useDiscount, basisItems, itemsTableKey, basisMismatch, notices, assignNumber, esfDict]);

    return (
      <FormRequiredScope docType={cfg.docType} active>
        <FormDirtyScope dirtyKeys={form.unsavedFields}>
          {headerActionsPortal}
          <ModelForm paneId={form.paneId} tabs={tabs}
            onSave={form.handleSave} onSaveAndClose={form.handleSaveAndClose} onClose={form.handleClose}
            onReload={form.isEditMode ? form.handleReload : undefined}
            isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
            readonly={effectiveReadonly} />
        </FormDirtyScope>
      </FormRequiredScope>
    );
  };
  Form.displayName = cfg.formDisplayName;
  return Form;
}
