/**
 * Кнопка «Связанные документы» для шапки документа (PaneItemHeaderActionsSlot).
 * Открывает модальное окно с деревом цепочки связанных документов
 * (основания вверх + порождённые вниз). Клик по узлу открывает документ
 * в новой панели. Источник — GET /documents/:type/:uuid/document-chain.
 */
import { FC, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { translate } from "src/i18";
import { api } from "src/services/api/client";
import { showToast } from "src/components/UIToast";
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import Modal from "src/components/Modal";
import toolbarStyles from "src/components/Toolbar/Toolbar.module.scss";
import { useAppContext } from "src/app/context";
import { openDocumentByType } from "src/utils/accountingDocTypes";
import { getFormatDateOnly } from "src/utils/datetime";
import styles from "./DocumentChain.module.scss";

interface ChainNode {
  type: string;
  typeLabel: string;
  uuid: string;
  id: number | null;
  number: string | null;
  date: string | null;
  posted: boolean;
  amount: number | null;
  organizationName: string | null;
  /** Документ расходится со своим основанием (строки отличаются). */
  basisMismatch?: boolean;
  children: ChainNode[];
}

interface IntegrityIssue {
  kind: string;
  message: string;
  /** Для kind="dangling" — документ-ребёнок с висячей ссылкой (его и чиним). */
  childType?: string;
  childUuid?: string;
  childLabel?: string;
}

interface ChainResponse {
  root: ChainNode;
  target: { type: string; uuid: string };
  integrity: IntegrityIssue[];
}

interface Props {
  documentType: string;
  documentUuid?: string;
  disabled?: boolean;
}

const fmtAmt = (n: number | null) =>
  n == null ? "" : Number(n).toLocaleString("ru-KZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const NodeRow: FC<{
  node: ChainNode;
  target: { type: string; uuid: string };
  onOpen: (type: string, uuid: string) => void;
}> = ({ node, target, onOpen }) => {
  const isTarget = node.type === target.type && node.uuid === target.uuid;
  const date = node.date ? getFormatDateOnly(String(node.date)) : "";
  return (
    <div>
      <div
        className={[styles.Node, isTarget ? styles.NodeTarget : ""].filter(Boolean).join(" ")}
        onClick={() => onOpen(node.type, node.uuid)}
        role="button"
        tabIndex={0}
        title={translate("openDocument")}
      >
        <span className={[styles.Dot, node.posted ? styles.DotPosted : styles.DotUnposted].join(" ")} />
        <span className={styles.NodeType}>{node.typeLabel}</span>
        {node.basisMismatch && (
          <span className={styles.NodeWarn} title={translate("basisChainMismatch")} aria-label={translate("basisChainMismatch")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
        )}
        <span className={styles.NodeMeta}>
          {node.number ? `№ ${node.number}` : `ID ${node.id ?? "?"}`}{date ? ` - ${date}` : ""}{node.organizationName ? ` - ${node.organizationName}` : ""}
        </span>
        {node.amount != null && <span className={styles.NodeAmount}>{fmtAmt(node.amount)}</span>}
      </div>
      {node.children.length > 0 && (
        <div className={styles.Branch}>
          {node.children.map((c) => (
            <NodeRow key={`${c.type}:${c.uuid}`} node={c} target={target} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
};

const DocumentChainButton: FC<Props> = ({ documentType, documentUuid, disabled }) => {
  const [open, setOpen] = useState(false);
  const { windows: { addPane } } = useAppContext();

  const { data, isLoading, isFetching, refetch } = useQuery<ChainResponse | null>({
    queryKey: ["document-chain", documentType, documentUuid],
    queryFn: async () => {
      const resp = await api.get<any>(`documents/${documentType}/${documentUuid}/document-chain`);
      return resp ?? null;
    },
    enabled: open && !!documentUuid,
    // Цепочка строится на сервере из АКТУАЛЬНЫХ данных БД и зависит не только от
    // самого документа, но и от его основания/потомков (ключ кэша их не отражает).
    // Поэтому всегда тянем свежие данные при каждом открытии окна.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  // Открытие окна → принудительно перезапрашиваем (на случай, если основание
  // или потомки изменились с прошлого показа при том же uuid документа).
  const handleToggleOpen = useCallback(() => {
    setOpen(true);
    if (documentUuid) void refetch();
  }, [documentUuid, refetch]);

  const handleOpen = useCallback((type: string, uuid: string) => {
    setOpen(false);
    void openDocumentByType(type, uuid, addPane);
  }, [addPane]);

  // Очистить «висячее» основание у документа-ребёнка и перестроить цепочку.
  const handleClearBasis = useCallback(async (childType: string, childUuid: string) => {
    try {
      await api.post(`documents/${childType}/${childUuid}/clear-basis`, {});
      showToast(translate("basisCleared"), "success");
      void refetch();
    } catch {
      showToast(translate("basisClearFailed"), "error");
    }
  }, [refetch]);

  return (
    <>
      <IconButton
        size="md"
        className={toolbarStyles.DropdownToggleButton}
        title={translate("relatedDocuments")}
        aria-label={translate("relatedDocuments")}
        disabled={disabled || !documentUuid}
        onClick={handleToggleOpen}
      >
        <Icon name="fromBasis" />
      </IconButton>
      {open && (
        <Modal
          title={translate("relatedDocuments")}
          onClose={() => setOpen(false)}
          buttons={[{ label: translate("close"), onClick: () => setOpen(false), variant: "secondary" }]}
          style={{ minWidth: 560, maxWidth: "90vw" }}
        >
          <div className={styles.Wrapper}>
            {isLoading || isFetching ? (
              <div className={styles.Loading}>{translate("loading")}</div>
            ) : !data?.root ? (
              <div className={styles.Empty}>{translate("relatedDocumentsEmpty")}</div>
            ) : (
              <>
                {data.integrity.length > 0 && (
                  <div className={styles.Integrity}>
                    {data.integrity.map((it, i) => (
                      <div key={i} className={styles.IntegrityItem}>
                        <span>⚠️ {it.message}</span>
                        {it.kind === "dangling" && it.childType && it.childUuid && (
                          <button
                            type="button"
                            className={styles.IntegrityFix}
                            title={translate("clearBasisHint")}
                            onClick={() => void handleClearBasis(it.childType!, it.childUuid!)}
                          >
                            {translate("clearBasis")}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <NodeRow node={data.root} target={data.target} onOpen={handleOpen} />
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

DocumentChainButton.displayName = "DocumentChainButton";
export default DocumentChainButton;
