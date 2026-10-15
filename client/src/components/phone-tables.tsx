import { useEffect } from "react";

export function usePhoneTables(root: HTMLElement | null) {
  useEffect(() => {
    if (!root) return;
    let frame = 0;
    const apply = () => {
      root.querySelectorAll("table.data").forEach((table) => {
        const headers = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "");
        table.querySelectorAll("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, index) => {
            if (!(cell instanceof HTMLTableCellElement)) return;
            const label = headers[index] ?? "";
            if (cell.dataset.label !== label) cell.dataset.label = label;
          });
        });
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [root]);
}
