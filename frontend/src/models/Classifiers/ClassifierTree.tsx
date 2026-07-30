// Дерево классификатора (родитель→дети) на данных с parentCode. Строится client-side
// из полного набора узлов (просмотрщик грузит целиком). Свёрнуто по умолчанию —
// рендерятся только раскрытые ветви. Поиск показывает совпадения + их предков
// (авто-раскрытие). Плоские классификаторы (tnved/страны, parentCode=null) выглядят
// как один уровень.
//
// Визуальная иерархия: направляющие «рельсы» по уровням, узлы-родители выделены
// (жирнее + счётчик детей), листья приглушены. Клик по строке-родителю разворачивает.
import { FC, ReactNode, useMemo, useState, useCallback } from "react";
import styles from "./Classifiers.module.scss";

export interface TreeNode {
  code: string;
  name: string;
  parentCode?: string | null;
  /** false — виртуальный узел-группа (нельзя выбрать в пикере). По умолчанию можно. */
  selectable?: boolean;
}

/**
 * Дерево из СТРУКТУРЫ КОДА для плоских классификаторов без parentCode (ТН ВЭД: у него
 * в источнике только 10-значные листья, а родители — в другом классификаторе). Группы
 * синтезируются по префиксам `levels` (напр. [2,4,6]) — виртуальные, невыбираемые;
 * данные в БД не меняются. `groupLabel(level, prefix)` — подпись группы.
 */
export function buildPrefixTree(
  rows: TreeNode[],
  levels: number[],
  groupLabel: (level: number, prefix: string) => string,
): TreeNode[] {
  const byCode = new Map<string, TreeNode>();
  const asc = [...levels].sort((a, b) => a - b);
  for (const r of rows) {
    const code = r.code;
    let parent: string | null = null;
    for (const L of asc) {
      if (L >= code.length) break;
      const prefix = code.slice(0, L);
      if (!byCode.has(prefix)) byCode.set(prefix, { code: prefix, name: groupLabel(L, prefix), parentCode: parent, selectable: false });
      parent = prefix;
    }
    byCode.set(code, { code, name: r.name, parentCode: parent, selectable: true });
  }
  return [...byCode.values()];
}

interface ClassifierTreeProps {
  rows: TreeNode[];
  search?: string;
  /** Пикер: клик по узлу выбирает его. */
  onSelect?: (node: TreeNode) => void;
  highlightCode?: string;
}

const ClassifierTree: FC<ClassifierTreeProps> = ({ rows, search, onSelect, highlightCode }) => {
  const { roots, childrenOf } = useMemo(() => {
    const childrenOf = new Map<string, TreeNode[]>();
    for (const r of rows) {
      const key = r.parentCode || "";
      const arr = childrenOf.get(key);
      if (arr) arr.push(r);
      else childrenOf.set(key, [r]);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { roots: childrenOf.get("") ?? [], childrenOf };
  }, [rows]);

  const q = (search ?? "").trim().toLowerCase();

  // Поиск: множество видимых узлов (совпадения + все предки) и авто-раскрытых предков.
  const { visible, autoExpand } = useMemo(() => {
    if (!q) return { visible: null as Set<string> | null, autoExpand: null as Set<string> | null };
    const byCode = new Map<string, TreeNode>(rows.map((r) => [r.code, r] as const));
    const visible = new Set<string>();
    const autoExpand = new Set<string>();
    for (const r of rows) {
      if (r.code.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)) {
        let cur: TreeNode | undefined = r;
        while (cur) {
          visible.add(cur.code);
          const parent: TreeNode | undefined = cur.parentCode ? byCode.get(cur.parentCode) : undefined;
          if (parent) autoExpand.add(parent.code);
          cur = parent;
        }
      }
    }
    return { visible, autoExpand };
  }, [q, rows]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }, []);

  const isOpen = (code: string) => (autoExpand ? autoExpand.has(code) : expanded.has(code));

  const render = (nodes: TreeNode[], depth: number, out: ReactNode[]) => {
    for (const n of nodes) {
      if (visible && !visible.has(n.code)) continue;
      const kids = childrenOf.get(n.code);
      const hasKids = !!kids && kids.length > 0;
      const open = hasKids && isOpen(n.code);
      const canSelect = !!onSelect && n.selectable !== false;
      const rowClick = () => {
        if (canSelect) onSelect!(n);
        else if (hasKids) toggle(n.code);
      };
      out.push(
        <div
          key={`${n.parentCode ?? ""}/${n.code}`}
          className={
            styles.TreeRow +
            (highlightCode === n.code ? " " + styles.TreeRowHi : "") +
            (hasKids || canSelect ? " " + styles.TreeRowClickable : "")
          }
          onClick={rowClick}
          role={canSelect || hasKids ? "button" : undefined}
        >
          {/* Рельсы уровней */}
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className={styles.Guide} />
          ))}
          {hasKids ? (
            <button
              type="button"
              className={styles.TreeCaret}
              aria-label={open ? "Свернуть" : "Развернуть"}
              aria-expanded={open}
              onClick={(e) => { e.stopPropagation(); toggle(n.code); }}
            >
              <span className={open ? styles.CaretOpen : styles.CaretClosed} aria-hidden>▶</span>
            </button>
          ) : (
            <span className={styles.TreeLeafDot} aria-hidden>·</span>
          )}
          <span className={styles.TreeCode}>{n.code}</span>
          <span className={hasKids ? styles.TreeNameParent : styles.TreeName}>{n.name}</span>
          {hasKids ? <span className={styles.KidCount}>{kids!.length}</span> : null}
        </div>,
      );
      if (open && kids) render(kids, depth + 1, out);
    }
  };

  const out: ReactNode[] = [];
  render(roots, 0, out);

  if (out.length === 0) {
    return <div className={styles.TreeEmpty}>{q ? "Ничего не найдено" : "Нет данных"}</div>;
  }
  return <div className={styles.Tree}>{out}</div>;
};

export default ClassifierTree;
