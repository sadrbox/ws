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
import { Divider, Field, FieldNumber, FieldSelect } from "src/components/Field";
import LookupField from "src/components/Field/LookupField";
import { Group } from "src/components/UI";
import useUID from "src/hooks/useUID";
import { Button, ButtonImage } from "src/components/Button";
import apiClient from "src/services/api/client";
import styles from "src/styles/main.module.scss";
import tableStyles from "src/components/Table/Table.module.scss";
import reload_16 from "src/assets/reload_16.png";
import Tabs from "src/components/Tabs";
import { ContactsList } from "../Contacts";

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
  avatarPath: string;
}

const EMPTY_FORM: TFormData = {
  lastName: "", firstName: "", middleName: "", fullName: "", iin: "",
  avatarPath: "",
};

// ── Типы для истории и прав доступа ────────────────────────────────────
interface THistoryRow {
  id?: number; uuid?: string;
  eventDate: string; eventType: string; salary: string;
  positionUuid: string; positionName: string;
  organizationUuid: string; organizationName: string;
  isDirty?: boolean; isNew?: boolean;
}

const EVENT_TYPE_OPTIONS = [
  { value: "hire", label: "Приём" },
  { value: "fire", label: "Увольнение" },
  { value: "transfer", label: "Перемещение" },
];

