import type { JdBlock } from "@/lib/hiring/careers-jd";

/** A JD rendered from blocks as React text — never HTML, so it cannot inject markup. */
export function JdBody({ blocks, empty }: { blocks: JdBlock[]; empty: string }) {
  if (blocks.length === 0) return <p className="mt-6 text-sm text-careers-muted">{empty}</p>;
  return (
    <article className="mt-6 space-y-4 text-careers-ink">
      {blocks.map((b, i) =>
        b.kind === "heading" ? (
          <h2 key={i} className="pt-2 text-h4 font-semibold text-careers-navy">
            {b.text}
          </h2>
        ) : b.kind === "list" ? (
          <ul key={i} className="list-disc space-y-1 ps-6 text-sm leading-relaxed">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-sm leading-relaxed">
            {b.text}
          </p>
        ),
      )}
    </article>
  );
}
