"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollStrip } from "./ScrollStrip";

/**
 * The drag-and-drop half of the board (lazy-loaded — ADR-081). Columns are
 * drop zones; a drop calls `onMove` and the server decides. Pointer drags need
 * a 4px move first so a click still opens the card; the keyboard sensor makes
 * dragging work without a mouse (space to lift, arrows, space to drop).
 */
export type BoardColumn = { id: string; title: string; accent: string };
export type BoardItem = { id: string; columnId: string };

export function BoardDnd<T extends BoardItem>({
  columns,
  items,
  renderCard,
  onMove,
  cardClass,
}: {
  columns: BoardColumn[];
  items: T[];
  renderCard: (item: T) => ReactNode;
  onMove: (item: T, toColumnId: string) => void;
  cardClass?: (item: T) => string | undefined;
}) {
  const [active, setActive] = useState<T | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const item = items.find((i) => i.id === e.active.id);
    if (!item || !e.over) return;
    const to = String(e.over.id);
    if (to !== item.columnId) onMove(item, to);
  };
  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActive(items.find((i) => i.id === e.active.id) ?? null)}
      onDragCancel={() => setActive(null)}
      onDragEnd={onDragEnd}
    >
      <ScrollStrip className="pb-2">
        <div className="flex w-max gap-3">
          {columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              items={items.filter((i) => i.columnId === col.id)}
              renderCard={renderCard}
              cardClass={cardClass}
            />
          ))}
        </div>
      </ScrollStrip>
      <DragOverlay>
        {active ? (
          <div className="rounded-md border border-border bg-card p-3 shadow-md">
            {renderCard(active)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column<T extends BoardItem>({
  column,
  items,
  renderCard,
  cardClass,
}: {
  column: BoardColumn;
  items: T[];
  renderCard: (item: T) => ReactNode;
  cardClass?: (item: T) => string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.title} (${items.length})`}
      className={cn(
        "flex w-60 shrink-0 flex-col gap-2 rounded-lg p-3 transition-colors",
        isOver ? "bg-accent-subtle" : "bg-muted/50",
      )}
    >
      <header className="mb-1 flex items-center gap-2">
        <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", column.accent)} />
        <h3 className="text-sm font-bold text-foreground">{column.title}</h3>
        <span className="rounded-full bg-muted px-2 font-mono text-xs font-bold text-foreground">
          {items.length}
        </span>
      </header>
      {items.map((item) => (
        <Card key={item.id} item={item} className={cardClass?.(item)}>
          {renderCard(item)}
        </Card>
      ))}
    </section>
  );
}

function Card<T extends BoardItem>({
  item,
  className,
  children,
}: {
  item: T;
  className?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        touchAction: "none",
      }}
      className={cn(
        "cursor-grab rounded-md border border-border bg-card p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        isDragging && "opacity-40",
        className,
      )}
    >
      {children}
    </div>
  );
}
