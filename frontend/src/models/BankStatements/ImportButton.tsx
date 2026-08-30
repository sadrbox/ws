import { FC, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "src/components/Button";
import Modal from "src/components/Modal";
import LookupField from "src/components/Field/LookupField";
import { showToast } from "src/components/UIToast";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { useDefaultOrganization } from "src/hooks/useDefaultOrganization";

interface ImportResult {
  success?: boolean;
  format?: string;
  total?: number;
  imported?: number;
  skipped?: number;
  unresolved?: number;
  message?: string;
}

/**
 * Кнопка «Импорт выписки» (T8.1) в тулбаре списка BankStatements. Открывает модалку:
 * организация + счёт + файл (1CClientBankExchange / CSV) → POST /bank-statements/import.
 * Строки создаются НЕпроведёнными — пользователь сверяет и проводит. Дубли (повторный
 * импорт того же файла) сервер отсекает сам.
 */
const BankStatementImportButton: FC = () => {
  const qc = useQueryClient();
  const defaultOrg = useDefaultOrganization();
  const [open, setOpen] = useState(false);
  const [orgUuid, setOrgUuid] = useState("");
  const [orgName, setOrgName] = useState("");
  const [accUuid, setAccUuid] = useState("");
  const [accName, setAccName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const openModal = useCallback(() => {
    // Предзаполняем организацией по умолчанию (счёт пользователь выбирает сам).
    setOrgUuid(defaultOrg.organizationUuid ?? "");
    setOrgName(defaultOrg.organizationName ?? "");
    setAccUuid(""); setAccName(""); setFile(null);
    setOpen(true);
  }, [defaultOrg.organizationUuid, defaultOrg.organizationName]);

  const doImport = useCallback(async () => {
    if (!accUuid) { showToast(translate("bankImportNeedAccount"), "warning"); return; }
    if (!file) { showToast(translate("bankImportNeedFile"), "warning"); return; }
    setBusy(true);
    try {
      const text = await file.text();
      const r = await api.post<ImportResult>("bank-statements/import", {
        text, organizationUuid: orgUuid || null, bankAccountUuid: accUuid,
      });
      const summary = `${translate("bankImportDone")}: ${r.imported ?? 0} / ${r.total ?? 0}`
        + (r.skipped ? `, ${translate("bankImportSkipped")}: ${r.skipped}` : "")
        + (r.unresolved ? `, ${translate("bankImportUnresolved")}: ${r.unresolved}` : "");
      showToast(summary, (r.unresolved ?? 0) > 0 ? "warning" : "success");
      await qc.invalidateQueries({ queryKey: ["bank-statements"] });
      setOpen(false);
    } catch (e) {
      showToast((e as { message?: string })?.message || translate("bankImportError"), "error");
    } finally {
      setBusy(false);
    }
  }, [accUuid, file, orgUuid, qc]);

  return (
    <>
      <Button variant="secondary" onClick={openModal}>{translate("bankImport")}</Button>
      {open && (
        <Modal
          title={translate("bankImport")}
          onClose={() => setOpen(false)}
          style={{ minWidth: 480 }}
          buttons={[
            { label: busy ? translate("bankImporting") : translate("bankImportRun"), onClick: () => void doImport(), variant: "primary" },
            { label: translate("cancel"), onClick: () => setOpen(false), variant: "secondary" },
          ]}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
            <LookupField
              label={translate("OrganizationsList")} name="bank_import_org"
              value={orgUuid} displayValue={orgName} endpoint="organizations" displayField="name"
              onSelect={(u, dv) => { setOrgUuid(u); setOrgName(dv); setAccUuid(""); setAccName(""); }}
              onClear={() => { setOrgUuid(""); setOrgName(""); }}
            />
            <LookupField
              label={translate("BankAccountsList")} name="bank_import_acc"
              value={accUuid} displayValue={accName} endpoint="bankaccounts" displayField="iban"
              getSuggestionLabel={(item) => [item.iban, item.bankName].filter(Boolean).join(" — ")}
              extraParams={orgUuid ? { organizationUuid: orgUuid } : undefined}
              onSelect={(u, dv) => { setAccUuid(u); setAccName(dv); }}
              onClear={() => { setAccUuid(""); setAccName(""); }}
            />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span>{translate("bankImportFile")}</span>
              <input type="file" accept=".txt,.csv,.1c,text/plain"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{translate("bankImportHint")}</div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default BankStatementImportButton;
