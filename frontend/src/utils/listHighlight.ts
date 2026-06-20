/**
 * listHighlight — передача «подсветить документ в списке» из формы в *List
 * (активировать строку: activeRow + центрирование).
 *
 * Два пути доставки:
 *  • список ЕЩЁ НЕ открыт → значение запоминается в `pending`, и ModelList
 *    забирает его при монтировании (consumePendingHighlight, одноразово);
 *  • список УЖЕ открыт → он подписан (subscribeHighlight), и значение
 *    доставляется ему НАПРЯМУЮ — поэтому activeRow переносится даже если Pane
 *    списка был открыт ранее (после «Сохранить и закрыть» / «Показать в списке»).
 */
const pending = new Map<string, string>();

type Listener = (uuid: string) => void;
const listeners = new Map<string, Set<Listener>>();

export function setPendingHighlight(endpoint: string, uuid?: string): void {
  if (!endpoint || !uuid) return;
  // Всегда кладём в pending — это «страховка» на случай, если список ещё не
  // смонтирован / будет перемонтирован: новый ModelList заберёт значение при
  // монтировании (consumePendingHighlight).
  pending.set(endpoint, uuid);
  // И одновременно доставляем уже открытому списку — чтобы activeRow перешёл
  // даже если Pane был открыт ранее (без перемонтирования).
  listeners.get(endpoint)?.forEach((fn) => fn(uuid));
}

export function consumePendingHighlight(endpoint: string): string | undefined {
  const v = pending.get(endpoint);
  if (v !== undefined) pending.delete(endpoint);
  return v;
}

/**
 * Подписка списка (*List) на запросы подсветки строки. Возвращает отписку.
 * Пока список смонтирован — новые setPendingHighlight по его endpoint приходят
 * сюда напрямую (без перемонтирования), что и двигает activeRow на лету.
 */
export function subscribeHighlight(endpoint: string, fn: Listener): () => void {
  let set = listeners.get(endpoint);
  if (!set) {
    set = new Set();
    listeners.set(endpoint, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(endpoint);
  };
}
