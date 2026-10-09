"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type PanelTab = "details" | "profile";

const ORDER: PanelTab[] = ["details", "profile"];

type TabProps = { id: PanelTab; selected: boolean; onSelect: (id: PanelTab) => void; setRef: (id: PanelTab, element: HTMLButtonElement | null) => void; children: ReactNode };

function Tab({ id, selected, onSelect, setRef, children }: TabProps) {
  return (
    <button
      ref={(element) => setRef(id, element)}
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(id)}
      className={`-mb-px px-3 py-2 text-sm font-semibold ${selected ? "border-b-2 border-accent text-ink" : "text-ink-soft hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

type Props = {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  details: ReactNode;
  profile: ReactNode;
};

/** The right column's two tabs (profile spec, section 11): a real tab list, the arrow keys moving the selection. */
export function PanelTabs({ tab, onTab, details, profile }: Props) {
  const buttons = useRef<Record<PanelTab, HTMLButtonElement | null>>({ details: null, profile: null });
  const setRef = (id: PanelTab, element: HTMLButtonElement | null) => {
    buttons.current[id] = element;
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = ORDER.indexOf(tab);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % ORDER.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + ORDER.length) % ORDER.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ORDER.length - 1;
    if (next === null) return;
    event.preventDefault();
    const id = ORDER[next];
    onTab(id);
    buttons.current[id]?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Right column" onKeyDown={onKeyDown} className="flex shrink-0 border-b border-line px-2 pt-1">
        {/* prettier-ignore */}
        <Tab id="details" selected={tab === "details"} onSelect={onTab} setRef={setRef}>Details</Tab>
        {/* prettier-ignore */}
        <Tab id="profile" selected={tab === "profile"} onSelect={onTab} setRef={setRef}>Profile</Tab>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1">
        {tab === "details" ? details : profile}
      </div>
    </div>
  );
}
