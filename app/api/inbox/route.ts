import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";

import { authOptions } from "@/auth";
import {
  GoogleApiError,
  serializeGoogleApiError,
} from "@/lib/google-workspace/google-api";
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

export async function GET(request: Request) {
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
    const { searchParams } = new URL(request.url);
    const result = await loadInboxHomepage({
      accessToken: session.accessToken,
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
      refresh: searchParams.get("refresh") === "1",
    });

    return NextResponse.json(
      {
        gmailFetch: {
          cacheHit: result.emailCacheHit,
          durationMs: result.timings.gmailFetchMs,
          fetchedThreadCount: result.inbox.totalThreads,
          newThreadCount: result.newThreadCount,
        },
        inbox: result.inbox,
        sorting: {
          cacheHit: result.sortingCacheHit,
          durationMs: result.timings.sortingMs,
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

    if (error instanceof GoogleApiError) {
      return NextResponse.json(serializeGoogleApiError(error), {
        status: error.status,
      });
    }

    return NextResponse.json(
      {
        error: "Unable to load inbox buckets.",
      },
      { status: 500 },
    );
  }
}
