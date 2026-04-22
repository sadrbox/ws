/**
 * Тесты для src/hooks/useFormSessionStore.ts
 *
 * Проверяем:
 * 1. hadStoredData = false когда sessionStorage пуст (новая форма)
 * 2. hadStoredData = false когда в sessionStorage лежат ИДЕНТИЧНЫЕ по содержимому данные
 *    (ключевое исправление: ранее давало true из-за сравнения по ссылке)
 * 3. hadStoredData = true когда данные в sessionStorage реально отличаются
 * 4. Данные сохраняются в sessionStorage после setData
 * 5. clearStorage удаляет запись из sessionStorage
 * 6. clearAllFormStores очищает все записи с префиксом formStore:
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useFormSessionStore,
  clearAllFormStores,
} from 'src/hooks/useFormSessionStore';

const FORM = 'test-form';
const ID = 'entity-123';
const KEY = `formStore:${FORM}:${ID}`;

const INITIAL = { name: '', age: 0, active: false };

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  clearAllFormStores();
});

// ── Вспомогательная функция: записать в sessionStorage напрямую (имитация F5) ──
function seedStorage(value: object) {
  sessionStorage.setItem(KEY, JSON.stringify(value));
}

// ── Тесты ─────────────────────────────────────────────────────────────────────

describe('useFormSessionStore — hadStoredData', () => {
  it('false когда sessionStorage пуст (первый старт формы)', () => {
    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    const [, , , hadStoredData] = result.current;
    expect(hadStoredData).toBe(false);
  });

  it('false когда в sessionStorage лежат данные, идентичные initialValue (форма открыта, не изменена, страница обновлена)', () => {
    // Имитируем: форма была открыта → sessionStorage записал initialValue → страница обновилась
    seedStorage(INITIAL);

    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    const [, , , hadStoredData] = result.current;
    // Ключевое исправление: должно быть false, а не true
    expect(hadStoredData).toBe(false);
  });

  it('true когда данные в sessionStorage отличаются от initialValue (были реальные правки)', () => {
    const modified = { name: 'Иван', age: 30, active: true };
    seedStorage(modified);

    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    const [, , , hadStoredData] = result.current;
    expect(hadStoredData).toBe(true);
  });

  it('false при частичном совпадении — только одно поле отличается', () => {
    // Все поля совпадают — hadStoredData = false
    seedStorage({ ...INITIAL });
    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    expect(result.current[3]).toBe(false);
  });

  it('true если хотя бы одно поле отличается от initialValue', () => {
    seedStorage({ ...INITIAL, name: 'Changed' });
    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    expect(result.current[3]).toBe(true);
  });
});

describe('useFormSessionStore — чтение и запись', () => {
  it('возвращает initialValue при отсутствии данных в sessionStorage', () => {
    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    expect(result.current[0]).toEqual(INITIAL);
  });

  it('восстанавливает значение из sessionStorage при монтировании', () => {
    const stored = { name: 'Петр', age: 25, active: true };
    seedStorage(stored);

    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    expect(result.current[0]).toEqual(stored);
  });

  it('setData обновляет значение и сохраняет в sessionStorage', () => {
    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    const [, setData] = result.current;

    act(() => {
      setData({ name: 'Новое', age: 10, active: true });
    });

    expect(result.current[0]).toEqual({ name: 'Новое', age: 10, active: true });
    const raw = sessionStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ name: 'Новое', age: 10, active: true });
  });

  it('setData с функцией-updater обновляет значение на основе предыдущего', () => {
    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );

    act(() => {
      result.current[1]((prev) => ({ ...prev, age: 99 }));
    });

    expect(result.current[0].age).toBe(99);
  });
});

describe('useFormSessionStore — clearStorage', () => {
  it('удаляет запись из sessionStorage', () => {
    seedStorage({ name: 'Тест', age: 1, active: false });

    const { result } = renderHook(() =>
      useFormSessionStore(FORM, ID, INITIAL)
    );
    const [, , clearStorage] = result.current;

    act(() => clearStorage());

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe('clearAllFormStores', () => {
  it('удаляет все записи с префиксом formStore:', () => {
    sessionStorage.setItem('formStore:form-a:1', '{}');
    sessionStorage.setItem('formStore:form-b:2', '{}');
    sessionStorage.setItem('other-key', 'keep-me');

    clearAllFormStores();

    expect(sessionStorage.getItem('formStore:form-a:1')).toBeNull();
    expect(sessionStorage.getItem('formStore:form-b:2')).toBeNull();
    // не-formStore ключи не трогает
    expect(sessionStorage.getItem('other-key')).toBe('keep-me');
  });
});
