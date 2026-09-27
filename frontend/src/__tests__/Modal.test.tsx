import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Modal from 'src/components/Modal';
import modalManager from 'src/components/Modal/modalManager';
import { TestWrapper } from 'src/__tests__/utils/TestWrapper';

describe('Modal focus-trap and restore', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    modalManager.setScreenRef({ current: host });
    document.body.style.overflow = '';
  });

  afterEach(() => {
    modalManager.clearAll();
    try { if (host.parentNode) host.parentNode.removeChild(host); } catch { /* intentional */ }
    document.body.style.overflow = '';
  });

  it('focuses first focusable element and traps tab', async () => {
    render(
      <TestWrapper>
        <Modal title={<span>Test</span>} onClose={() => { }}>
          <div>
            <button>First</button>
            <button>Second</button>
          </div>
        </Modal>
      </TestWrapper>,
      { container: host }
    );

    const first = screen.getByText('First');
    const second = screen.getByText('Second');

    // focus should be on first
    expect(document.activeElement === first || document.activeElement === host).toBe(true);

    // tab to second
    await userEvent.tab();
    expect(document.activeElement === second).toBe(true);

    // после тела — кнопки шапки (аудит 26.09, И14: раньше «Отмена» была недостижима с клавиатуры)
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('Отмена');

    // tab cycles back to first
    await userEvent.tab();
    expect(document.activeElement === first).toBe(true);

    // shift+tab from first wraps to the header button, then to second
    await userEvent.tab({ shift: true });
    expect(document.activeElement?.textContent).toBe('Отмена');
    await userEvent.tab({ shift: true });
    expect(document.activeElement === second).toBe(true);
  });
});
