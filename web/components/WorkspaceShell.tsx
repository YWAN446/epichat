"use client";

import { useEffect, type ReactNode, type RefObject } from "react";

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
};

const DRAWER = "absolute inset-y-0 left-0 z-20 w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-paper xl:static xl:flex xl:w-64";
const SHEET = "absolute inset-y-0 right-0 z-20 w-96 max-w-[92vw] flex-col overflow-y-auto border-l border-line bg-paper xl:static xl:flex xl:w-96";

/** Three columns from xl; below that the sides are overlays with a backdrop, closed by Escape or a press outside. */
export function WorkspaceShell({ header, sidebar, panel, children, drawerOpen, sheetOpen, onClose, columnRef }: Props) {
  const overlay = drawerOpen || sheetOpen;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, onClose]);

  return (
    <div className="flex h-dvh flex-col">
      {header}
      <div className="relative flex min-h-0 flex-1">
        <aside aria-label="Conversations" className={`${drawerOpen ? "flex" : "hidden"} ${DRAWER}`}>
          {sidebar}
        </aside>
        <main ref={columnRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
        <aside aria-label="Details" className={`${sheetOpen ? "flex" : "hidden"} ${SHEET}`}>
          {panel}
        </aside>
        {overlay && <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 z-10 bg-ink/20 xl:hidden" />}
      </div>
    </div>
  );
}
