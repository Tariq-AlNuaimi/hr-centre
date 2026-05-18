// Shared shape for polymorphic access to soft-deletable Prisma delegates.
// The recycling-bin routes index `prismaUnfiltered` by string at runtime;
// Prisma's per-model types can't express that without an explicit cast.
// Centralizing the shape here keeps the cast safer than `any`.

export type RecyclableRecord = {
  id: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  [key: string]: unknown;
};

export type RecyclableDelegate = {
  findMany: (args: {
    where: { deletedAt: { not: null } };
    orderBy?: { deletedAt: "desc" };
    take?: number;
  }) => Promise<RecyclableRecord[]>;
  findUnique: (args: { where: { id: string } }) => Promise<RecyclableRecord | null>;
  update: (args: {
    where: { id: string };
    data: { deletedAt: null; deletedBy: null };
  }) => Promise<RecyclableRecord>;
  delete: (args: { where: { id: string } }) => Promise<RecyclableRecord>;
};
