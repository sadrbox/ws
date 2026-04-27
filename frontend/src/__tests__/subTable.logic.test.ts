/**
 * SubTable: unit-тесты для логики showEditModeToggle и _untouched
 *
 * Подход: тестируем изолированную логику (не рендер компонента),
 * т.к. SubTable имеет множество тяжёлых зависимостей (react-query, api, и т.д.)
 *
 * Проверяем:
 * 1. showEditModeToggle определяет видимость кнопки через props объект
 * 2. _untouched: с defaultNewRow флаг НЕ ставится
 * 3. _untouched: без defaultNewRow флаг ставится
 * 4. filterRows: строки с _untouched фильтруются при передаче наружу
 */
import { describe, it, expect } from 'vitest';

// ── Логика _untouched (воспроизводит handleInlineAdd из SubTable) ─────────────

function createPendingRow(opts: {
  parentKey: string;
  parentUuid: string;
  columns: Array<{ identifier: string; type: string }>;
  defaultNewRow?: Record<string, unknown>;
  extraQueryParams?: Record<string, unknown>;
}): Record<string, unknown> {
  const { parentKey, parentUuid, columns, defaultNewRow, extraQueryParams } = opts;
  const tmpUuid = `tmp-${Date.now()}`;
  const newRow: Record<string, unknown> = {
    id: -1,
    uuid: tmpUuid,
    [parentKey]: parentUuid,
    ...(extraQueryParams ?? {}),
  };
  columns.forEach((c) => {
    if (!(c.identifier in newRow)) newRow[c.identifier] = c.type === 'number' ? null : '';
  });
  if (defaultNewRow) {
    Object.assign(newRow, defaultNewRow);
  }
  // Логика из SubTable: _untouched только если нет defaultNewRow
  if (!defaultNewRow) {
    newRow._untouched = true;
  }
  newRow._pendingAction = 'create';
  return newRow;
}

function filterUntouched(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((r) => !r._untouched);
}

// ── Логика showEditModeToggle (условие из extraButtons) ───────────────────────────

function shouldshowEditModeToggle(readonly: boolean, showEditModeToggle: boolean): boolean {
  return !readonly && showEditModeToggle;
}

// ── Тесты ─────────────────────────────────────────────────────────────────────

describe('SubTable: showEditModeToggle логика', () => {
  it('readonly=false, showEditModeToggle=true → кнопка видна', () => {
    expect(shouldshowEditModeToggle(false, true)).toBe(true);
  });

  it('readonly=false, showEditModeToggle=false → кнопка скрыта', () => {
    expect(shouldshowEditModeToggle(false, false)).toBe(false);
  });

  it('readonly=true, showEditModeToggle=true → кнопка скрыта', () => {
    expect(shouldshowEditModeToggle(true, true)).toBe(false);
  });

  it('readonly=true, showEditModeToggle=false → кнопка скрыта', () => {
    expect(shouldshowEditModeToggle(true, false)).toBe(false);
  });
});

describe('SubTable: _untouched flag при создании строки', () => {
  const columns = [{ identifier: 'name', type: 'text' }];
  const opts = { parentKey: 'parentUuid', parentUuid: 'p-1', columns };

  it('с defaultNewRow: _untouched НЕ устанавливается', () => {
    const row = createPendingRow({ ...opts, defaultNewRow: { name: 'default' } });
    expect(row._untouched).toBeUndefined();
  });

  it('без defaultNewRow: _untouched устанавливается', () => {
    const row = createPendingRow(opts);
    expect(row._untouched).toBe(true);
  });

  it('_pendingAction всегда "create"', () => {
    const row = createPendingRow({ ...opts, defaultNewRow: { name: 'x' } });
    expect(row._pendingAction).toBe('create');
  });

  it('значения defaultNewRow перекрывают инициализацию колонок', () => {
    const row = createPendingRow({ ...opts, defaultNewRow: { name: 'override' } });
    expect(row.name).toBe('override');
  });
});

describe('SubTable: фильтрация _untouched строк при передаче наружу', () => {
  it('строки с _untouched исключаются', () => {
    const rows = [
      { id: 1, name: 'saved', _pendingAction: 'create' },
      { id: -1, name: '', _pendingAction: 'create', _untouched: true },
    ];
    expect(filterUntouched(rows)).toHaveLength(1);
    expect(filterUntouched(rows)[0].name).toBe('saved');
  });

  it('строки без _untouched остаются', () => {
    const rows = [
      { id: -1, name: 'filled', _pendingAction: 'create' },
    ];
    expect(filterUntouched(rows)).toHaveLength(1);
  });

  it('пустой массив → пустой массив', () => {
    expect(filterUntouched([])).toHaveLength(0);
  });
});
