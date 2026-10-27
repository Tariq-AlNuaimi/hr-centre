import Link from "next/link";

export type LinkCard = { href: string; title: string; description: string };

/**
 * A grid of destination cards: title + one-line purpose. Used by hub pages
 * (Admin › Settings, HR tickets setup) that list only what the viewer may open;
 * each destination gates itself server-side.
 */
export function LinkCards({ cards }: { cards: readonly LinkCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="flex flex-col gap-1 rounded-md border border-border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-medium">{card.title}</span>
          <span className="text-sm text-muted-foreground">{card.description}</span>
        </Link>
      ))}
    </div>
  );
}
