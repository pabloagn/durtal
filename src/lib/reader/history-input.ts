import { isEditableTarget } from "./input";
/** Intercept browser history only while the reader can actually travel in that direction. */
export function createHistoryInput(options: {
  blocked(): boolean;
  available(direction: -1 | 1): boolean;
  step(direction: -1 | 1): void;
}) {
  const removers = new Set<() => void>();
  return {
    attach(doc: Document) {
      const key = (event: KeyboardEvent) => {
        if (
          event.defaultPrevented ||
          options.blocked() ||
          isEditableTarget(event.target) ||
          !event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          !["ArrowLeft", "ArrowRight"].includes(event.key)
        )
          return;
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (!options.available(direction)) return;
        event.preventDefault();
        options.step(direction);
      };
      const mouse = (event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          options.blocked() ||
          ![3, 4].includes(event.button)
        )
          return;
        const direction = event.button === 3 ? -1 : 1;
        if (!options.available(direction)) return;
        event.preventDefault();
        if (event.type === "mouseup") options.step(direction);
      };
      doc.addEventListener("keydown", key, true);
      doc.addEventListener("mousedown", mouse, true);
      doc.addEventListener("mouseup", mouse, true);
      const remove = () => {
        doc.removeEventListener("keydown", key, true);
        doc.removeEventListener("mousedown", mouse, true);
        doc.removeEventListener("mouseup", mouse, true);
        removers.delete(remove);
      };
      removers.add(remove);
      return remove;
    },
    destroy() {
      for (const remove of [...removers]) remove();
    },
  };
}