const EmployeesForm: FC<Partial<TPane>> = ({ onSave, onClose, data, uniqId }) => {
  const uuid = data?.uuid as string | undefined;
  const { windows: { removePane, updatePaneLabel } } = useAppContext();
  const formUid = useUID();

  const [formData, setFormData] = useState<TFormData>(() => ({
    ...EMPTY_FORM,
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
  const [activeHistoryIdx, setActiveHistoryIdx] = useState<number | null>(null);

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
        organizationUuid: h.organizationUuid ?? "",
        organizationName: h.organization?.shortName ?? "",
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
      organizationUuid: row.organizationUuid || null,
      employeeUuid: formData.uuid,
    };
    try {
      if (row.uuid) {
        await apiClient.put(`/employee-histories/${row.uuid}`, payload);
      } else {
        await apiClient.post(`/employee-histories`, payload);
      }
      loadHistory(formData.uuid);
    } catch (err) { console.error("saveHistory error:", err); }
  }, [formData.uuid, loadHistory]);

  const deleteHistoryRow = useCallback(async (rowUuid: string) => {
    try {
      await apiClient.delete(`/employee-histories/${rowUuid}`);
      if (formData.uuid) loadHistory(formData.uuid);
    } catch (err) { console.error("deleteHistory error:", err); }
  }, [formData.uuid, loadHistory]);

  const updateHistoryRow = useCallback((idx: number, field: keyof THistoryRow, value: string) => {
    setHistoryRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value, isDirty: true };
      return next;
    });
  }, []);

  const addHistoryRow = useCallback(() => {
    setHistoryRows(prev => {
      const row: THistoryRow = {
        eventDate: new Date().toISOString().slice(0, 10),
        eventType: "hire", salary: "",
        positionUuid: "", positionName: "",
        organizationUuid: "", organizationName: "",
        isNew: true, isDirty: true,
      };
      const next = [...prev, row];
      setActiveHistoryIdx(next.length - 1);
      return next;
    });
  }, []);

  const deleteHistoryByIdx = useCallback(async (idx: number) => {
    const row = historyRows[idx];
    if (!row) return;
    if (row.isNew) {
      setHistoryRows(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    if (row.uuid) await deleteHistoryRow(row.uuid);
  }, [historyRows, deleteHistoryRow]);

  const saveHistoryByIdx = useCallback(async (idx: number) => {
    const row = historyRows[idx];
    if (row) await saveHistoryRow(row);
  }, [historyRows, saveHistoryRow]);

  const saveAllDirtyHistory = useCallback(async () => {
    for (let i = 0; i < historyRows.length; i++) {
      if (historyRows[i].isDirty) await saveHistoryRow(historyRows[i]);
    }
  }, [historyRows, saveHistoryRow]);

  const hasDirtyHistory = useMemo(() => historyRows.some(r => r.isDirty), [historyRows]);

  // ── Загрузка данных ────────────────────────────────────────────────────
  const loadFormData = useCallback(async (entityUuid: string) => {
    setIsLoading(true); setError(null);
    try {
      const res = await apiClient.get(`/${MODEL_ENDPOINT}/${entityUuid}`);
      const d = res.data?.item ?? res.data;
      setFormData({
        lastName: d.lastName ?? "", firstName: d.firstName ?? "",
        middleName: d.middleName ?? "", fullName: d.fullName ?? "", iin: d.iin ?? "",
        avatarPath: d.avatarPath ?? "",
        id: d.id, uuid: d.uuid,
      });
      if (d.avatarPath) loadAvatar(d.uuid);
      else setAvatarUrl(null);
      loadHistory(d.uuid);
    } catch (err: any) { setError(err.response?.data?.message || "Ошибка загрузки"); }
    finally { setIsLoading(false); }
  }, [loadAvatar, loadHistory]);

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
      // ── Вкладка: Кадровая история (inline-таблица как SaleItemsTable) ──
      result.push({
        id: "history", label: "Кадровая история", component: (
          <div className={tableStyles.TableWrapper}>
            {/* ── Panel ── */}
            <div className={tableStyles.TablePanel}>
              <div className={tableStyles.TablePanelLeft}>
                <div className={[styles.colGroup, styles.gap6].join(" ")} style={{ justifyContent: "flex-start" }}>
                  <Button onClick={addHistoryRow} disabled={isLoading}><span>Добавить</span></Button>
                  <Divider />
                  {hasDirtyHistory && (<>
                    <Button variant="primary" onClick={saveAllDirtyHistory} disabled={isLoading}><span>Сохранить всё</span></Button>
                    <Divider />
                  </>)}
                  <ButtonImage onClick={() => formData.uuid && loadHistory(formData.uuid)} title="Обновить" disabled={isLoading}>
                    <img src={reload_16} alt="Reload" height={16} width={16} className={isLoading ? tableStyles.animationLoop : ""} />
                  </ButtonImage>
                </div>
              </div>
            </div>
            {/* ── Info ── */}
            <div style={{ fontSize: 13, color: "#555", padding: "0 6px", whiteSpace: "nowrap" }}>
              Записей: <strong>{historyRows.length}</strong>
            </div>
            {/* ── Table ── */}
            <div className={tableStyles.TableScrollContainer}>
              <div className={tableStyles.TableScrollWrapper}>
                <table>
                  <colgroup>
                    <col style={{ width: "140px", minWidth: "120px" }} />
                    <col style={{ width: "140px", minWidth: "120px" }} />
                    <col style={{ minWidth: "180px" }} />
                    <col style={{ minWidth: "180px" }} />
                    <col style={{ width: "130px", minWidth: "100px" }} />
                    <col style={{ width: "70px", minWidth: "70px" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th><div className={tableStyles.TableHeaderCell}><span>Дата</span></div></th>
                      <th><div className={tableStyles.TableHeaderCell}><span>Событие</span></div></th>
                      <th><div className={tableStyles.TableHeaderCell}><span>Организация</span></div></th>
                      <th><div className={tableStyles.TableHeaderCell}><span>Должность</span></div></th>
                      <th><div className={tableStyles.TableHeaderCell} style={{ justifyContent: "flex-end" }}><span>Оклад</span></div></th>
                      <th><div className={tableStyles.TableHeaderCell} style={{ justifyContent: "center" }}><span></span></div></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.length === 0 && !isLoading && (
                      <tr><td colSpan={6}>
                        <div className={tableStyles.TableBodyCell} style={{ justifyContent: "center", color: "#999", padding: "16px 0" }}>
                          <span>Нет записей. Нажмите «Добавить»</span>
                        </div>
                      </td></tr>
                    )}
                    {historyRows.map((row, idx) => (
                      <tr
                        key={row.uuid || "new-" + idx}
                        className={activeHistoryIdx === idx ? tableStyles.activeRow : undefined}
                        onClick={() => setActiveHistoryIdx(idx)}
                        style={{ background: row.isDirty ? "#fffde7" : undefined }}
                      >
                        <td>
                          <div className={tableStyles.TableBodyCell}>
                            <input
                              type="date"
                              value={row.eventDate}
                              onChange={e => updateHistoryRow(idx, "eventDate", e.target.value)}
                              disabled={isLoading}
                              style={{ border: "none", background: "transparent", padding: "2px 4px", width: "100%", fontSize: 13 }}
                            />
                          </div>
                        </td>
                        <td>
                          <div className={tableStyles.TableBodyCell}>
                            <FieldSelect
                              name={`hist_event_${idx}`}
                              options={EVENT_TYPE_OPTIONS}
                              value={row.eventType}
                              onChange={e => updateHistoryRow(idx, "eventType", e.target.value)}
                              disabled={isLoading}
                              variant="table"
                            />
                          </div>
                        </td>
                        <td>
                          <div className={tableStyles.TableBodyCell}>
                            <LookupField
                              label="" name={`hist_org_${idx}`}
                              value={row.organizationUuid} displayValue={row.organizationName}
                              endpoint="organizations" displayField="shortName"
                              onSelect={(u, d) => {
                                setHistoryRows(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], organizationUuid: u, organizationName: d, isDirty: true };
                                  return next;
                                });
                              }}
                              onClear={() => {
                                setHistoryRows(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], organizationUuid: "", organizationName: "", isDirty: true };
                                  return next;
                                });
                              }}
                              disabled={isLoading}
                              width="100%"
                              variant="table"
                            />
                          </div>
                        </td>
                        <td>
                          <div className={tableStyles.TableBodyCell}>
                            <LookupField
                              label="" name={`hist_pos_${idx}`}
                              value={row.positionUuid} displayValue={row.positionName}
                              endpoint="positions" displayField="shortName"
                              onSelect={(u, d) => {
                                setHistoryRows(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], positionUuid: u, positionName: d, isDirty: true };
                                  return next;
                                });
                              }}
                              onClear={() => {
                                setHistoryRows(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], positionUuid: "", positionName: "", isDirty: true };
                                  return next;
                                });
                              }}
                              disabled={isLoading}
                              width="100%"
                              variant="table"
                            />
                          </div>
                        </td>
                        <td>
                          <div className={tableStyles.TableBodyCell}>
                            <FieldNumber
                              name={`hist_salary_${idx}`}
                              value={row.salary}
                              onChange={e => updateHistoryRow(idx, "salary", e.target.value)}
                              disabled={isLoading}
                              step="0.01"
                              textAlign="right"
                              width="100%"
                              actions={[]}
                              variant="table"
                            />
                          </div>
                        </td>
                        <td>
                          <div className={tableStyles.TableBodyCell} style={{ justifyContent: "center", gap: 2 }}>
                            {row.isDirty && (
                              <button
                                onClick={e => { e.stopPropagation(); saveHistoryByIdx(idx); }}
                                disabled={isLoading}
                                title="Сохранить строку"
                                style={{ padding: "1px 6px", fontSize: 11, cursor: "pointer", border: "1px solid #4caf50", borderRadius: 3, background: "#e8f5e9", color: "#2e7d32", lineHeight: "16px" }}
                              >✓</button>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); deleteHistoryByIdx(idx); }}
                              disabled={isLoading}
                              title="Удалить строку"
                              style={{ padding: "1px 6px", fontSize: 11, cursor: "pointer", border: "1px solid #ef5350", borderRadius: 3, background: "#ffebee", color: "#c62828", lineHeight: "16px" }}
                            >✕</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
    historyRows, activeHistoryIdx, addHistoryRow, hasDirtyHistory, saveAllDirtyHistory, saveHistoryByIdx, deleteHistoryByIdx, updateHistoryRow, loadHistory]);

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
