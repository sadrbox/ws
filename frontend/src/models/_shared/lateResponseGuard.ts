import { useCallback, useRef } from "react";

/**
 * ГОНКИ ПОЗДНИХ ОТВЕТОВ ПРИ СМЕНЕ ОРГАНИЗАЦИИ И КОНТРАГЕНТА (аудит 26.09, И13).
 *
 * Выбор организации или контрагента тянет за собой запрос: дефолтные склад, касса, счёт и
 * договор новой организации, основной договор нового контрагента. Быстро сменили A→B — ответ
 * по A приходил позже ответа по B и ставил в документ B склад и договор организации A. А склад,
 * выбранный вручную, пока шёл запрос, ответ перетирал.
 *
 * Хук даёт функцию «запросить и применить»: она помнит номер последнего запроса, после await
 * сверяет, что этот запрос — последний и что поля, ради которых его делали, не изменились, и
 * применяет ответ без полей, которые за время запроса поменяли вручную. Тот же приём — в
 * createTradeDocForm (каркас); здесь он один на остальные формы документов и терминал.
 *
 * СЧЁТЧИК — НА ОБРАБОТЧИК (КР-6 аудита 27.09). Счётчик был один на форму, а обработчиков два:
 * выбрали организацию B и, пока шёл запрос её дефолтов, выбрали контрагента — ответ по
 * организации отбрасывался как «поздний», и склад, касса, договор, счёт, тип цен оставались от
 * организации A и уходили в документ B. Теперь у каждого обработчика свой guard (формы и терминал
 * заводят их отдельно), а внутри guard номер запроса ведётся по выбору, ради которого запрос
 * (набор stillSame): даже общий guard не отбрасывает ответ соседнего обработчика. Поля прежней
 * организации формы чистят сразу при её смене (orgResetPatch) — не дожидаясь ответа.
 */

/** Ответ без полей, изменённых вручную, пока шёл запрос (значение сейчас не то, что при запросе). */
export function keepManualEdits<T extends object>(patch: object, atRequest: T, now: T): Partial<T> {
  const before = atRequest as Record<string, unknown>;
  const current = now as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (current[k] !== before[k]) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Запросить и применить. `load` получает снимок на момент запроса; `stillSame` — поля, которые
 * после ответа должны остаться теми же, что при запросе (выбор, ради которого запрашивали).
 * Возвращает применённые поля (пустой объект — применять было нечего) или null, если ответ
 * отброшен как поздний. Выбор нужно записать в снимок ДО вызова — по нему идёт сверка.
 */
export type LateResponseGuard<T extends object> = (
  load: (atRequest: T) => Promise<object | null | undefined>,
  stillSame: ReadonlyArray<keyof T>,
) => Promise<Partial<T> | null>;

export function useLateResponseGuard<T extends object>(
  getSnapshot: () => T,
  apply: (patch: Partial<T>) => void,
): LateResponseGuard<T> {
  // Номер последнего запроса — по выбору (stillSame), см. «Счётчик — на обработчик».
  const seqRef = useRef(new Map<string, number>());
  return useCallback<LateResponseGuard<T>>(async (load, stillSame) => {
    const channel = stillSame.map(String).sort().join(",");
    const seq = (seqRef.current.get(channel) ?? 0) + 1;
    seqRef.current.set(channel, seq);
    const atRequest = getSnapshot();
    const patch = await load(atRequest);
    const now = getSnapshot();
    if (seq !== seqRef.current.get(channel)) return null;
    for (const key of stillSame) if (now[key] !== atRequest[key]) return null;
    const kept = patch ? keepManualEdits(patch, atRequest, now) : ({} as Partial<T>);
    if (Object.keys(kept).length > 0) apply(kept);
    return kept;
  }, [getSnapshot, apply]);
}

/** Форма на useFormStore: снимок — поля формы, применение — setFields. */
export interface GuardedForm<T extends object> {
  store: { getSnapshot: () => { fields: T } };
  setFields: (patch: Partial<T>) => void;
}

export function useFormLateResponseGuard<T extends object>(form: GuardedForm<T>): LateResponseGuard<T> {
  const { store, setFields } = form;
  const getSnapshot = useCallback(() => store.getSnapshot().fields, [store]);
  return useLateResponseGuard<T>(getSnapshot, setFields);
}

/**
 * Патч «очистить поля прежней организации» (КР-6 аудита 27.09): склад, касса, договор, счёт, тип
 * цен принадлежат организации. Применяется ВМЕСТЕ со сменой организации, до запроса дефолтов новой:
 * ответ может прийти поздно или быть отброшен, а реквизиты прежней организации не должны уйти в
 * документ новой. Дефолты новой подставит ответ (поля, выбранные за время запроса вручную, он не
 * трогает — keepManualEdits).
 */
export function orgResetPatch(fields: ReadonlyArray<{ uuidKey: string; nameKey: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    out[f.uuidKey] = "";
    out[f.nameKey] = "";
  }
  return out;
}
