"use client";

import { useEffect, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { BOUNDS, dragWidth, nudgeWidth, type Layout, type Side } from "@/lib/client/layout";

type Props = {
  header: ReactNode;
  sidebar: ReactNode;
  panel: ReactNode;
  children: ReactNode;
  drawerOpen: boolean;
  sheetOpen: boolean;
  onClose: () => void;
  /** The middle column, which scrolls on its own. */
  columnRef: RefObject<HTMLElement | null>;
  /** Which side columns are open on wide screens, and how wide. */
  layout: Layout;
  onResize: (side: Side, width: number) => void;
};

const DRAWER = "absolute inset-y-0 left-0 z-20 w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-paper xl:static xl:w-(--column) xl:max-w-none";
const SHEET = "absolute inset-y-0 right-0 z-20 w-96 max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-paper xl:static xl:w-(--column) xl:max-w-none";
const HANDLE = "hidden w-1.5 shrink-0 cursor-col-resize hover:bg-accent-wash focus-visible:bg-accent-wash focus-visible:outline-none xl:block";

type HandleProps = { side: Side; width: number; label: string; onResize: (side: Side, width: number) => void };

/** A focusable splitter between a side column and the middle: drag it, or press the arrow keys, Home, or End. */
function Handle({ side, width, label, onResize }: HandleProps) {
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    const move = (pointer: globalThis.PointerEvent) => onResize(side, dragWidth(side, startWidth, startX, pointer.clientX));
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.setPointerCapture(event.pointerId);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
    event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = nudgeWidth(side, width, event.key);
    if (next === null) return;
    event.preventDefault();
    onResize(side, next);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={BOUNDS[side].min}
      aria-valuemax={BOUNDS[side].max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={HANDLE}
    />
  );
}

/**
 * Three columns from xl, each side collapsible and resizable; below that the
 * sides are overlays with a backdrop, closed by Escape or a press outside.
 */
export function WorkspaceShell({ header, sidebar, panel, children, drawerOpen, sheetOpen, onClose, columnRef, layout, onResize }: Props) {
  const overlay = drawerOpen || sheetOpen;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, onClose]);

  const leftStyle = { "--column": `${layout.left.width}px` } as CSSProperties;
  const rightStyle = { "--column": `${layout.right.width}px` } as CSSProperties;

  return (
    <div className="flex h-dvh flex-col">
      {header}
      <div className="relative flex min-h-0 flex-1">
        <aside aria-label="Conversations" style={leftStyle} className={`${drawerOpen ? "flex" : "hidden"} ${layout.left.open ? "xl:flex" : "xl:hidden"} ${DRAWER}`}>
          {sidebar}
        </aside>
        {layout.left.open && <Handle side="left" width={layout.left.width} label="Resize the conversations column" onResize={onResize} />}
        <main ref={columnRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
        {layout.right.open && <Handle side="right" width={layout.right.width} label="Resize the details column" onResize={onResize} />}
        <aside aria-label="Details" style={rightStyle} className={`${sheetOpen ? "flex" : "hidden"} ${layout.right.open ? "xl:flex" : "xl:hidden"} ${SHEET}`}>
          {panel}
        </aside>
        {overlay && <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 z-10 bg-ink/20 xl:hidden" />}
      </div>
    </div>
  );
}
