/**
 * AccessRightsList: unit-тесты логики пропсов
 *
 * Тестируем изолированную логику формирования пропсов SubTable
 * (extraQueryParams и showEditModeToggle), не рендеря компонент.
 */
import { describe, it, expect } from 'vitest';

// ── Логика extraQueryParams (воспроизводит AccessRightsList) ──────────────────

function getExtraQueryParams(organizationUuid?: string): Record<string, string> | undefined {
  return organizationUuid ? { organizationUuid } : undefined;
}

// ── Логика showEditModeToggle ─────────────────────────────────────────────────────

function getshowEditModeToggle(deferRemoteChanges: boolean): boolean {
  return !deferRemoteChanges;
}

// ── Логика defaultNewRow ──────────────────────────────────────────────────────

const FIRST_MODEL = "Organization"; // первый реальный model в списке

function getDefaultNewRow(
  userUuid?: string,
  organizationUuid?: string,
  firstModelName = FIRST_MODEL,
): Record<string, unknown> | undefined {
  if (!userUuid) return undefined;
  return {
    modelName: firstModelName,
    accessLevel: "none",
    userUuid,
    ...(organizationUuid ? { organizationUuid } : {}),
  };
}

// ── Логика disabled ───────────────────────────────────────────────────────────

function getDisabled(userUuid?: string): boolean {
  return !userUuid;
}

// ── Тесты ─────────────────────────────────────────────────────────────────────

describe('AccessRightsList: extraQueryParams логика', () => {
  it('с organizationUuid → объект { organizationUuid }', () => {
    expect(getExtraQueryParams('org-42')).toEqual({ organizationUuid: 'org-42' });
  });

  it('без organizationUuid → undefined', () => {
    expect(getExtraQueryParams()).toBeUndefined();
    expect(getExtraQueryParams(undefined)).toBeUndefined();
  });

  it('пустая строка → undefined (falsy)', () => {
    expect(getExtraQueryParams('')).toBeUndefined();
  });
});

describe('AccessRightsList: showEditModeToggle логика', () => {
  it('deferRemoteChanges=false → showEditModeToggle=true (кнопка видна)', () => {
    expect(getshowEditModeToggle(false)).toBe(true);
  });

  it('deferRemoteChanges=true → showEditModeToggle=false (кнопка скрыта)', () => {
    expect(getshowEditModeToggle(true)).toBe(false);
  });
});

describe('AccessRightsList: defaultNewRow логика', () => {
  it('с userUuid и organizationUuid → строка содержит все поля', () => {
    const row = getDefaultNewRow('user-1', 'org-1');
    expect(row?.userUuid).toBe('user-1');
    expect(row?.organizationUuid).toBe('org-1');
    expect(row?.modelName).toBe(FIRST_MODEL);
    expect(row?.accessLevel).toBe('none');
  });

  it('с userUuid без organizationUuid → только userUuid + modelName + accessLevel', () => {
    const row = getDefaultNewRow('user-1');
    expect(row?.userUuid).toBe('user-1');
    expect(row?.organizationUuid).toBeUndefined();
    expect(row?.modelName).toBe(FIRST_MODEL);
  });

  it('без userUuid → undefined (нельзя создавать запись)', () => {
    expect(getDefaultNewRow(undefined, 'org-1')).toBeUndefined();
  });

  it('modelName не пустой (не placeholder)', () => {
    const row = getDefaultNewRow('user-1');
    expect(row?.modelName).not.toBe('');
    expect(row?.modelName).toBeTruthy();
  });
});

describe('AccessRightsList: disabled логика', () => {
  it('без userUuid → disabled=true', () => {
    expect(getDisabled(undefined)).toBe(true);
    expect(getDisabled('')).toBe(true);
  });

  it('с userUuid → disabled=false', () => {
    expect(getDisabled('user-1')).toBe(false);
  });
});
