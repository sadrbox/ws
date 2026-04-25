import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ─── Store: paneId → DOM-элемент слота тулбара ──────────────────────────
type Listener = () => void;

class PaneToolbarStore {
  private slots = new Map<string, HTMLDivElement>();
  private toolbars = new Set<string>();
  private listeners = new Set<Listener>();

  getSlot = (paneId: string): HTMLDivElement | undefined => this.slots.get(paneId);
  hasToolbar = (paneId: string): boolean => this.toolbars.has(paneId);

  registerSlot = (paneId: string, el: HTMLDivElement) => {
    this.slots.set(paneId, el);
    this.emit();
  };

  unregisterSlot = (paneId: string) => {
    if (this.slots.delete(paneId)) this.emit();
  };

  registerToolbar = (paneId: string) => {
    this.toolbars.add(paneId);
    this.emit();
  };

  unregisterToolbar = (paneId: string) => {
    if (this.toolbars.delete(paneId)) this.emit();
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

  const refCallback = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el;
    if (el) {
      store.registerSlot(paneId, el);
    } else {
      store.unregisterSlot(paneId);
    }
  }, [paneId]);

  return { elRef, refCallback };
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
    const update = () => setSlot(store.getSlot(paneId));
    update();
    return store.subscribe(update);
  }, [paneId]);

  useEffect(() => {
    if (!paneId) return;
    store.registerToolbar(paneId);
    return () => { store.unregisterToolbar(paneId); };
  }, [paneId]);

  if (!slot) return null;
  return createPortal(toolbar, slot);
}

/**
 * Возвращает true, если для данной панели зарегистрирован тулбар.
 * Реактивно обновляется при mount/unmount FormPanel.
 */
export function useHasToolbar(paneId: string): boolean {
  const [has, setHas] = useState(() => store.hasToolbar(paneId));
  useEffect(() => {
    setHas(store.hasToolbar(paneId));
    return store.subscribe(() => setHas(store.hasToolbar(paneId)));
  }, [paneId]);
  return has;
}

export { store as paneToolbarStore };
