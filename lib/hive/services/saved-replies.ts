import { prisma } from "@/lib/prisma";

/**
 * Saved replies (UX review tickets P1-4; Zendesk macros): reusable answer text
 * HR inserts into a draft, plus reference snippets drawn from the data Siraaj
 * answers from (discount partners), so a draft quotes the same facts the
 * assistant does. Bounded lists. Writes are Edit content (the route checks).
 */

export async function listSavedReplies(pairId: string | null) {
  return prisma.hiveSavedReply.findMany({
    where: pairId ? { OR: [{ hrPairId: null }, { hrPairId: pairId }] } : {},
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, title: true, body: true, hrPair: { select: { id: true, name: true } } },
  });
}

/** Discount partners as one-line snippets ("Name — offer"), current ones only. */
export async function referenceSnippets(now: Date = new Date()) {
  const partners = await prisma.discountPartner.findMany({
    where: { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    take: 50,
    select: { id: true, name: true, offerSummary: true },
  });
  return partners.map((p) => ({ id: p.id, title: p.name, body: `${p.name} — ${p.offerSummary}` }));
}

export type SavedReplyInput = { title: string; body: string; hrPairId: string | null };

export async function createSavedReply(input: SavedReplyInput, userId: string) {
  return prisma.hiveSavedReply.create({
    data: { ...input, createdById: userId },
    select: { id: true },
  });
}

export async function updateSavedReply(id: string, input: SavedReplyInput) {
  const found = await prisma.hiveSavedReply.findUnique({ where: { id }, select: { id: true } });
  if (!found) return null;
  return prisma.hiveSavedReply.update({ where: { id }, data: input, select: { id: true } });
}

export async function deleteSavedReply(id: string) {
  const found = await prisma.hiveSavedReply.findUnique({ where: { id }, select: { id: true } });
  if (!found) return false;
  await prisma.hiveSavedReply.delete({ where: { id }, select: { id: true } });
  return true;
}
