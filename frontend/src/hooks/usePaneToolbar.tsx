import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ─── Store: paneId → DOM-элемент слота тулбара ──────────────────────────
type Listener = () => void;

class PaneToolbarStore {
  private slots = new Map<string, HTMLDivElement>();
  private listeners = new Set<Listener>();

  getSlot = (paneId: string): HTMLDivElement | undefined => this.slots.get(paneId);

  registerSlot = (paneId: string, el: HTMLDivElement) => {
    this.slots.set(paneId, el);
    this.emit();
  };

  unregisterSlot = (paneId: string) => {
    if (this.slots.delete(paneId)) this.emit();
  };

  subscribe = (cb: Listener) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  private emit() {
    this.listeners.forEach(fn => fn());
  }
}

const store = new PaneToolbarStore();

// ─── Хук для PaneItem: создать слот-контейнер тулбара ────────────────────
/**
 * Возвращает ref-callback для div-слота тулбара.
 * PaneItem монтирует этот div в заголовок, а форма рендерит в него через портал.
 */
export function usePaneToolbarSlot(paneId: string) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (elRef.current) {
      store.registerSlot(paneId, elRef.current);
    }
    return () => { store.unregisterSlot(paneId); };
  }, [paneId]);

  return elRef;
}

// ─── Хук для ФОРМЫ: рендерить тулбар через портал ───────────────────────
/**
 * ```tsx
 * usePaneToolbar(paneId, <FormPanel ... />);
 * ```
 * Рендерит children в DOM-слот заголовка панели через createPortal.
 */
export function usePaneToolbar(paneId: string | undefined, toolbar: ReactNode): ReactNode {
  const [slot, setSlot] = useState<HTMLDivElement | undefined>(undefined);

  useEffect(() => {
    if (!paneId) return;
    // Слот может появиться позже — подписываемся
    const update = () => setSlot(store.getSlot(paneId));
    update();
    return store.subscribe(update);
  }, [paneId]);

  if (!slot) return null;
  return createPortal(toolbar, slot);
}

export { store as paneToolbarStore };
