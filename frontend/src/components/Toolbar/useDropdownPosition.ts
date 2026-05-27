import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";

function computePosition(anchor: HTMLElement, drop: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const dropW = drop.offsetWidth;
  const dropH = drop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const s: CSSProperties = { position: "fixed", zIndex: 9999 };

  const spaceBelow = vh - rect.bottom - 4;
  const spaceAbove = rect.top - 4;
  if (spaceBelow >= dropH) {
    s.top = rect.bottom + 4;
  } else if (spaceAbove >= dropH) {
    s.bottom = vh - rect.top + 4;
  } else if (spaceBelow >= spaceAbove) {
    s.top = rect.bottom + 4;
    s.maxHeight = spaceBelow;
    s.overflowY = "auto";
  } else {
    s.bottom = vh - rect.top + 4;
    s.maxHeight = spaceAbove;
    s.overflowY = "auto";
  }

  if (rect.left + dropW <= vw - 4) {
    s.left = rect.left;
  } else if (rect.right - dropW >= 4) {
    s.left = rect.right - dropW;
  } else {
    s.left = Math.max(4, vw - dropW - 4);
  }

  return s;
}

/**
 * Вычисляет позицию дропдауна на основе фактических размеров после рендера.
 * Возвращает [dropRef, style] — dropRef назначается на div меню, style применяется к нему же.
 */
export function useDropdownPosition(
  open: boolean,
  anchorRef: { readonly current: HTMLElement | null },
): [{ current: HTMLDivElement | null }, CSSProperties] {
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden", position: "fixed", zIndex: 9999 });

  // Синхронно позиционируем после рендера, до отрисовки браузером
  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: "hidden", position: "fixed", zIndex: 9999 });
      return;
    }
    const anchor = anchorRef.current;
    const drop = dropRef.current;
    if (anchor && drop) setStyle(computePosition(anchor, drop));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Пересчёт при скролле / ресайзе пока меню открыто
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      const drop = dropRef.current;
      if (anchor && drop) setStyle(computePosition(anchor, drop));
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return [dropRef, style];
}
