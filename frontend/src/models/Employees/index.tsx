import { FC, useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useAppContext } from "src/app";
import { getModelColumns } from "src/components/Table/services";
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import type { TPane } from "src/app/types";
import Table, { TOpenModelFormProps } from "src/components/Table";
import type { TTableVariant } from "src/components/Table";
import columnsJson from "./columns.json";
import { useInfiniteModelList, GLOBAL_ADAPTIVE_LIMIT_REF } from "src/hooks/useInfiniteModelList";
import useQueryParams from "src/hooks/useQueryParams";
import { useQueryClient } from "@tanstack/react-query";
import { useModelDelete } from "src/hooks/useModelDelete";
import { Divider, Field } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import reload_16 from "src/assets/reload_16.png";
import Tabs from "src/components/Tabs";
import { ContactsList } from "../Contacts";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

const MODEL_ENDPOINT = "employees";
const LIST_NAME = "EmployeesList";
const FORM_LABEL = "Сотрудник";

// ═══════════════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════════════

interface TFormData {
  id?: number;
  uuid?: string;
  lastName: string;
  firstName: string;
  middleName: string;
  fullName: string;
  iin: string;
  organizationUuid: string;
  organizationName: string;
  avatarPath: string;
}

const EMPTY_FORM: TFormData = {
  lastName: "", firstName: "", middleName: "", fullName: "", iin: "",
  organizationUuid: "", organizationName: "", avatarPath: "",
};

// ── Типы для истории и прав доступа ────────────────────────────────────
interface THistoryRow {
  id?: number; uuid?: string;
  eventDate: string; eventType: string; salary: string;
  positionUuid: string; positionName: string;
}

interface TAccessRow {
  id?: number; uuid?: string;
  modelName: string; accessLevel: string;
}

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

const ACCESS_LEVEL_OPTIONS = [
  { value: "full", label: "Полный" },
  { value: "readonly", label: "Только чтение" },
  { value: "none", label: "Нет доступа" },
];

const MODEL_NAME_OPTIONS = [
  "Organizations", "Counterparties", "Contracts", "Sales", "Purchases",
  "Warehouses", "Products", "Brands", "Employees", "Contacts",
  "BankAccounts", "Currencies", "Todos", "Notifications",
  "OutgoingInvoices", "IncomingInvoices", "PaymentInvoices",
  "CashReceiptOrders", "CashExpenseOrders", "InventoryTransfers",
].map(v => ({ value: v, label: v }));

const EmployeesForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();
  const defaultOrg = useDefaultOrganization();

  const [formData, setFormData] = useState<TFormData>(() => ({
    ...EMPTY_FORM,
    organizationUuid: defaultOrg.organizationUuid,
    organizationName: defaultOrg.organizationName,
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(!!uuid);

  // ── Аватар ─────────────────────────────────────────────────────────────
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarBlobUrlRef = useRef<string | null>(null);

  // Освобождаем blob URL при размонтировании
  useEffect(() => {
    return () => {
      if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current);
    };
  }, []);

  const loadAvatar = useCallback(async (entityUuid: string) => {
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}/avatar`, { responseType: "blob" });
      if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current);
      const blobUrl = URL.createObjectURL(res.data);
      avatarBlobUrlRef.current = blobUrl;
      setAvatarUrl(blobUrl);
    } catch {
      setAvatarUrl(null);
    }
  }, []);

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !formData.uuid) return;
    const fd = new FormData();
    fd.append("avatar", file);
    try {
      await apiClient.post(`/${MODEL_ENDPOINT}/${formData.uuid}/avatar`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      loadAvatar(formData.uuid);
    } catch (err) { console.error("avatar upload error:", err); }
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }, [formData.uuid, loadAvatar]);

  const handleAvatarDelete = useCallback(async () => {
    if (!formData.uuid) return;
    try {
      await apiClient.delete(`/${MODEL_ENDPOINT}/${formData.uuid}/avatar`);
      if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current);
      avatarBlobUrlRef.current = null;
      setAvatarUrl(null);
    } catch (err) { console.error("avatar delete error:", err); }
  }, [formData.uuid]);

  // ── История сотрудника ─────────────────────────────────────────────────
  const [historyRows, setHistoryRows] = useState<THistoryRow[]>([]);
  const [editingHistory, setEditingHistory] = useState<THistoryRow | null>(null);

  const loadHistory = useCallback(async (empUuid: string) => {
    try {
      const res = await apiClient.get(`/employee-histories?employeeUuid=${empUuid}`);
      const items = res.data?.items ?? [];
      setHistoryRows(items.map((h: any) => ({
        id: h.id, uuid: h.uuid,
        eventDate: h.eventDate?.slice(0, 10) ?? "",
        eventType: h.eventType ?? "",
        salary: h.salary != null ? String(h.salary) : "",
        positionUuid: h.positionUuid ?? "",
        positionName: h.position?.shortName ?? "",
      })));
    } catch (err) { console.error("loadHistory error:", err); }
  }, []);

  const saveHistoryRow = useCallback(async (row: THistoryRow) => {
    if (!formData.uuid) return;
    const payload = {
      eventDate: row.eventDate || null,
      eventType: row.eventType,
      salary: row.salary ? parseFloat(row.salary) : null,
      positionUuid: row.positionUuid || null,
      employeeUuid: formData.uuid,
    };
    try {
      if (row.uuid) {
        await apiClient.put(`/employee-histories/${row.uuid}`, payload);
      } else {
        await apiClient.post(`/employee-histories`, payload);
      }
      loadHistory(formData.uuid);
      setEditingHistory(null);
    } catch (err) { console.error("saveHistory error:", err); }
  }, [formData.uuid, loadHistory]);

  const deleteHistoryRow = useCallback(async (rowUuid: string) => {
    try {
      await apiClient.delete(`/employee-histories/${rowUuid}`);
      if (formData.uuid) loadHistory(formData.uuid);
    } catch (err) { console.error("deleteHistory error:", err); }
  }, [formData.uuid, loadHistory]);

  // ── Права доступа ──────────────────────────────────────────────────────
  const [accessRows, setAccessRows] = useState<TAccessRow[]>([]);
  const [editingAccess, setEditingAccess] = useState<TAccessRow | null>(null);

  const loadAccess = useCallback(async (empUuid: string) => {
    try {
      const res = await apiClient.get(`/access-rights?employeeUuid=${empUuid}`);
      setAccessRows(res.data?.items ?? []);
    } catch (err) { console.error("loadAccess error:", err); }
  }, []);

  const saveAccessRow = useCallback(async (row: TAccessRow) => {
    if (!formData.uuid) return;
    const payload = {
      modelName: row.modelName,
      accessLevel: row.accessLevel,
      employeeUuid: formData.uuid,
    };
    try {
      if (row.uuid) {
        await apiClient.put(`/access-rights/${row.uuid}`, payload);
      } else {
        await apiClient.post(`/access-rights`, payload);
      }
      loadAccess(formData.uuid);
      setEditingAccess(null);
    } catch (err) { console.error("saveAccess error:", err); }
  }, [formData.uuid, loadAccess]);

  const deleteAccessRow = useCallback(async (rowUuid: string) => {
    try {
      await apiClient.delete(`/access-rights/${rowUuid}`);
      if (formData.uuid) loadAccess(formData.uuid);
    } catch (err) { console.error("deleteAccess error:", err); }
  }, [formData.uuid, loadAccess]);

  // ── Загрузка данных ────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        lastName: d.lastName ?? "", firstName: d.firstName ?? "",
        middleName: d.middleName ?? "", fullName: d.fullName ?? "", iin: d.iin ?? "",
        organizationUuid: d.organizationUuid ?? "",
        organizationName: d.organization?.shortName ?? "",
        avatarPath: d.avatarPath ?? "",
        id: d.id, uuid: d.uuid,
      });
      if (d.avatarPath) loadAvatar(d.uuid);
      else setAvatarUrl(null);
      loadHistory(d.uuid);
      loadAccess(d.uuid);
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, [loadAvatar, loadHistory, loadAccess]);

  useEffect(() => { if (uuid) loadFormData(uuid); }, [uuid, loadFormData]);

  const handleFieldChange = useCallback((field: keyof TFormData, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === "lastName" || field === "firstName" || field === "middleName") {
        next.fullName = [next.lastName, next.firstName, next.middleName].filter(Boolean).join(" ");
      }
      return next;
    });
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    setIsLoading(true); setError(null);
    if (!formData.lastName?.trim()) { setError("Фамилия обязательна"); setIsLoading(false); return false; }
    const payload = {
      lastName: formData.lastName.trim(),
      firstName: formData.firstName.trim(),
      middleName: formData.middleName.trim(),
      fullName: formData.fullName.trim(),
      iin: formData.iin.trim(),
      organizationUuid: formData.organizationUuid || null,
    };
    try {
      const res = isEditMode && (uuid || formData.uuid)
        ? await apiClient.put(`/${MODEL_ENDPOINT}/${uuid || formData.uuid}`, payload)
        : await apiClient.post(`/${MODEL_ENDPOINT}`, payload);
      const saved = res.data?.item ?? res.data;
      setFormData(prev => ({
        ...prev,
        lastName: saved.lastName ?? "", firstName: saved.firstName ?? "",
        middleName: saved.middleName ?? "", fullName: saved.fullName ?? "",
        iin: saved.iin ?? "",
        organizationUuid: saved.organizationUuid ?? prev.organizationUuid,
        organizationName: saved.organization?.shortName ?? prev.organizationName,
        avatarPath: saved.avatarPath ?? prev.avatarPath,
        id: saved.id, uuid: saved.uuid,
      }));
      setIsEditMode(true);
      if (uniqId) updatePaneLabel(uniqId, `${translate(LIST_NAME) || FORM_LABEL}: ${saved.fullName || saved.lastName || "?"} • ${saved.id ?? "?"}`);
      onSave?.(); return true;
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка сохранения"); return false; }
    finally { setIsLoading(false); }
  }, [formData, isEditMode, uuid, onSave, uniqId, updatePaneLabel]);

  const handleSave = useCallback(() => { submit(); }, [submit]);
  const handleSaveAndClose = useCallback(async () => { if (await submit()) { onClose?.(); if (uniqId) removePane(uniqId); } }, [submit, onClose, removePane, uniqId]);
  const handleClose = useCallback(() => { onClose?.(); if (uniqId) removePane(uniqId); }, [onClose, removePane, uniqId]);

  // ── Табы ────────────────────────────────────────────────────────────────
  const tabs = useMemo(() => {
    const result: { id: string; label: string; component: React.ReactNode }[] = [
      {
        id: "general", label: translate("general") || "Общие сведения", component: (
          <div className={styles.FormBodyParts}>
            <div style={{ display: "flex", flexDirection: "row", gap: "24px" }}>
              {/* Левая колонка — поля */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1, maxWidth: 640 }}>
                <Group align="row" gap="12px" className={styles.Form}>
                  <Field label="Фамилия *" name={`${formUid}_lastName`} minWidth="200px"
                    value={formData.lastName} onChange={e => handleFieldChange("lastName", e.target.value)} disabled={isLoading} />
                  <Field label="Имя" name={`${formUid}_firstName`} minWidth="180px"
                    value={formData.firstName} onChange={e => handleFieldChange("firstName", e.target.value)} disabled={isLoading} />
                  <Field label="Отчество" name={`${formUid}_middleName`} minWidth="180px"
                    value={formData.middleName} onChange={e => handleFieldChange("middleName", e.target.value)} disabled={isLoading} />
                </Group>
                <Group align="row" gap="12px" className={styles.Form}>
                  <Field label="ФИО" name={`${formUid}_fullName`} minWidth="400px" value={formData.fullName} disabled />
                </Group>
                <Group align="row" gap="12px" className={styles.Form}>
                  <Field label="ИИН" name={`${formUid}_iin`} minWidth="200px"
                    value={formData.iin} onChange={e => handleFieldChange("iin", e.target.value)} disabled={isLoading} />
                </Group>
                <Group align="row" gap="12px" className={styles.Form}>
                  <LookupField label="Основная организация" name={`${formUid}_org`}
                    value={formData.organizationUuid} displayValue={formData.organizationName}
                    endpoint="organizations" displayField="shortName"
                    onSelect={(u, d) => setFormData(prev => ({ ...prev, organizationUuid: u, organizationName: d }))}
                    onClear={() => setFormData(prev => ({ ...prev, organizationUuid: "", organizationName: "" }))}
                    disabled={isLoading} width="400px" />
                </Group>
                {isEditMode && (
                  <Group align="row" gap="12px" className={styles.Form}>
                    <Field label="ID" name={`${formUid}_id`} width="100px" value={String(formData.id ?? "-")} disabled />
                    <Field label="UUID" name={`${formUid}_uuid`} width="300px" value={String(formData.uuid ?? "-")} disabled />
                  </Group>
                )}
              </div>
              {/* Правая колонка — аватар */}
              {isEditMode && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", minWidth: 150 }}>
                  <div style={{
                    width: 128, height: 128, borderRadius: "50%", overflow: "hidden",
                    border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center",
                    background: "#f5f5f5", cursor: "pointer",
                  }}
                    onClick={() => avatarInputRef.current?.click()}
                    title="Нажмите для загрузки фото"
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Аватар" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={() => setAvatarUrl(null)} />
                    ) : (
                      <span style={{ fontSize: 48, color: "#bbb" }}>👤</span>
                    )}
                  </div>
                  <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarUpload} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => avatarInputRef.current?.click()}
                      style={{ fontSize: 12, cursor: "pointer", padding: "2px 8px", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>
                      Загрузить
                    </button>
                    {avatarUrl && (
                      <button type="button" onClick={handleAvatarDelete}
                        style={{ fontSize: 12, cursor: "pointer", padding: "2px 8px", border: "1px solid #ccc", borderRadius: 3, background: "#fff", color: "#c00" }}>
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ),
      },
    ];

    if (isEditMode && formData.uuid) {
      // ── Вкладка: История сотрудника ──────────────────────────────────
      result.push({
        id: "history", label: "Кадровая история", component: (
          <div className={styles.FormBodyParts}>
            <div style={{ marginBottom: 8 }}>
              <button type="button" onClick={() => setEditingHistory({ eventDate: new Date().toISOString().slice(0, 10), eventType: "hire", salary: "", positionUuid: "", positionName: "" })}
                style={{ padding: "4px 12px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>
                + Добавить запись
              </button>
            </div>
            {editingHistory && (
              <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 12, marginBottom: 12, background: "#fafafa", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 2 }}>Дата</label>
                  <input type="date" value={editingHistory.eventDate}
                    onChange={e => setEditingHistory(prev => prev ? { ...prev, eventDate: e.target.value } : prev)}
                    style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 2 }}>Тип события</label>
                  <select value={editingHistory.eventType}
                    onChange={e => setEditingHistory(prev => prev ? { ...prev, eventType: e.target.value } : prev)}
                    style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 3 }}>
                    {EVENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 2 }}>Должность</label>
                  <LookupField label="" name={`${formUid}_hist_pos`}
                    value={editingHistory.positionUuid} displayValue={editingHistory.positionName}
                    endpoint="positions" displayField="shortName"
                    onSelect={(u, d) => setEditingHistory(prev => prev ? { ...prev, positionUuid: u, positionName: d } : prev)}
                    onClear={() => setEditingHistory(prev => prev ? { ...prev, positionUuid: "", positionName: "" } : prev)}
                    width="200px" />
                </div>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 2 }}>Оклад</label>
                  <input type="number" value={editingHistory.salary}
                    onChange={e => setEditingHistory(prev => prev ? { ...prev, salary: e.target.value } : prev)}
                    style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 3, width: 120 }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => editingHistory && saveHistoryRow(editingHistory)}
                    style={{ padding: "4px 12px", cursor: "pointer", border: "1px solid #4caf50", borderRadius: 3, background: "#e8f5e9", color: "#2e7d32" }}>
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setEditingHistory(null)}
                    style={{ padding: "4px 12px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd" }}>Дата</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd" }}>Событие</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd" }}>Должность</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd" }}>Оклад</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd", width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map(row => (
                  <tr key={row.uuid} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 8px" }}>{row.eventDate}</td>
                    <td style={{ padding: "6px 8px" }}>{EVENT_TYPE_OPTIONS.find(o => o.value === row.eventType)?.label || row.eventType}</td>
                    <td style={{ padding: "6px 8px" }}>{row.positionName}</td>
                    <td style={{ padding: "6px 8px" }}>{row.salary}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <button type="button" onClick={() => setEditingHistory(row)} title="Редактировать"
                        style={{ cursor: "pointer", border: "none", background: "none", fontSize: 14 }}>✏️</button>
                      <button type="button" onClick={() => row.uuid && deleteHistoryRow(row.uuid)} title="Удалить"
                        style={{ cursor: "pointer", border: "none", background: "none", fontSize: 14, marginLeft: 4 }}>🗑️</button>
                    </td>
                  </tr>
                ))}
                {historyRows.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "12px 8px", color: "#999", textAlign: "center" }}>Нет записей</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      });

      // ── Вкладка: Права доступа ───────────────────────────────────────
      result.push({
        id: "access", label: "Права доступа", component: (
          <div className={styles.FormBodyParts}>
            <div style={{ marginBottom: 8 }}>
              <button type="button" onClick={() => setEditingAccess({ modelName: "", accessLevel: "none" })}
                style={{ padding: "4px 12px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>
                + Добавить право
              </button>
            </div>
            {editingAccess && (
              <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 12, marginBottom: 12, background: "#fafafa", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 2 }}>Модель</label>
                  <select value={editingAccess.modelName}
                    onChange={e => setEditingAccess(prev => prev ? { ...prev, modelName: e.target.value } : prev)}
                    style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 3 }}>
                    <option value="">— Выберите —</option>
                    {MODEL_NAME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, display: "block", marginBottom: 2 }}>Уровень доступа</label>
                  <select value={editingAccess.accessLevel}
                    onChange={e => setEditingAccess(prev => prev ? { ...prev, accessLevel: e.target.value } : prev)}
                    style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 3 }}>
                    {ACCESS_LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => editingAccess && saveAccessRow(editingAccess)}
                    style={{ padding: "4px 12px", cursor: "pointer", border: "1px solid #4caf50", borderRadius: 3, background: "#e8f5e9", color: "#2e7d32" }}>
                    Сохранить
                  </button>
                  <button type="button" onClick={() => setEditingAccess(null)}
                    style={{ padding: "4px 12px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd" }}>Модель</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd" }}>Доступ</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid #ddd", width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {accessRows.map(row => (
                  <tr key={row.uuid} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 8px" }}>{row.modelName}</td>
                    <td style={{ padding: "6px 8px" }}>{ACCESS_LEVEL_OPTIONS.find(o => o.value === row.accessLevel)?.label || row.accessLevel}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <button type="button" onClick={() => setEditingAccess(row)} title="Редактировать"
                        style={{ cursor: "pointer", border: "none", background: "none", fontSize: 14 }}>✏️</button>
                      <button type="button" onClick={() => row.uuid && deleteAccessRow(row.uuid)} title="Удалить"
                        style={{ cursor: "pointer", border: "none", background: "none", fontSize: 14, marginLeft: 4 }}>🗑️</button>
                    </td>
                  </tr>
                ))}
                {accessRows.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: "12px 8px", color: "#999", textAlign: "center" }}>Нет записей</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      });

      // ── Вкладка: Контакты ────────────────────────────────────────────
      result.push({
        id: "contacts", label: translate("ContactsList") || "Контакты", component: (
          <ContactsList ownerUuid={formData.uuid} ownerField="employeeUuid" ownerName={formData.fullName || formData.lastName} />
        ),
      });
    }

    return result;
  }, [formUid, formData, isLoading, isEditMode, handleFieldChange, avatarUrl, handleAvatarUpload, handleAvatarDelete,
    historyRows, editingHistory, saveHistoryRow, deleteHistoryRow,
    accessRows, editingAccess, saveAccessRow, deleteAccessRow]);

  return (
    <div className={styles.FormWrapper}>
      <div className={styles.FormPanel}><div className={styles.TablePanelLeft}><div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
        <Button variant="primary" onClick={handleSaveAndClose} disabled={isLoading}><span>Сохранить и закрыть</span></Button><Divider />
        <Button onClick={handleSave} disabled={isLoading}><span>Сохранить</span></Button>
        <Button onClick={handleClose} disabled={isLoading}><span>Закрыть</span></Button><Divider />
        {isEditMode && <ButtonImage onClick={() => uuid && loadFormData(uuid)} title="Обновить" disabled={isLoading}><img src={reload_16} alt="Reload" height={16} width={16} className={isLoading ? styles.animationLoop : ""} /></ButtonImage>}
      </div></div><div className={styles.TablePanelRight} /></div>
      {error && <div style={{ color: "red", padding: "12px", margin: "8px 0", background: "#ffebee", borderRadius: "4px" }}>{error}</div>}
      <div className={styles.FormBody}>
        <Tabs tabs={tabs} />
      </div>
    </div>
  );
};
EmployeesForm.displayName = "EmployeesForm";

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

const stringifyJson = (v: any): string => { if (v == null) return ""; try { const s = JSON.stringify(v); return s === "{}" || s === "[]" ? "" : s; } catch { return ""; } };

interface EmployeesListProps { variant?: TTableVariant; onSelectItem?: (item: TDataItem) => void; }

const EmployeesList: FC<EmployeesListProps> = ({ variant = "default", onSelectItem } = {}) => {
  const componentName = LIST_NAME;
  const model = MODEL_ENDPOINT;
  const { addPane } = useAppContext().windows;
  const queryClient = useQueryClient();
  const t = (k: string) => translate(k) || k;

  const [columns, setColumns] = useState<TColumn[]>(() => getModelColumns(columnsJson, componentName));
  const [sort, setSort] = useQueryParams<Record<string, "asc" | "desc">>("sort", { id: "asc" }, undefined, { stringify: stringifyJson });
  const [search, setSearch] = useQueryParams<string>("search", "");
  const [filter, setFilter] = useQueryParams<Record<string, { value: unknown; operator: string }> | undefined>("filter", undefined, undefined, { stringify: stringifyJson });
  const [adaptiveLimit, setAdaptiveLimit] = useState(500);
  useEffect(() => { GLOBAL_ADAPTIVE_LIMIT_REF.current = adaptiveLimit; }, [adaptiveLimit]);
  const updateAdaptiveLimit = useCallback((n: number) => setAdaptiveLimit(n), []);
  const params = useMemo(() => ({ sort, search, filter }), [sort, search, filter]);
  const { allItems, total, isAnythingLoading, isFetchingNextPage, hasNextPage, error, refetch, fetchNextPage } = useInfiniteModelList<TDataItem>({ model, params, queryOptions: {} });


  const handleDelete = useModelDelete(model, refetch);
  const openModelForm = useCallback((formProps: TOpenModelFormProps) => {
    const d = formProps.data;
    const isEdit = !!d?.uuid;
    addPane({
      label: isEdit ? `${t(componentName)}: ${d?.fullName || d?.lastName || t("noName")} • ${d?.id ?? "?"}` : `${t(componentName)}: ${t("new")}`,
      component: EmployeesForm, data: d, onSave: () => refetch(), onClose: () => refetch(),
    });
  }, [addPane, t, refetch, componentName]);

  const cachedRowsRef = useRef<TDataItem[]>([]);
  const [cacheVersion, setCacheVersion] = useState(0);
  useEffect(() => { cachedRowsRef.current = allItems; setCacheVersion(v => v + 1); }, [allItems]);
  const rows = useMemo(() => cachedRowsRef.current, [cacheVersion]);
  const handleSortChange = useCallback((s: typeof sort) => { cachedRowsRef.current = []; setCacheVersion(0); updateAdaptiveLimit(500); setSort(s ?? { id: "asc" }); }, [setSort, updateAdaptiveLimit]);
  const handleFilterChange = useCallback((field: string, value: unknown, operator = "contains") => { setFilter((prev: typeof filter) => { const next = { ...(prev ?? {}) }; if (value == null || value === "") delete next[field]; else next[field] = { value, operator }; return Object.keys(next).length > 0 ? next : undefined; }); }, [setFilter]);
  const handleSearch = useCallback((v: string) => setSearch(v.trim()), [setSearch]);
  const clearFilters = useCallback(() => { setSearch(""); setFilter(undefined); }, [setSearch, setFilter]);
  const handleCleanRefresh = useCallback(() => { cachedRowsRef.current = []; setCacheVersion(0); setSearch(""); setFilter(undefined); setSort({ id: "asc" }); updateAdaptiveLimit(500); queryClient.resetQueries({ queryKey: [model] }); }, [queryClient, setSearch, setFilter, setSort, updateAdaptiveLimit]);

  const tableProps = useMemo(() => ({
    variant, onSelectItem, enableDateRange: false, componentName, rows, columns, total,
    totalPages: Math.ceil(total / adaptiveLimit), isLoading: isAnythingLoading, isFetching: isAnythingLoading, error, hasNextPage, isFetchingNextPage,
    pagination: { page: 1, limit: adaptiveLimit, onPageChange: () => { }, onLimitChange: () => { } },
    sorting: { sort, onSortChange: handleSortChange }, filtering: { filters: filter, onFilterChange: handleFilterChange, onClearAll: clearFilters },
    search: { value: search, onChange: handleSearch },
    actions: { openModelForm, refetch: handleCleanRefresh, setColumns, fetchNextPage, setAdaptiveLimit: updateAdaptiveLimit },
    onDelete: handleDelete,
  }), [variant, onSelectItem, componentName, rows, columns, total, adaptiveLimit, isAnythingLoading, error, sort, search, filter, handleSortChange, handleFilterChange, handleSearch, clearFilters, openModelForm, setColumns, hasNextPage, isFetchingNextPage, fetchNextPage, updateAdaptiveLimit, handleCleanRefresh, handleDelete]);

  if (error) return <div className="error-container"><div className="error-message"><h3>Ошибка загрузки</h3><p>{(error as Error)?.message}</p><button onClick={() => refetch()} className="retry-button">Повторить</button></div></div>;
  return <Table {...tableProps} />;
};
EmployeesList.displayName = "EmployeesList";
export { EmployeesList, EmployeesForm };
