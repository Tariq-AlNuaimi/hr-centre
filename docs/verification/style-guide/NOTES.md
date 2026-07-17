# Style-guide / archetypes captures (V2-303 evidence)

`docs/verification/style-guide/style-guide.desktop.{light,dark}.png` — the `/style-guide` route
(captured via `npm run capture -- --feature style-guide --routes /style-guide`, local app + native
Postgres). Shows the **Page archetypes (V2-303)** section rendering all five archetypes on the
V2-302 primitives (Dashboard=StatGrid, Detail=DescriptionList, Form=FormLayout, List=Toolbar+
EmptyState, Settings=grouped controls), plus the full token/control gallery.

Self-critique (10-pt rubric): grid/hierarchy/spacing/state/copy ✓; **dark holds** (dark capture);
one-primary respected per archetype block; responsive (mobile matrix captured, not committed to keep
the repo light — regenerate with `npm run capture`). This is V2-302's RTL/dark-by-construction
evidence (logical utilities) + V2-303's "archetypes render" evidence in one surface.
