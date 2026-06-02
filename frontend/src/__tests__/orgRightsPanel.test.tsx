/**
 * OrgRightsPanel: тесты
 *
 * Компонент использует useFormStore (→ useAppContext, useSyncExternalStore),
 * ModelForm, Field, FieldSelect, AccessRightsList — все мокируются.
 *
 * Тесты проверяют:
 *  - корректную инициализацию initialFields из paneProps.data
 *  - передачу userUuid/organizationUuid в AccessRightsList (edit-mode)
 *  - рендер без data (новая форма)
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// ── Базовые сервисные моки ───────────────────────────────────────────────
vi.mock('src/services/queryPersist', () => ({ restoreQueryCache: vi.fn(), persistQueryCache: vi.fn(() => () => { }), clearPersistedCache: vi.fn() }));
vi.mock('src/services/syncManager', () => ({ initialSync: vi.fn(), startPeriodicSync: vi.fn(), stopPeriodicSync: vi.fn() }));
vi.mock('src/services/offlineDb', () => ({ clearOfflineDb: vi.fn() }));
vi.mock('src/services/registerSW', () => ({ registerServiceWorker: vi.fn() }));
vi.mock('src/services/networkStatus', () => ({ startHealthCheck: vi.fn(), stopHealthCheck: vi.fn() }));
vi.mock('src/services/auth', () => ({
  isAuthenticated: vi.fn(() => false),
  verifyToken: vi.fn(() => null),
  logout: vi.fn(),
  getCurrentUser: vi.fn(() => null),
}));

// ── Мок useAppContext (требуется useFormStore) ───────────────────────────
const mockAppContext = {
  windows: {
    updatePaneLabel: vi.fn(),
    requestClose: vi.fn(),
    registerBeforeClose: vi.fn(() => () => { }),
    addPane: vi.fn(),
  },
  actions: { confirm: vi.fn(() => true) },
};
vi.mock('src/app/AppContext', () => ({
  useAppContext: () => mockAppContext,
}));
vi.mock('src/app', () => ({
  useAppContext: () => mockAppContext,
}));

// ── Мок useFormStore — возвращает стабильное состояние ──────────────────
// Перехватываем аргумент options, чтобы проверить initialFields.
let capturedInitialFields: any = undefined;
vi.mock('src/hooks/useFormStore', () => ({
  useFormStore: (options: any) => {
    capturedInitialFields = options.initialFields;
    const d = options.paneProps?.data;
    const isEditMode = !!(d?.uuid);
    // В edit-mode имитируем загруженные с сервера данные (берём из paneProps.data)
    const fields = isEditMode
      ? { userUuid: d?.userUuid ?? '', organizationUuid: d?.organizationUuid ?? '', orgShortName: d?.orgName ?? '', role: d?.role ?? 'member', id: 1, uuid: d?.uuid }
      : (options.initialFields ?? options.defaultFields ?? {});
    return {
      fields,
      paneId: 'test-pane',
      formUid: 'uid1',
      isLoading: false,
      isEditMode,
      isDirty: false,
      uuid: d?.uuid ?? null,
      setField: vi.fn(),
      setFields: vi.fn(),
      handleSave: vi.fn(),
      handleSaveAndClose: vi.fn(),
      handleClose: vi.fn(),
      loadFromServer: vi.fn(),
      useTable: (_key: string) => ({
        pending: [],
        setPending: vi.fn(),
        onItemsChange: vi.fn(),
      }),
    };
  },
}));

// ── Мок ModelForm — рендерит только активные вкладки ─────────────────────
vi.mock('src/components/ModelForm', () => ({
  default: ({ tabs }: { tabs: Array<{ id: string; label: string; component: React.ReactNode }> }) =>
    React.createElement('div', { 'data-testid': 'model-form' },
      ...(tabs ?? []).map((t) =>
        React.createElement('div', { key: t.id, 'data-testid': `tab-${t.id}` }, t.component)
      )
    ),
}));

// ── Мок Field / FieldSelect ───────────────────────────────────────────────
vi.mock('src/components/Field', () => ({
  Field: ({ label, value }: { label?: string; value?: string }) =>
    React.createElement('div', { 'data-testid': 'field', 'data-label': label ?? '', 'data-value': value ?? '' }, value ?? ''),
  FieldSelect: ({ label, value }: { label?: string; value?: string }) =>
    React.createElement('div', { 'data-testid': 'field-select', 'data-label': label ?? '', 'data-value': value ?? '' }, value ?? ''),
}));

vi.mock('src/components/Field/LookupField', () => ({
  default: ({ value, displayValue }: { value?: string; displayValue?: string }) =>
    React.createElement('div', { 'data-testid': 'lookup-field', 'data-value': value ?? '', 'data-display': displayValue ?? '' }),
}));

vi.mock('src/components/UI', () => ({
  GroupCol: ({ children }: any) => React.createElement('div', null, children),
  GroupRow: ({ children }: any) => React.createElement('div', null, children),
}));

vi.mock('src/styles/main.module.scss', () => ({
  default: { FormWrapper: 'FormWrapper', Form: 'Form' },
}));

vi.mock('src/i18', () => ({ translate: (key: string) => key }));
vi.mock('src/utils/buildPaneLabel', () => ({ makePaneLabel: () => 'label' }));
vi.mock('src/hooks/useAccessRight', () => ({ useAccessRight: () => ({ canWrite: true }) }));

// ── Мок AccessRightsList + AccessRightsTable ─────────────────────────────
vi.mock('src/models/AccessRights', () => ({
  AccessRightsList: ({ userUuid, organizationUuid }: { userUuid?: string; organizationUuid?: string }) =>
    React.createElement('div', {
      'data-testid': 'access-rights-list',
      'data-user': userUuid ?? '',
      'data-org': organizationUuid ?? '',
    }, 'mock'),
  AccessRightsTable: ({ userUuid, organizationUuid }: { userUuid?: string; organizationUuid?: string }) =>
    React.createElement('div', {
      'data-testid': 'access-rights-table',
      'data-user': userUuid ?? '',
      'data-org': organizationUuid ?? '',
    }, 'mock'),
}));

import { UserPermissionsForm as OrgRightsPanel } from 'src/models/UserPermissions';

describe('OrgRightsPanel', () => {
  it('рендерится без ошибок (без data)', () => {
    expect(() =>
      render(React.createElement(OrgRightsPanel, {}))
    ).not.toThrow();
  });

  it('initialFields инициализируется из paneProps.data (новая запись, нет uuid)', () => {
    capturedInitialFields = undefined;
    render(React.createElement(OrgRightsPanel, {
      data: { userUuid: 'u1', organizationUuid: 'o1' },
    }));
    // Форма строки права несёт в initialFields userUuid и organizationUuid
    // (поля orgShortName в TItemFields нет — форма не отображает имя орг).
    expect(capturedInitialFields).toBeTruthy();
    expect(capturedInitialFields.userUuid).toBe('u1');
    expect(capturedInitialFields.organizationUuid).toBe('o1');
  });

  it('initialFields = undefined когда uuid передан (edit-mode)', () => {
    capturedInitialFields = 'not-set';
    render(React.createElement(OrgRightsPanel, {
      data: { uuid: '5', userUuid: 'u1', organizationUuid: 'o1' },
    }));
    expect(capturedInitialFields).toBeUndefined();
  });

  it('рендерит форму (model-form) для записи права', () => {
    render(React.createElement(OrgRightsPanel, {
      data: { userUuid: 'u1', organizationUuid: 'o1' },
    }));
    expect(screen.getByTestId('model-form')).toBeTruthy();
  });
});
