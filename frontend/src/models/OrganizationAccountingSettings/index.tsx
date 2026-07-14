import { FC, useEffect, useMemo, useRef, useState } from "react";
import { api } from "src/services/api/client";
import { Button } from "src/components/Button";
import { FIELD_WIDTH } from "src/components/Field/fieldWidths";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "src/i18";
import { showToast } from "src/components/UIToast";
import type { TDataItem, TColumn } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { FormLookup } from "src/components/Field/FormLookup";
import { Notice, type NoticeItem } from "src/components/Notice";
import { FieldDate } from "src/components/Field";
import { FieldNumber } from "src/components/Field";
import { GroupCol, GroupRow } from "src/components/UI";
import styles from "src/styles/main.module.scss";
import { useFormStore } from "src/hooks/useFormStore";
import { useUserAccessRight } from "src/hooks/useUserAccessRight";
import useOrgAccountingUsageStats from "src/hooks/useOrgAccountingUsageStats";
import { makePaneLabel } from "src/utils/buildPaneLabel";
import ModelForm from "src/components/ModelForm";
import ModelList from "src/components/ModelList";

const MODEL_ENDPOINT = "organization-accounting-settings";
const LIST_NAME = "OrganizationAccountingSettingsList";

interface TFields {
  id?: number;
  uuid?: string;
  organizationUuid: string | null;
  organizationName: string;
  /** Дата начала действия настроек (ISO yyyy-mm-dd для input). */
  startDate: string;
  /** Учитывать ли НДС в строках документов продажи. */
  useVat: boolean;
  /** Ставка НДС, % (ввод как строка). */
  vatRate: string;
  /** Способ расчёта НДС: INCLUDED — в сумме; ADDED — сверху. */
  vatCalculationMethod: "INCLUDED" | "ADDED";
  /** Включить колонки скидок в SaleItemsTable. */
  useDiscount: boolean;
  /** Включить колонки акциза в SaleItemsTable (НК РК ст. 463). */
  useExcise: boolean;
  /** Ставка акциза по умолчанию, % (ввод в форме как строка). */
  exciseRate: string;
  /** Метод расчёта себестоимости списания: AVERAGE — средняя; FIFO — по партиям. */
  costingMethod: "AVERAGE" | "FIFO";
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FIELDS: TFields = {
  organizationUuid: null,
  organizationName: "",
  startDate: todayIso(),
  useVat: false,
  vatRate: "12",
  vatCalculationMethod: "INCLUDED",
  useDiscount: false,
  useExcise: false,
  exciseRate: "0",
  costingMethod: "AVERAGE",
};

// ─────────────────────────────────────────────────────────────────────────
// Форма «Настройки учёта организации»: организация (LookupField), дата
// начала действия, переключатели «Использовать НДС» и «Использовать скидки»,
// числовая Ставка НДС, % и способ расчёта (сверху / в сумме) — активны только при useVat.
// Справочник «Ставки НДС» удалён — согласно НК РК Ставка НДС, % одна на организацию
// на дату.
// При сохранении создаётся новая ВЕРСИЯ параметров (со своей «Датой начала»), а
// прежняя остаётся в истории: документы прошлых периодов продолжают считаться по
// версии, действовавшей на их дату (см. backend/services/accountingSettings.js).
// Поэтому id растёт с каждым сохранением — это версии, а не мусор.
// ─────────────────────────────────────────────────────────────────────────
const OrganizationAccountingSettingsForm: FC<Partial<TPane>> = (paneProps) => {
  const { canWrite } = useUserAccessRight("OrganizationAccountingSetting");
  // Снимок ЗАГРУЖЕННОЙ версии параметров: подсказки строятся из сравнения с ним —
  // «что пользователь изменил», а не «что вообще может быть не так».
  const savedRef = useRef<TFields | null>(null);
  const savedSnapshot = (f: TFields): TFields => { savedRef.current = { ...f }; return f; };
  const [recomputing, setRecomputing] = useState(false);
  const queryClient = useQueryClient();

  const form = useFormStore<TFields>({
    endpoint: MODEL_ENDPOINT,
    storageKey: "organization-accounting-settings-form",
    defaultFields: DEFAULT_FIELDS,
    paneProps,
    mapServerToForm: (d, prev) => savedSnapshot({
      ...(prev ?? DEFAULT_FIELDS),
      ...d,
      organizationUuid: (d.organizationUuid as string) ?? null,
      organizationName:
        (d.organization as { name?: string } | null)?.name ?? "",
      startDate:
        typeof d.startDate === "string" && d.startDate
          ? String(d.startDate).slice(0, 10)
          : todayIso(),
      useVat: Boolean(d.useVat),
      vatRate:
        d.vatRate != null && d.vatRate !== "" ? String(d.vatRate) : "12",
      vatCalculationMethod:
        String(d.vatCalculationMethod ?? "INCLUDED").toUpperCase() === "ADDED"
          ? "ADDED"
          : "INCLUDED",
      useDiscount: Boolean(d.useDiscount),
      useExcise: Boolean(d.useExcise),
      exciseRate:
        d.exciseRate != null && d.exciseRate !== ""
          ? String(d.exciseRate)
          : "0",
      costingMethod:
        String(d.costingMethod ?? "AVERAGE").toUpperCase() === "FIFO"
          ? "FIFO"
          : "AVERAGE",
    }),
    buildPayload: (fd) => {
      const vatRateNum =
        fd.vatRate === "" || fd.vatRate == null ? 12 : Number(fd.vatRate);
      if (
        fd.useVat &&
        (!Number.isFinite(vatRateNum) || vatRateNum < 0 || vatRateNum > 100)
      )
        return "Ставка НДС, % должна быть от 0 до 100% (НК РК ст. 422; стандарт 12%)";
      const exciseRateNum =
        fd.exciseRate === "" || fd.exciseRate == null
          ? 0
          : Number(fd.exciseRate);
      if (fd.useExcise && (!Number.isFinite(exciseRateNum) || exciseRateNum < 0))
        return "Некорректная Ставка акциза, %";
      return {
        organizationUuid: fd.organizationUuid || null,
        startDate: fd.startDate || todayIso(),
        useVat: Boolean(fd.useVat),
        vatRate: fd.useVat ? vatRateNum : 0,
        vatCalculationMethod: fd.vatCalculationMethod ?? "INCLUDED",
        useDiscount: Boolean(fd.useDiscount),
        useExcise: Boolean(fd.useExcise),
        exciseRate: fd.useExcise ? exciseRateNum : 0,
        costingMethod: fd.costingMethod === "FIFO" ? "FIFO" : "AVERAGE",
      };
    },
    buildPaneLabel: (saved) => {
      const orgName = (saved as { organization?: { name?: string } } | null)
        ?.organization?.name;
      return makePaneLabel(
        LIST_NAME,
        "Настройки учёта организации",
        saved,
        orgName ?? "Глобальные",
      );
    },
    afterSave: () => {
      // Сбрасываем кэш активных настроек, чтобы SaleItemsTable
      // и др. подписчики useOrgAccountingSettings немедленно
      // увидели новое состояние НДС/скидок.
      void queryClient.invalidateQueries({
        queryKey: ["organization-accounting-settings", "active"],
      });
    },
  });

  // Статистика использования НДС/скидок/акциза в проведённых документах.
  // Если хотя бы один проведённый sale_item фактически использует НДС
  // (vatRate>0), скидку (сумма/%>0) или акциз (сумма/%>0) — соответствующий
  // переключатель в форме блокируется ПОЛНОСТЬЮ (в обе стороны: и
  // включить, и отключить нельзя), чтобы изменение настроек не повлияло
  // на уже проведённые документы и расчёты ЭСФ РК остались корректными.
  // Бэкенд дополнительно выполняет ту же проверку на POST/PUT (HTTP 409).
  const { stats: usageStats } = useOrgAccountingUsageStats(
    form.fields.organizationUuid,
  );
  const lockVat = usageStats.hasPostedVat;
  const lockDiscount = usageStats.hasPostedDiscount;
  const lockExcise = usageStats.hasPostedExcise;

  // ── Последствия правки — объясняем ПО ФАКТУ изменений ────────────────────────
  //
  // Параметры учёта версионируются: сохранение создаёт новую версию, а «Дата начала»
  // решает, С КАКОГО МОМЕНТА действуют новые правила. Отсюда две принципиально разные
  // ситуации, и пользователь обязан их различать:
  //
  //   • дата начала В БУДУЩЕМ или сегодня → уже проведённые документы не затрагиваются:
  //     они и дальше считаются по версии, действовавшей на их дату. Это БЕЗОПАСНАЯ правка,
  //     и об этом тоже нужно сказать — иначе пользователь боится трогать настройки;
  //
  //   • дата начала В ПРОШЛОМ → новые правила накрывают уже проведённые документы того
  //     периода: при пересчёте у них изменятся суммы/себестоимость. Это опасно, и молчать
  //     об этом нельзя.
  //
  // Поэтому подсказки строятся не «вообще», а из СРАВНЕНИЯ с загруженной версией.
  const changed = (k: keyof TFields) =>
    savedRef.current != null && form.fields[k] !== savedRef.current[k];

  const startsInPast = useMemo(() => {
    const d = form.fields.startDate;
    return !!d && d < todayIso();
  }, [form.fields.startDate]);

  const notices = useMemo<NoticeItem[]>(() => {
    const items: NoticeItem[] = [];

    // Что именно изменил пользователь и чем это грозит.
    const touched: string[] = [];
    if (changed("useVat")) touched.push(translate(form.fields.useVat ? "accChangeVatOn" : "accChangeVatOff"));
    if (changed("vatRate")) touched.push(translate("accChangeVatRate"));
    if (changed("vatCalculationMethod")) touched.push(translate("accChangeVatMethod"));
    if (changed("useDiscount")) touched.push(translate(form.fields.useDiscount ? "accChangeDiscountOn" : "accChangeDiscountOff"));
    if (changed("useExcise")) touched.push(translate(form.fields.useExcise ? "accChangeExciseOn" : "accChangeExciseOff"));
    if (changed("costingMethod")) touched.push(translate("accChangeCosting"));

    if (touched.length > 0) {
      const list = touched.join("; ");
      if (startsInPast) {
        // Дата начала в прошлом — правка накрывает уже проведённые документы.
        items.push({ type: "warning", text: `${list}. ${translate("accImpactPast")}` });
      } else {
        // Дата начала сегодня/в будущем — прошлое не пересчитается.
        items.push({ type: "success", text: `${list}. ${translate("accImpactSafe")}` });
      }
    } else if (changed("startDate") && startsInPast) {
      items.push({ type: "warning", text: translate("accImpactPast") });
    }

    // Заблокированные параметры: объясняем ПОЧЕМУ, а не просто гасим контрол.
    if (lockVat || lockDiscount || lockExcise) {
      items.push({ type: "warning", text: translate("accSettingsLockedNote") });
    }

    // Как вообще работает сохранение — всегда, это не зависит от правок.
    items.push({ type: "attention", text: translate("accSettingsVersioningNote") });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.fields.useVat, form.fields.vatRate, form.fields.vatCalculationMethod,
    form.fields.useDiscount, form.fields.useExcise, form.fields.costingMethod,
    form.fields.startDate, startsInPast, lockVat, lockDiscount, lockExcise,
  ]);

  const tabs = useMemo(
    () => [
      {
        id: "tab-details",
        label: translate("general"),
        component: (
          <div className={styles.FormWrapper}>
            <div className={styles.Form}>
              <GroupRow>
                <FormLookup
                  form={form}
                  field="organization"
                  endpoint="organizations"
                  width={FIELD_WIDTH.lg}
                  disabled={form.isLoading || !canWrite}
                  onClear={() =>
                    form.setFields({ organizationUuid: null, organizationName: "" })
                  }
                />
                <FieldDate
                  label={translate("startDate")}
                  name={`${form.formUid}_startDate`}
                  value={form.fields.startDate}
                  onChange={(e) => form.setField("startDate", e.target.value)}
                  disabled={form.isLoading || !canWrite}
                  minWidth="180px"
                  required
                />
                <span className={styles.SettingHint}>
                  Если организация не выбрана — настройки считаются глобальными.
                  Дата используется для исторических запросов.
                </span>
              </GroupRow>

              <GroupRow className={styles.SectionGap}>
                <label
                  className={[styles.SettingChip, form.fields.useVat && styles.SettingChipActive, !canWrite && styles.SettingChipReadonly].filter(Boolean).join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.fields.useVat)}
                    onChange={(e) => {
                      const useVat = e.target.checked;
                      form.setFields({ useVat });
                    }}
                    disabled={form.isLoading || !canWrite || lockVat}
                    title={
                      lockVat
                        ? "Нельзя изменить флаг НДС: есть проведённые документы со ставкой НДС"
                        : undefined
                    }
                  />
                  <span className={styles.SettingLabelStrong}>{translate("useVat")}</span>
                </label>
                <FieldNumber
                  label={translate("vatRate")}
                  name={`${form.formUid}_vatRate`}
                  value={form.fields.vatRate ?? "12"}
                  onChange={(e) => form.setField("vatRate", e.target.value)}
                  disabled={form.isLoading || !canWrite || !form.fields.useVat || lockVat}
                  step="0.01"
                  min="0"
                  max="100"
                  decimals={2}
                  width="140px"
                />
                <label
                  className={[styles.SettingChip, !(canWrite && form.fields.useVat) && styles.SettingChipReadonly].filter(Boolean).join(" ")}
                >
                  <span className={styles.SettingSubLabel}>Способ расчёта:</span>
                  <select
                    value={form.fields.vatCalculationMethod}
                    onChange={(e) => {
                      const next = e.target.value === "ADDED" ? "ADDED" : "INCLUDED";
                      // «В сумме» ↔ «сверху» меняет расчёт сумм строк во ВСЕХ документах,
                      // где действуют эти настройки: итоги и НДС станут другими.
                      if (form.isEditMode && next !== form.fields.vatCalculationMethod) {
                        showToast(
                          "Смена способа расчёта НДС изменит суммы и НДС в документах, где действуют эти настройки",
                          "warning",
                        );
                      }
                      form.setField("vatCalculationMethod", next);
                    }}
                    disabled={form.isLoading || !canWrite || !form.fields.useVat || lockVat}
                  >
                    <option value="INCLUDED">В сумме (в т.ч.)</option>
                    <option value="ADDED">Сверху</option>
                  </select>
                </label>
                <span className={styles.SettingHint}>
                  НК РК: стандартная Ставка НДС, % — 12%, расчёт «в сумме»
                  или «сверху» определяется учётной политикой организации.
                </span>
              </GroupRow>

              <GroupRow className={styles.SectionGap}>
                <label
                  className={[styles.SettingChip, !canWrite && styles.SettingChipReadonly].filter(Boolean).join(" ")}
                >
                  <span className={styles.SettingSubLabel}>Метод себестоимости:</span>
                  <select
                    value={form.fields.costingMethod}
                    onChange={(e) => {
                      const next = e.target.value === "FIFO" ? "FIFO" : "AVERAGE";
                      // Смена метода себестоимости переигрывает COGS всех документов
                      // организации с даты этих настроек — суммы в проводках и отчётах
                      // изменятся. Потенциально дорогая ошибка → предупреждаем.
                      if (form.isEditMode && next !== form.fields.costingMethod) {
                        showToast(
                          "Смена метода себестоимости пересчитает COGS всех документов с даты настроек — суммы в проводках и отчётах изменятся",
                          "warning",
                        );
                      }
                      form.setField("costingMethod", next);
                    }}
                    disabled={form.isLoading || !canWrite}
                  >
                    <option value="AVERAGE">Средняя (скользящая)</option>
                    <option value="FIFO">ФИФО (по партиям)</option>
                  </select>
                </label>
                <span className={styles.SettingHint}>
                  Способ списания себестоимости ТМЗ: средняя или ФИФО (первая партия
                  прихода списывается первой). Применяется к реализации, перемещению и
                  возврату от покупателя.
                </span>
              </GroupRow>

              <GroupRow className={styles.SectionGap}>
                <Button
                  variant="secondary"
                  disabled={recomputing || form.isLoading || !canWrite || !form.fields.organizationUuid}
                  onClick={async () => {
                    const org = form.fields.organizationUuid;
                    if (!org) { alert("Сначала выберите организацию"); return; }
                    if (!confirm("Пересчитать себестоимость и проводки по открытому периоду этой организации? Закрытые периоды не затрагиваются. Операция идемпотентна.")) return;
                    setRecomputing(true);
                    try {
                      const resp = await api.post<{ registers?: number; entries?: number }>(
                        "accounting/recompute-costing", { organizationUuid: org },
                      );
                      await queryClient.invalidateQueries();
                      alert(`Готово. Пересчитано документов: регистр — ${resp?.registers ?? 0}, проводки — ${resp?.entries ?? 0}.`);
                    } catch (e) {
                      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
                      alert(msg || "Ошибка пересчёта");
                    } finally {
                      setRecomputing(false);
                    }
                  }}
                >
                  {recomputing ? "Пересчёт…" : "Пересчитать себестоимость"}
                </Button>
                <span className={styles.SettingHint}>
                  Ретроактивный пересчёт после ввода документов задним числом: заново
                  строит регистр и проводки (COGS) по открытому периоду. Закрытые
                  периоды не затрагиваются. Безопасно запускать повторно.
                </span>
              </GroupRow>

              <GroupRow className={styles.SectionGap}>
                <label
                  className={[styles.SettingChip, form.fields.useDiscount && styles.SettingChipActive, !canWrite && styles.SettingChipReadonly].filter(Boolean).join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.fields.useDiscount)}
                    onChange={(e) => form.setField("useDiscount", e.target.checked)}
                    disabled={form.isLoading || !canWrite || lockDiscount}
                    title={
                      lockDiscount
                        ? "Нельзя изменить флаг скидок: есть проведённые документы со Сумма скидкими"
                        : undefined
                    }
                  />
                  <span className={styles.SettingLabelStrong}>{translate("useDiscount")}</span>
                </label>
                <span className={styles.SettingHint}>
                  При включении в строках документов продажи отображаются колонки
                  «Процент скидки» и «Сумма скидки».
                </span>
              </GroupRow>

              <GroupRow className={styles.SectionGap}>
                <label
                  className={[styles.SettingChip, form.fields.useExcise && styles.SettingChipActive, !canWrite && styles.SettingChipReadonly].filter(Boolean).join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.fields.useExcise)}
                    onChange={(e) => form.setField("useExcise", e.target.checked)}
                    disabled={form.isLoading || !canWrite || lockExcise}
                    title={
                      lockExcise
                        ? "Нельзя изменить флаг акциза: есть проведённые документы с акцизом"
                        : undefined
                    }
                  />
                  <span className={styles.SettingLabelStrong}>{translate("useExcise")}</span>
                </label>
                <span className={styles.SettingHint}>
                  При включении в строках документов продажи отображаются колонки
                  «Ставка акциза, %» и «Сумма акциза» (НК РК ст. 463).
                </span>
              </GroupRow>

              <GroupRow className={styles.SectionGap}>
                <FieldNumber
                  label={translate("exciseRate")}
                  name="exciseRate"
                  value={form.fields.exciseRate ?? "0"}
                  onChange={(e) => form.setField("exciseRate", e.target.value)}
                  disabled={form.isLoading || !canWrite || !form.fields.useExcise || lockExcise}
                  step="0.01"
                  min="0"
                  decimals={4}
                  width="200px"
                />
                <span className={styles.SettingHint}>
                  Подставляется в новые строки документов продажи как значение
                  по умолчанию (можно скорректировать в каждой строке).
                </span>
              </GroupRow>
            </div>
            {/* Notice — отдельной колонкой справа (эталон: models/Sales). Первым
                элементом среди полей он разрывал форму и сдвигал их при появлении. */}
            <GroupCol className={styles.FormNotice}>
              <Notice items={notices} />
            </GroupCol>
          </div>
        ),
      },
    ],
    [
      form.fields,
      form.formUid,
      form.isLoading,
      form.setField,
      form.setFields,
      canWrite,
      lockVat,
      lockDiscount,
      lockExcise,
      notices,
    ],
  );

  return (
    <ModelForm
      paneId={form.paneId}
      tabs={tabs}
      onSave={form.handleSave}
      onSaveAndClose={form.handleSaveAndClose}
      onClose={form.handleClose}
      onReload={form.isEditMode ? form.handleReload : undefined}
      isLoading={form.isLoading} isInitialLoading={form.isInitialLoading}
      readonly={!canWrite}
    />
  );
};
OrganizationAccountingSettingsForm.displayName = "OrganizationAccountingSettingsForm";

