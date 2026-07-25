import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ToolbarDropdown from "src/components/Toolbar/ToolbarDropdown";

// CSS-модуль и хук позиционирования не важны для логики выбора.
vi.mock("src/components/Toolbar/Toolbar.module.scss", () => ({ default: {} }));
vi.mock("src/components/Toolbar/useDropdownPosition", () => ({
  useDropdownMenu: () => {
    let open = false;
    // Простейший стаб: toggle меняет open через ре-рендер родителя не нужен —
    // в тестах открываем через клик и проверяем содержимое (open начинается true).
    return {
      open: true,
      toggle: () => { open = !open; },
      setOpen: vi.fn(),
      wrapRef: { current: null },
      dropRef: { current: null },
      dropStyle: {},
    };
  },
}));
vi.mock("src/components/IconButton/IconButton", () => ({
  default: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    <button onClick={onClick}>{children}</button>,
}));

const OPTIONS = [
  { id: "a", label: "Первый" },
  { id: "b", label: "Второй", disabled: true },
  { id: "c", label: "Третий" },
];

describe("ToolbarDropdown — единый тулбар-дропдаун", () => {
  it("рендерит все пункты меню", () => {
    render(<ToolbarDropdown options={OPTIONS} onSelect={() => {}} trigger={<span>T</span>} />);
    expect(screen.getByText("Первый")).toBeTruthy();
    expect(screen.getByText("Второй")).toBeTruthy();
    expect(screen.getByText("Третий")).toBeTruthy();
  });

  it("клик по пункту вызывает onSelect с его id", () => {
    const onSelect = vi.fn();
    render(<ToolbarDropdown options={OPTIONS} onSelect={onSelect} trigger={<span>T</span>} />);
    fireEvent.click(screen.getByText("Третий"));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("disabled-пункт не вызывает onSelect", () => {
    const onSelect = vi.fn();
    render(<ToolbarDropdown options={OPTIONS} onSelect={onSelect} trigger={<span>T</span>} />);
    fireEvent.click(screen.getByText("Второй"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ведущая иконка пункта рендерится, когда задана", () => {
    render(
      <ToolbarDropdown
        options={[{ id: "x", label: "С иконкой", icon: <i data-testid="ic" /> }]}
        onSelect={() => {}}
        trigger={<span>T</span>}
      />,
    );
    expect(screen.getByTestId("ic")).toBeTruthy();
  });
});
