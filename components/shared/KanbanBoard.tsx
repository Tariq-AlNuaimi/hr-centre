"use client";

// Public entry point for the KanbanBoard component. The @dnd-kit drag-and-drop
// bundle lives in ./KanbanBoard.impl and is loaded lazily via next/dynamic with
// { ssr: false }, so pages that never render a board don't pay for @dnd-kit. The
// public API (the `KanbanBoard` component + its exported types) is unchanged --
// existing imports from "@/components/shared/KanbanBoard" keep working.

import dynamic from "next/dynamic";
import type {
  KanbanBoardProps,
  KanbanColumn,
  KanbanItem,
} from "./KanbanBoard.impl";

export type { KanbanBoardProps, KanbanColumn, KanbanItem };

// `dynamic` erases the generic signature, so re-assert it on the exported binding.
export const KanbanBoard = dynamic(
  () => import("./KanbanBoard.impl").then((m) => m.KanbanBoard),
  { ssr: false }
) as <T extends KanbanItem>(
  props: KanbanBoardProps<T>
) => React.ReactElement;
