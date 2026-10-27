"use client";

import { useState } from "react";

/**
 * Open state for a dialog that can be driven from outside (the employee
 * record's Edit / Actions menus) or by its own trigger button. Controlled when
 * `open` is passed; the dialog then renders no trigger of its own.
 */
export function useControllableOpen(
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
): [boolean, (open: boolean) => void, boolean] {
  const [inner, setInner] = useState(false);
  const controlled = open !== undefined;
  const set = (next: boolean) => (controlled ? onOpenChange?.(next) : setInner(next));
  return [controlled ? open : inner, set, controlled];
}