// ─────────────────────────────────────────────────────────────────────────
// Список
// ─────────────────────────────────────────────────────────────────────────
const renderListCell = (row: TDataItem, col: TColumn) => {
  if (col.identifier === "organization.name") {
    const org = row.organization as { name?: string } | null | undefined;
    if (!org?.name)
      return (
        <span className={styles.MutedItalic}>Глобальные</span>
      );
    return <span>{org.name}</span>;
  }
  if (col.identifier === "vatRate") {
    const useVat = Boolean(row.useVat);
    if (!useVat) return <span className={styles.Muted}>—</span>;
    const r = row.vatRate;
    return <span>{r != null ? `${r}%` : "—"}</span>;
  }
  if (col.identifier === "vatCalculationMethod") {
    const useVat = Boolean(row.useVat);
    if (!useVat) return <span className={styles.Muted}>—</span>;
    const m = String(row.vatCalculationMethod ?? "INCLUDED").toUpperCase();
    return <span>{m === "ADDED" ? "Сверху" : "В сумме"}</span>;
  }
  if (col.identifier === "costingMethod") {
    const m = String(row.costingMethod ?? "AVERAGE").toUpperCase();
    return <span>{m === "FIFO" ? "ФИФО" : "Средняя"}</span>;
  }
  if (col.identifier === "useVat") {
    return <span>{row.useVat ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "useDiscount") {
    return <span>{row.useDiscount ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "useExcise") {
    return <span>{row.useExcise ? "Да" : "Нет"}</span>;
  }
  if (col.identifier === "startDate") {
    const v = row.startDate as string | null | undefined;
    if (!v) return <span className={styles.Muted}>—</span>;
    return <span>{String(v).slice(0, 10)}</span>;
  }
  return undefined;
};

const OrganizationAccountingSettingsList: FC<{
  variant?: TTableVariant;
  onSelectItem?: (item: TDataItem) => void;
}> = ({ variant, onSelectItem }) => {
  // При монтировании списка инвалидируем кэш «активных», чтобы SaleItemsTable
  // увидел свежие настройки сразу.
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({
      queryKey: ["organization-accounting-settings", "active"],
    });
  }, [qc]);

  return (
    <ModelList
      endpoint={MODEL_ENDPOINT}
      listName={LIST_NAME}
      columnsJson={columnsJson}
      FormComponent={OrganizationAccountingSettingsForm}
      getLabel={(d) =>
        ((d?.organization as { name?: string } | null)?.name as string) ||
        "Глобальные"
      }
      variant={variant}
      onSelectItem={onSelectItem}
      renderCell={renderListCell}
    />
  );
};
OrganizationAccountingSettingsList.displayName = "OrganizationAccountingSettingsList";

export {
  OrganizationAccountingSettingsList,
  OrganizationAccountingSettingsForm,
};
