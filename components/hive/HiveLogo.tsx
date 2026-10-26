"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * §2.3's mark: interlocking honeycomb cells with a bee.
 *
 * "Three interlocking honeycomb cells representing the three group companies
 * (Rihal, Transformation Pioneers, Codeline), with room to visually extend to a
 * fourth cell if the group grows."
 *
 * Two things in that sentence are requirements rather than description, and both
 * are structural here:
 *
 * - **One cell per company.** Each cell takes its own hue from the spec's
 *   palette (`--hive-cell-1…4`), so "three companies" is something you can see
 *   rather than something the caption asserts. Three amber cells would have been
 *   a honeycomb; three distinct cells are three companies.
 * - **Room for a fourth.** The cells sit on a real flat-top hexagonal lattice
 *   and `cells` picks how many positions are filled, so a fourth company is
 *   `cells={4}` — not a redrawn SVG. Drawing three shapes by hand and calling
 *   them extensible would have satisfied the sentence and not the requirement.
 *
 * Every colour is a token, which is both what `no-raw-hex-color` requires of
 * .tsx and what lets the mark follow the theme: the dark values in globals.css
 * lift each hue and invert the bee, because a mid lavender on #030712 goes muddy
 * and a near-black bee on a near-black page is not a bee.
 *
 * @public
 */

/** Flat-top hexagon lattice, unit circumradius 1, in the order cells fill. */
const LATTICE = [
  { cx: 0, cy: 0 },
  { cx: 1.5, cy: 0.866 },
  { cx: 0, cy: 1.732 },
  // The fourth company's seat. These four are mutually adjacent on the lattice,
  // so a group of four closes into a block rather than sprouting a limb.
  { cx: 1.5, cy: 2.598 },
] as const;

/** Below this height the bee is a smudge, so it is dropped rather than drawn badly. */
const BEE_MIN_SIZE = 22;

function hexPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i);
    return `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`;
  });
  return `M${pts.join("L")}Z`;
}

export interface HiveLogoProps {
  /** Rendered height in px. The whole mark scales from this one number. */
  size?: number;
  /**
   * How many group companies. Three today; a fourth is a prop change, which is
   * §2.3's requirement that the mark leave room to grow.
   */
  cells?: 3 | 4;
  /**
   * Draw the bee. Defaults to "yes, if it will read" — below {@link BEE_MIN_SIZE}
   * it is three pixels of mud and hurts the mark.
   */
  bee?: boolean;
  /**
   * Animate the bee (§2.3: "loops or paces gently near the cluster"). Motion is
   * suppressed under `prefers-reduced-motion: reduce` in globals.css — this flag
   * says whether motion is WANTED, never whether it is allowed.
   */
  animated?: boolean;
  className?: string;
  /**
   * Accessible name. Default absent: the mark is nearly always beside the word
   * "HIVE", and announcing "HIVE logo, HIVE" is noise. Pass a label only where
   * the mark stands alone.
   */
  label?: string;
}

export function HiveLogo({
  size = 32,
  cells = 3,
  bee,
  animated = true,
  className,
  label,
}: HiveLogoProps) {
  // `useId`, not a prop. The clip-path id has to be unique per INSTANCE: two
  // marks with the same props emitted the same id, the browser resolved both to
  // the first `<clipPath>`, and unmounting that one left the survivor's stripes
  // rendering unclipped across the whole mark. A caller-supplied suffix made
  // correctness the caller's problem and defaulted to broken.
  const clipId = `hive-bee-clip-${useId().replace(/:/g, "")}`;
  const showBee = (bee ?? size >= BEE_MIN_SIZE) && size >= 12;
  const r = 1;
  // Cells are inset a hair so they interlock as separate cells rather than
  // merging into one blob at small sizes.
  const inset = 0.94;
  const used = LATTICE.slice(0, cells);

  const minX = Math.min(...used.map((c) => c.cx)) - r;
  const maxX = Math.max(...used.map((c) => c.cx)) + r;
  const minY = Math.min(...used.map((c) => c.cy)) - r;
  const maxY = Math.max(...used.map((c) => c.cy)) + r;
  const padX = showBee ? 0.46 : 0.08;
  const padTop = showBee ? 0.5 : 0.08;
  const vb = [minX - padX, minY - padTop, maxX - minX + padX * 2, maxY - minY + padTop + 0.08];
  const width = (size * vb[2]) / vb[3];

  // Bee body geometry, shared by the ellipse and the stripe clip.
  const bodyRx = 0.48;
  const bodyRy = 0.3;

  return (
    <svg
      viewBox={vb.map((n) => n.toFixed(3)).join(" ")}
      width={Math.round(width)}
      height={size}
      className={cn("hive-logo shrink-0", animated && showBee && "hive-logo--animated", className)}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {used.map((c, i) => (
        <path
          key={`${c.cx}-${c.cy}`}
          d={hexPath(c.cx, c.cy, r * inset)}
          fill={`var(--hive-cell-${i + 1})`}
          stroke="var(--hive-comb-edge)"
          strokeWidth={0.06}
          strokeLinejoin="round"
        />
      ))}

      {showBee && (
        <g
          className="hive-bee"
          // Tucked against the comb's upper-right vertex. The first placement
          // sat it above the notch between the two top cells, which read as a
          // detached speck rather than §2.3's bee "near the cluster".
          transform={`translate(${(maxX - 0.5).toFixed(3)} ${(minY + 0.46).toFixed(3)})`}
        >
          <defs>
            <clipPath id={clipId}>
              <ellipse cx={0} cy={0} rx={bodyRx} ry={bodyRy} />
            </clipPath>
          </defs>

          {/* Wings sit behind the body and swept back, not upright — upright
              reads as ears at every size below 56px. */}
          <g className="hive-bee__wings" opacity={0.6}>
            <ellipse
              cx={-0.15}
              cy={-0.3}
              rx={0.27}
              ry={0.105}
              transform="rotate(-32 -0.15 -0.30)"
              fill="var(--hive-bee-wing)"
            />
            <ellipse
              cx={0.17}
              cy={-0.31}
              rx={0.23}
              ry={0.095}
              transform="rotate(28 0.17 -0.31)"
              fill="var(--hive-bee-wing)"
            />
          </g>

          <g transform="rotate(-12)">
            <ellipse cx={0} cy={0} rx={bodyRx} ry={bodyRy} fill="var(--hive-bee-body)" />
            {/* Stripes are rectangles clipped to the body. The obvious approach
                — two elliptical arcs — renders one crescent down the right side
                instead of bands, because the sweep goes the long way round. */}
            <g clipPath={`url(#${clipId})`}>
              <rect
                x={-0.22}
                y={-bodyRy}
                width={0.135}
                height={bodyRy * 2}
                fill="var(--hive-bee-stripe)"
              />
              <rect
                x={0.02}
                y={-bodyRy}
                width={0.135}
                height={bodyRy * 2}
                fill="var(--hive-bee-stripe)"
              />
              <rect
                x={0.26}
                y={-bodyRy}
                width={0.135}
                height={bodyRy * 2}
                fill="var(--hive-bee-stripe)"
              />
            </g>
            {/* A head, so the silhouette has a direction and the bee looks like
                it is flying somewhere rather than hovering symmetrically. */}
            <ellipse cx={-0.38} cy={0} rx={0.115} ry={0.225} fill="var(--hive-bee-body)" />
          </g>
        </g>
      )}
    </svg>
  );
}
