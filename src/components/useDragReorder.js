import { useState } from 'react';

// Minimal HTML5 drag-to-reorder. Spread handlers(index) onto each row's drag
// handle (or the row). onReorder(newArray) fires on drop with a fresh array
// whose `order` fields are renumbered to match the new positions.
export function useDragReorder(items, onReorder) {
  const [draggingIndex, setDragging] = useState(null);
  const handlers = (index) => ({
    draggable: true,
    onDragStart: (e) => { setDragging(index); e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDrop: (e) => {
      e.preventDefault();
      if (draggingIndex == null || draggingIndex === index) { setDragging(null); return; }
      const next = [...items];
      const [moved] = next.splice(draggingIndex, 1);
      next.splice(index, 0, moved);
      onReorder(next.map((it, i) => ({ ...it, order: i })));
      setDragging(null);
    },
    onDragEnd: () => setDragging(null),
  });
  return { handlers, draggingIndex };
}
