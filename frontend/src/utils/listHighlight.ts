/**
 * listHighlight — передача «подсветить документ в журнале» из формы в *List.
 *
 * Форма (кнопка «Показать в журнале») кладёт сюда {endpoint → uuid} и открывает
 * список; ModelList при монтировании ЗАБИРАЕТ значение (consume — одноразово) и
 * передаёт Table, который найдёт строку, выставит activeRow и прокрутит её в
 * центр (с авто-догрузкой страниц, если строки ещё нет). Без протягивания пропсов
 * через 15+ обёрток *List.
 */
const pending = new Map<string, string>();

export function setPendingHighlight(endpoint: string, uuid?: string): void {
  if (endpoint && uuid) pending.set(endpoint, uuid);
}

export function consumePendingHighlight(endpoint: string): string | undefined {
  const v = pending.get(endpoint);
  if (v !== undefined) pending.delete(endpoint);
  return v;
}
