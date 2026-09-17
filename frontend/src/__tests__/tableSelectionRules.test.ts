// Правила отметки строк (Table/services): быстрый поиск и отбор не должны превращать
// отметку найденной строки в «выбраны все записи».
import { describe, it, expect } from 'vitest';
import {
  isNarrowedView, toggleRowSelection, toggleAllSelection, type SelectionState,
} from 'src/components/Table/services';

const empty = (): SelectionState => ({ selected: new Set(), allMode: false, excluded: new Set() });
const ids = [1, 2, 3, 4, 5];

describe('isNarrowedView', () => {
  it('список сужен поиском или отбором', () => {
    expect(isNarrowedView('', {})).toBe(false);
    expect(isNarrowedView('   ', undefined)).toBe(false);
    expect(isNarrowedView('иванов', {})).toBe(true);
    expect(isNarrowedView(null, { role: 'Администратор' })).toBe(true);
  });
});

describe('toggleRowSelection', () => {
  it('единственная найденная строка при поиске не включает режим «все»', () => {
    const next = toggleRowSelection(empty(), 3, true, [3], true);
    expect(next.allMode).toBe(false);
    expect([...next.selected]).toEqual([3]);
  });

  it('снятие поиска не расширяет выбор', () => {
    const afterSearch = toggleRowSelection(empty(), 3, true, [3], true);
    // тот же набор отметок, но виден уже весь список
    expect(afterSearch.allMode).toBe(false);
    expect([...afterSearch.selected]).toEqual([3]);
  });

  it('без поиска отметка всех видимых строк включает режим «все»', () => {
    let state = empty();
    for (const id of ids) state = toggleRowSelection(state, id, true, ids, false);
    expect(state.allMode).toBe(true);
    expect(state.selected.size).toBe(0);
    expect(state.excluded.size).toBe(0);
  });

  it('в режиме «все» снятие строки копит исключения', () => {
    const state = toggleRowSelection({ selected: new Set(), allMode: true, excluded: new Set() }, 2, false, ids, false);
    expect(state.allMode).toBe(true);
    expect([...state.excluded]).toEqual([2]);
  });

  it('в режиме «все» снятие всех видимых строк выключает режим', () => {
    let state: SelectionState = { selected: new Set(), allMode: true, excluded: new Set() };
    for (const id of ids) state = toggleRowSelection(state, id, false, ids, false);
    expect(state.allMode).toBe(false);
    expect(state.selected.size).toBe(0);
    expect(state.excluded.size).toBe(0);
  });

  it('при поиске режим «все» не выключается снятием единственной найденной строки', () => {
    const state = toggleRowSelection({ selected: new Set(), allMode: true, excluded: new Set() }, 3, false, [3], true);
    expect(state.allMode).toBe(true);
    expect([...state.excluded]).toEqual([3]);
  });
});

describe('toggleAllSelection', () => {
  it('«выбрать все» при поиске отмечает только найденные строки', () => {
    const state = toggleAllSelection(empty(), [3], true, false);
    expect(state.allMode).toBe(false);
    expect([...state.selected]).toEqual([3]);
  });

  it('«выбрать все» при поиске добавляет к уже отмеченным, не теряя их', () => {
    const state = toggleAllSelection({ selected: new Set([1]), allMode: false, excluded: new Set() }, [3, 4], true, false);
    expect([...state.selected].sort()).toEqual([1, 3, 4]);
    expect(state.allMode).toBe(false);
  });

  it('повторное «выбрать все» при поиске снимает только найденные', () => {
    const state = toggleAllSelection({ selected: new Set([1, 3]), allMode: false, excluded: new Set() }, [3], true, true);
    expect([...state.selected]).toEqual([1]);
  });

  it('без поиска «выбрать все» включает режим «все записи»', () => {
    const state = toggleAllSelection(empty(), ids, false, false);
    expect(state.allMode).toBe(true);
    expect(state.selected.size).toBe(0);
  });

  it('без поиска повторное нажатие снимает выбор', () => {
    const state = toggleAllSelection({ selected: new Set(), allMode: true, excluded: new Set() }, ids, false, true);
    expect(state.allMode).toBe(false);
    expect(state.selected.size).toBe(0);
  });
});
