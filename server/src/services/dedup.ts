import { prisma } from "../prisma.js";
import { hamming } from "../lib/imageHash.js";

const PHASH_THRESHOLD = 5;

export async function findExactDuplicate(sha256: string, exceptUserId: number) {
  return prisma.profilePhoto.findFirst({
    where: { sha256, userId: { not: exceptUserId } },
    include: { user: { select: { id: true, nickname: true } } },
  });
}

export async function findSimilarOwners(phash: string, exceptUserId: number) {
  const candidates = await prisma.profilePhoto.findMany({
    where: { userId: { not: exceptUserId } },
    select: { phash: true, user: { select: { id: true, nickname: true } } },
  });
  const hits = new Map<number, string>();
  for (const c of candidates) {
    if (hamming(phash, c.phash) <= PHASH_THRESHOLD) hits.set(c.user.id, c.user.nickname);
  }
  return [...hits].map(([id, nickname]) => ({ id, nickname }));
}

export async function detectImpersonation(userId: number) {
  const photos = await prisma.profilePhoto.findMany({ where: { userId } });
  const owners = new Map<number, string>();
  for (const p of photos) {
    const exact = await findExactDuplicate(p.sha256, userId);
    if (exact) owners.set(exact.user.id, exact.user.nickname);
    const sim = await findSimilarOwners(p.phash, userId);
    sim.forEach((o) => owners.set(o.id, o.nickname));
  }
  return [...owners.values()];
}
