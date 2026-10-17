export function openPrintable(html: string) {
  const opened = window.open("", "_blank");
  if (!opened) return false;
  opened.document.open();
  opened.document.write(html);
  opened.document.close();
  const save = () => {
    opened.focus();
    opened.print();
  };
  opened.document.querySelector("[data-print]")?.addEventListener("click", save);
  return true;
}
