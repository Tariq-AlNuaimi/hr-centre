"use client";

// Generic drag-and-drop Kanban board for the template's UI vocabulary.
//
// Pairs well with /scaffold-entity output that includes a status enum:
// the columns are the enum values, items are the entity rows, onMove
// triggers a PUT /api/<entity>/[id] with { status: newColumnId }.
//
// Example:
//
//   const columns = [
//     { id: "TODO", title: "To do", color: "#888" },
//     { id: "IN_PROGRESS", title: "In progress", color: "#1677ff" },
//     { id: "DONE", title: "Done", color: "#52c41a" },
//   ];
//
//   <KanbanBoard
//     columns={columns}
//     items={tasks.map(t => ({ ...t, columnId: t.status }))}
//     renderCard={(t) => <><b>{t.title}</b><div>{t.assignee?.name}</div></>}
//     onMove={async (task, _from, to) => {
//       await fetch(`/api/tasks/${task.id}`, {
//         method: "PUT",
//         headers: { "content-type": "application/json" },
//         body: JSON.stringify({ status: to }),
//       });
//       refetch();
//     }}
//   />
//
// Notes:
//   - The board does optimistic-OFF: onMove fires after drop, and the caller
//     is responsible for refetching / locally mutating. Add optimistic update
//     in the consumer if needed.
//   - Cards keep their grab cursor at rest. The DragOverlay shows the picked-up
//     card following the pointer.

import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import { Card } from "@/components/ui/card";

export interface KanbanColumn {
  id: string;
  title: string;
  /** Optional CSS color applied to the column title. */
  color?: string;
}

export interface KanbanItem {
  id: string;
  /** Must match one of the column ids. */
  columnId: string;
}

export interface KanbanBoardProps<T extends KanbanItem> {
  columns: KanbanColumn[];
  items: T[];
  renderCard: (item: T) => ReactNode;
  /**
   * Called after a successful drop into a different column. Not called when
   * the card is dropped on its own column or outside any column.
   */
  onMove: (item: T, fromColumnId: string, toColumnId: string) => void;
}

export function KanbanBoard<T extends KanbanItem>({
  columns,
  items,
  renderCard,
  onMove,
}: KanbanBoardProps<T>) {
  const [activeItem, setActiveItem] = useState<T | null>(null);

  // Require a small pointer movement before a drag starts so click-throughs on
  // cards (edit, delete, link) keep working.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const item = items.find((i) => i.id === event.active.id);
    if (item) setActiveItem(item);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    if (!event.over) return;
    const item = items.find((i) => i.id === event.active.id);
    if (!item) return;
    const targetColId = String(event.over.id);
    if (item.columnId === targetColId) return;
    onMove(item, item.columnId, targetColId);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ display: "flex", gap: 16, overflowX: "auto", padding: "4px 0" }}>
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            items={items.filter((i) => i.columnId === col.id)}
            renderCard={renderCard}
          />
        ))}
      </div>
      <DragOverlay>
        {activeItem ? <Card className="p-3">{renderCard(activeItem)}</Card> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn<T extends KanbanItem>({
  column,
  items,
  renderCard,
}: {
  column: KanbanColumn;
  items: T[];
  renderCard: (item: T) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 280,
        flex: "0 0 280px",
        padding: 12,
        borderRadius: 8,
        background: isOver ? "rgba(22,119,255,0.08)" : "rgba(0,0,0,0.02)",
        transition: "background 0.15s",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 12, color: column.color }}>
        {column.title}{" "}
        <span style={{ opacity: 0.5, fontWeight: 400 }}>({items.length})</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <BoardCard key={item.id} item={item}>
            {renderCard(item)}
          </BoardCard>
        ))}
      </div>
    </div>
  );
}

function BoardCard<T extends KanbanItem>({
  item,
  children,
}: {
  item: T;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });

  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? "grabbing" : "grab",
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="p-3">{children}</Card>
    </div>
  );
}
