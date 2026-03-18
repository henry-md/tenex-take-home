import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";

import { authOptions } from "@/auth";
import { resetDefaultBucketSettings } from "@/lib/inbox/classification";

function getBucketOwner(session: Session | null) {
  const ownerEmail = session?.user?.email;

  if (!ownerEmail) {
    return null;
  }

  return {
    email: ownerEmail,
    image: session.user?.image,
    name: session.user?.name,
  };
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const owner = getBucketOwner(session);

  if (!owner) {
    return NextResponse.json(
      {
        error: "Authentication required.",
      },
      { status: 401 },
    );
  }

  try {
    const buckets = await resetDefaultBucketSettings({
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
    });

    return NextResponse.json({ buckets });
  } catch (error) {
    console.error("Resetting default buckets failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset default buckets.",
      },
      { status: 500 },
    );
  }
}
