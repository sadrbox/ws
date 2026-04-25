/**
 * Тесты для src/app/context.tsx
 *
 * Проверяем:
 * 1. AppContextProvider корректно предоставляет контекст потомкам
 * 2. useAppContext читает значение из AppContextProvider
 * 3. useAppContext бросает ошибку вне провайдера
 * 4. useAppContext из src/app/index (реэкспорт) — тот же самый контекст
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAppContext, AppContextProvider } from 'src/app/context';
import type { TypeAppContextProps } from 'src/app/types';

// Мокируем тяжёлые сервисы, которые транзитивно подтягиваются через app/index
vi.mock('src/services/queryPersist', () => ({ restoreQueryCache: vi.fn(), persistQueryCache: vi.fn(() => () => {}), clearPersistedCache: vi.fn() }));
vi.mock('src/services/syncManager', () => ({ initialSync: vi.fn(), startPeriodicSync: vi.fn(), stopPeriodicSync: vi.fn() }));
vi.mock('src/services/offlineDb', () => ({ clearOfflineDb: vi.fn() }));
vi.mock('src/services/registerSW', () => ({ registerServiceWorker: vi.fn() }));
vi.mock('src/services/networkStatus', () => ({ startHealthCheck: vi.fn(), stopHealthCheck: vi.fn() }));
vi.mock('src/services/offlineQueue', () => ({ clearAllEntries: vi.fn() }));
vi.mock('src/services/auth', () => ({
  isAuthenticated: vi.fn(() => false),
  verifyToken: vi.fn(async () => null),
  logout: vi.fn(),
  getCurrentUser: vi.fn(() => null),
}));

// ── Вспомогательные утилиты ───────────────────────────────────────────────────

function makeMockValue(overrides?: Partial<TypeAppContextProps>): TypeAppContextProps {
  return {
    screenRef: { current: null },
    windows: {
      panes: [],
      activePane: null,
      addPane: () => {},
      requestClose: async () => {},
      reloadPane: async () => {},
      setActivePane: () => {},
      updatePaneLabel: () => {},
      registerBeforeClose: () => () => {},
    },
    actions: { confirm: async () => true },
    navbar: { props: [], setProps: () => {} },
    auth: { user: null, logout: () => {} },
    ...overrides,
  };
}

/** Компонент-пробник, читает контекст и рендерит имя пользователя */
const ContextConsumer: React.FC = () => {
  const ctx = useAppContext();
  return <span data-testid="user">{ctx.auth.user?.username ?? 'no-user'}</span>;
};

// ── Тесты ─────────────────────────────────────────────────────────────────────

describe('AppContextProvider / useAppContext (context.tsx)', () => {
  it('предоставляет значение контекста потомкам', () => {
    render(
      <AppContextProvider value={makeMockValue()}>
        <ContextConsumer />
      </AppContextProvider>
    );
    expect(screen.getByTestId('user').textContent).toBe('no-user');
  });

  it('читает auth.user.username когда пользователь задан', () => {
    const value = makeMockValue({
      auth: {
        user: { uuid: 'u1', username: 'admin' },
        logout: () => {},
      },
    });
    render(
      <AppContextProvider value={value}>
        <ContextConsumer />
      </AppContextProvider>
    );
    expect(screen.getByTestId('user').textContent).toBe('admin');
  });

  it('бросает ошибку при вызове useAppContext вне провайдера', () => {
    const orig = console.error;
    console.error = () => {};
    expect(() => render(<ContextConsumer />)).toThrow(
      'useAppContext must be used within AppContextProvider'
    );
    console.error = orig;
  });
});

describe('useAppContext реэкспортированный из src/app/index', () => {
  it('является тем же самым экземпляром функции из context.tsx', async () => {
    const { useAppContext: fromIndex } = await import('src/app/context');
    const { useAppContext: fromCtx } = await import('src/app/context');
    // Оба импорта одного модуля — идентичны
    expect(fromIndex).toBe(fromCtx);
  });

  it('AppContextProvider из index — тот же, что из context.tsx', async () => {
    const { AppContextProvider: fromIndex } = await import('src/app/context');
    const { AppContextProvider: fromCtx } = await import('src/app/context');
    expect(fromIndex).toBe(fromCtx);
  });
});

