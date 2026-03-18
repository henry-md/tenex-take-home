import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";

import { authOptions } from "@/auth";
import {
  createCustomBucket,
  listBucketSettings,
} from "@/lib/inbox/classification";

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

export async function GET() {
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
    const buckets = await listBucketSettings({
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
    });

    return NextResponse.json({ buckets });
  } catch (error) {
    console.error("Listing bucket settings failed", error);

    return NextResponse.json(
      {
        error: "Unable to load buckets.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
    const body = (await request.json()) as {
      name?: string;
      prompt?: string;
    };

    if (typeof body.name !== "string") {
      return NextResponse.json(
        {
          error: "Bucket name is required.",
        },
        { status: 400 },
      );
    }

    await createCustomBucket({
      name: body.name,
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
    });

    const buckets = await listBucketSettings({
      ownerEmail: owner.email,
      ownerImage: owner.image,
      ownerName: owner.name,
    });

    return NextResponse.json({ buckets });
  } catch (error) {
    console.error("Creating bucket failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create bucket.",
      },
      { status: 500 },
    );
  }
}
