import { prisma } from "@/lib/prisma";

export type AppUserInput = {
  email: string;
  image?: string | null;
  name?: string | null;
};

export async function findUserIdByEmail(email: string) {
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  return user?.id ?? null;
}

export async function upsertAppUser(user: AppUserInput) {
  return prisma.user.upsert({
    where: {
      email: user.email,
    },
    create: {
      email: user.email,
      image: user.image ?? null,
      name: user.name ?? null,
    },
    update: {
      ...(user.image !== undefined ? { image: user.image } : {}),
      ...(user.name !== undefined ? { name: user.name } : {}),
    },
    select: {
      id: true,
    },
  });
}
