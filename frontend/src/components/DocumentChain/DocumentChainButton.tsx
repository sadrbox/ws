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
import IconButton from "src/components/IconButton/IconButton";
import { Icon } from "src/components/IconButton/icons";
import Modal from "src/components/Modal";
import toolbarStyles from "src/components/Toolbar/Toolbar.module.scss";
import { useAppContext } from "src/app";
import { openDocumentByType } from "src/utils/accountingDocTypes";
import { getFormatDateOnly } from "src/utils/datetime";
import styles from "./DocumentChain.module.scss";

interface ChainNode {
  type: string;
  typeLabel: string;
  uuid: string;
  id: number | null;
  date: string | null;
  posted: boolean;
  amount: number | null;
  organizationName: string | null;
  children: ChainNode[];
}

interface ChainResponse {
  root: ChainNode;
  target: { type: string; uuid: string };
  integrity: Array<{ kind: string; message: string }>;
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
        <span className={styles.NodeMeta}>
          ID {node.id ?? "?"}{date ? ` · ${date}` : ""}{node.organizationName ? ` · ${node.organizationName}` : ""}
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

  const { data, isLoading } = useQuery<ChainResponse | null>({
    queryKey: ["document-chain", documentType, documentUuid],
    queryFn: async () => {
      const resp = await api.get<any>(`documents/${documentType}/${documentUuid}/document-chain`);
      return resp ?? null;
    },
    enabled: open && !!documentUuid,
  });

  const handleOpen = useCallback((type: string, uuid: string) => {
    setOpen(false);
    void openDocumentByType(type, uuid, addPane);
  }, [addPane]);

  return (
    <>
      <IconButton
        size="md"
        className={toolbarStyles.DropdownToggleButton}
        title={translate("relatedDocuments")}
        aria-label={translate("relatedDocuments")}
        disabled={disabled || !documentUuid}
        onClick={() => setOpen(true)}
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
            {isLoading ? (
              <div className={styles.Loading}>{translate("loading")}</div>
            ) : !data?.root ? (
              <div className={styles.Empty}>{translate("relatedDocumentsEmpty")}</div>
            ) : (
              <>
                {data.integrity.length > 0 && (
                  <div className={styles.Integrity}>
                    {data.integrity.map((it, i) => (
                      <span key={i} className={styles.IntegrityItem}>⚠️ {it.message}</span>
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
