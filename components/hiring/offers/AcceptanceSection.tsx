"use client";

import { AcceptDialog, AcceptancePanel } from "./Acceptance";
import type { OfferDetail, VersionView } from "./types";

/** The acceptance block once the offer is out (or accepted), with its dialog. */
export function AcceptanceSection({
  o,
  versions,
  accepting,
  onDialog,
}: {
  o: OfferDetail;
  versions: VersionView[];
  accepting: boolean;
  onDialog: (d: "accept" | null) => void;
}) {
  if (o.status !== "SENT" && o.status !== "ACCEPTED") return null;
  return (
    <>
      <AcceptancePanel o={o} versions={versions} onRecord={() => onDialog("accept")} />
      {accepting ? <AcceptDialog o={o} onClose={() => onDialog(null)} /> : null}
    </>
  );
}
