// Правила отметки строк (Table/services): поиск и отбор СКРЫВАЮТ строки, а не снимают с них отметки;
// шапка говорит о видимых строках; режим «выбраны все» не включается на суженном списке.
import { describe, it, expect } from 'vitest';
import {
  dragSelection, isNarrowedView, isRowSelected, rowIdsBetween, selectionIndicator, toggleRowSelection, toggleAllSelection,
  type SelectionState,
} from 'src/components/Table/services';

const st = (selected: number[] = [], allMode = false, excluded: number[] = []): SelectionState =>
  ({ selected: new Set(selected), allMode, excluded: new Set(excluded) });
const picked = (s: SelectionState, universe: number[]) => universe.filter((id) => isRowSelected(s, id));
const ALL = [1, 2, 3, 4, 5];

describe('isNarrowedView', () => {
  it('поиск сужает список', () => {
    expect(isNarrowedView('иванов', {})).toBe(true);
    expect(isNarrowedView('   ', undefined)).toBe(false);
  });
  it('отбор по периоду сужает список, пустой период — нет', () => {
    expect(isNarrowedView('', { dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' } })).toBe(true);
    expect(isNarrowedView('', { dateRange: { startDate: '2026-09-01' } })).toBe(true);
    expect(isNarrowedView('', { dateRange: { startDate: '', endDate: undefined } })).toBe(false);
    expect(isNarrowedView('', { dateRange: undefined })).toBe(false);
  });
  it('отбор по полю: пустое значение отбором не считается', () => {
    expect(isNarrowedView(null, { role: { value: 'Кассир', operator: 'contains' } })).toBe(true);
    expect(isNarrowedView(null, { role: { value: '', operator: 'contains' } })).toBe(false);
    expect(isNarrowedView(null, { posted: { value: false, operator: 'eq' } })).toBe(true);
    expect(isNarrowedView(null, {})).toBe(false);
  });
});

describe('selectionIndicator — только видимые строки', () => {
  it('отмечены строки вне поиска — над найденным пусто, а не «частично»', () => {
    expect(selectionIndicator(st([1, 2]), [4])).toEqual({ all: false, some: false });
  });
  it('режим «все» с исключённой скрытой строкой — над найденным галочка, а не «частично»', () => {
    expect(selectionIndicator(st([], true, [1]), [4, 5])).toEqual({ all: true, some: false });
  });
  it('часть видимых отмечена — «частично»', () => {
    expect(selectionIndicator(st([4]), [4, 5])).toEqual({ all: false, some: true });
  });
  it('пустой список — ни галочки, ни «частично»', () => {
    expect(selectionIndicator(st([], true), [])).toEqual({ all: false, some: false });
  });
});

describe('toggleRowSelection', () => {
  it('единственная найденная строка при поиске не включает режим «все»', () => {
    const next = toggleRowSelection(st(), 3, true, [3], true);
    expect(next.allMode).toBe(false);
    expect(picked(next, ALL)).toEqual([3]);
  });
  it('отметки при смене поиска накапливаются', () => {
    let s = toggleRowSelection(st(), 5, true, [5], true);
    s = toggleRowSelection(s, 2, true, [2], true);
    expect(picked(s, ALL)).toEqual([2, 5]);
  });
  it('без поиска отметка всех строк по одной включает режим «все»', () => {
    let s = st();
    for (const id of ALL) s = toggleRowSelection(s, id, true, ALL, false);
    expect(s.allMode).toBe(true);
    expect(picked(s, ALL)).toEqual(ALL);
  });
  it('в режиме «все» снятие всех видимых строк выключает режим', () => {
    let s = st([], true);
    for (const id of ALL) s = toggleRowSelection(s, id, false, ALL, false);
    expect(s).toEqual(st());
  });
  it('при поиске режим «все» не выключается снятием найденной строки', () => {
    const s = toggleRowSelection(st([], true), 3, false, [3], true);
    expect(s.allMode).toBe(true);
    expect(picked(s, ALL)).toEqual([1, 2, 4, 5]);
  });
});

describe('toggleAllSelection — суженный список', () => {
  it('отмечает найденное и не трогает отмеченное вне поиска', () => {
    const s = toggleAllSelection(st([1, 2]), [4, 5], true);
    expect(picked(s, ALL)).toEqual([1, 2, 4, 5]);
    expect(s.allMode).toBe(false);
  });
  it('повторный щелчок снимает только найденное', () => {
    const s = toggleAllSelection(st([1, 2, 4, 5]), [4, 5], true);
    expect(picked(s, ALL)).toEqual([1, 2]);
  });
  it('при «частично» снимает только найденное', () => {
    const s = toggleAllSelection(st([1, 4]), [4, 5], true);
    expect(picked(s, ALL)).toEqual([1]);
  });
  it('режим «все»: снимает найденное через исключения, скрытое остаётся отмеченным', () => {
    const s = toggleAllSelection(st([], true), [4, 5], true);
    expect(s.allMode).toBe(true);
    expect(picked(s, ALL)).toEqual([1, 2, 3]);
  });
  it('режим «все»: возвращает найденное из исключений, скрытое исключение остаётся', () => {
    const s = toggleAllSelection(st([], true, [1, 4, 5]), [4, 5], true);
    expect(picked(s, ALL)).toEqual([2, 3, 4, 5]);
  });
  it('галочка шапки после щелчка совпадает с тем, что видно', () => {
    const vis = [4, 5];
    const on = toggleAllSelection(st([1]), vis, true);
    expect(selectionIndicator(on, vis)).toEqual({ all: true, some: false });
    const off = toggleAllSelection(on, vis, true);
    expect(selectionIndicator(off, vis)).toEqual({ all: false, some: false });
  });
});

describe('toggleAllSelection — полный список', () => {
  it('пусто — включает режим «все записи»', () => {
    const s = toggleAllSelection(st(), ALL, false);
    expect(s.allMode).toBe(true);
    expect(picked(s, ALL)).toEqual(ALL);
  });
  it('что-то отмечено — снимает всё', () => {
    expect(toggleAllSelection(st([2]), ALL, false)).toEqual(st());
    expect(toggleAllSelection(st([], true, [3]), ALL, false)).toEqual(st());
  });
});

describe('протягивание мышью: диапазон строк', () => {
  const rows = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }, { id: 50 }];
  it('от строки до строки включительно, в порядке списка — вниз и вверх одинаково', () => {
    expect(rowIdsBetween(rows, 20, 40)).toEqual([20, 30, 40]);
    expect(rowIdsBetween(rows, 40, 20)).toEqual([20, 30, 40]);
    expect(rowIdsBetween(rows, 30, 30)).toEqual([30]);
  });
  it('конец пропал из списка (перезагрузка, поиск) — диапазона нет', () => {
    expect(rowIdsBetween(rows, 20, 99)).toEqual([]);
    expect(rowIdsBetween([], 1, 1)).toEqual([]);
  });
});

describe('протягивание мышью: отметки', () => {
  it('без Ctrl диапазон заменяет выбор', () => {
    expect(picked(dragSelection(st([1, 5]), [2, 3], false, ALL, false), ALL)).toEqual([2, 3]);
  });
  it('с Ctrl добавляется к отмеченному до протягивания', () => {
    expect(picked(dragSelection(st([1, 5]), [2, 3], true, ALL, false), ALL)).toEqual([1, 2, 3, 5]);
  });
  it('протянули через все строки несуженного списка — режим «выбраны все», как у галочек', () => {
    expect(dragSelection(st(), ALL, false, ALL, false)).toEqual(st([], true));
  });
  it('в режиме «выбраны все» без Ctrl — ровно диапазон, с Ctrl — диапазон возвращается из исключённых', () => {
    expect(picked(dragSelection(st([], true, [2]), [3, 4], false, ALL, false), ALL)).toEqual([3, 4]);
    expect(picked(dragSelection(st([], true, [2, 3]), [3], true, ALL, false), ALL)).toEqual([1, 3, 4, 5]);
  });
  it('на суженном списке скрытое поиском не трогаем: замена касается только видимых строк', () => {
    const visible = [2, 3, 4];
    expect(picked(dragSelection(st([1, 2]), [3, 4], false, visible, true), ALL)).toEqual([1, 3, 4]);
    // «Выбраны все» при поиске: видимое вне диапазона уходит в исключения, скрытое остаётся отмеченным.
    expect(picked(dragSelection(st([], true), [3], false, visible, true), ALL)).toEqual([1, 3, 5]);
    // И режим «выбраны все» на суженном списке не включается, даже если отмечено всё видимое.
    expect(dragSelection(st(), visible, false, visible, true)).toEqual(st(visible));
  });
});
