import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Modal from 'src/components/Modal';
import modalManager from 'src/components/Modal/modalManager';
import { TestWrapper } from 'src/__tests__/utils/TestWrapper';

describe('nested modals behavior', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    modalManager.setScreenRef({ current: host });
    document.body.style.overflow = '';
  });

  afterEach(() => {
    modalManager.clearAll();
    try { if (host.parentNode) host.parentNode.removeChild(host); } catch {}
    document.body.style.overflow = '';
  });

  it('inner modal traps focus and restores focus to outer on close; body scroll locked while any modal open', async () => {
    const Wrapper: React.FC = () => {
      const [innerOpen, setInnerOpen] = useState(false);
      const [outerOpen, setOuterOpen] = useState(true);

      return (
        <div>
          {outerOpen && (
            <Modal title={<span>Outer</span>} onClose={() => setOuterOpen(false)}>
              <div>
                <button>OuterFirst</button>
                <button>OuterSecond</button>
                <button onClick={() => setInnerOpen(true)}>OpenInner</button>
              </div>
            </Modal>
          )}

          {innerOpen && (
            <Modal title={<span>Inner</span>} onClose={() => setInnerOpen(false)}>
              <div>
                <button>InnerFirst</button>
                <button>InnerSecond</button>
              </div>
            </Modal>
          )}
        </div>
      );
    };

    render(<TestWrapper><Wrapper /></TestWrapper>, { container: host });

    const outerFirst = screen.getByText('OuterFirst');
    const openInner = screen.getByText('OpenInner');

    // Body should be locked when outer opened
    expect(document.body.style.overflow).toBe('hidden');
    // focus initially should be on OuterFirst (or host fallback)
    expect(document.activeElement === outerFirst || document.activeElement === host).toBe(true);

    // open inner modal
    await userEvent.click(openInner);

    const innerFirst = await screen.findByText('InnerFirst');
    // now focus should be on innerFirst
    expect(document.activeElement === innerFirst).toBe(true);
    // body still locked
    expect(document.body.style.overflow).toBe('hidden');

    // close inner by clicking its Close button (Modal provides a Close button text 'Закрыть')
    const closeButtons = screen.getAllByText('Закрыть');
    // the last close button corresponds to inner modal
    await userEvent.click(closeButtons[closeButtons.length - 1]);

    // after closing inner, focus should be restored to outerFirst
    expect(document.activeElement === outerFirst).toBe(true);
    // body still locked because outer is open
    expect(document.body.style.overflow).toBe('hidden');

    // finally close outer
    // click the first close button (outer)
    await userEvent.click(closeButtons[0]);
    // now no modals — overflow restored
    expect(document.body.style.overflow === '' || document.body.style.overflow === null).toBe(true);
  });
});
