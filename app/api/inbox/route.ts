import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";

import { authOptions } from "@/auth";
import { loadInboxHomepage } from "@/lib/inbox/classification";

function getInboxOwner(session: Session | null) {
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

export async function GET() {
  const session = await getServerSession(authOptions);
  const owner = getInboxOwner(session);

  if (!session || !owner || !session.accessToken || session.authError) {
    return NextResponse.json(
      {
        error: "Sign in with Google again to load the inbox.",
      },
      { status: 401 },
    );
  }

  try {
    const startedAt = performance.now();
    const result = await loadInboxHomepage({
      accessToken: session.accessToken,
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
    });
    const durationMs = Math.round(performance.now() - startedAt);

    return NextResponse.json(
      {
        inbox: result.inbox,
        sorting: {
          cacheHit: result.cacheHit,
          durationMs,
          sortedEmailCount: result.inbox.totalThreads,
        },
      },
      {
        headers: {
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  } catch (error) {
    console.error("Loading inbox homepage failed", {
      error,
      ownerEmail: owner.email,
    });

    return NextResponse.json(
      {
        error: "Unable to load inbox buckets.",
      },
      { status: 500 },
    );
  }
}
