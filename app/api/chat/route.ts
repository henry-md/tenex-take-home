import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import OpenAI from "openai";

import { authOptions } from "@/auth";
import {
  runGoogleWorkspaceAssistant,
  type ChatMessage,
} from "@/lib/assistant/google-workspace-agent";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;

const client = apiKey ? new OpenAI({ apiKey }) : null;

export async function POST(request: Request) {
  if (!client || !model) {
    return NextResponse.json(
      {
        error: "The assistant is temporarily unavailable.",
      },
      { status: 500 },
    );
  }

  try {
    const session = await getServerSession(authOptions);
    const ownerEmail = session?.user?.email;

    if (!ownerEmail || !session.accessToken || session.authError) {
      return NextResponse.json(
        {
          error: "Sign in with Google again to use the assistant.",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = body.messages?.filter((message) => message.content.trim());

    if (!messages?.length) {
      return NextResponse.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    const assistantResponse = await runGoogleWorkspaceAssistant({
      accessToken: session.accessToken,
      client,
      messages,
      model,
      ownerEmail,
    });

    return NextResponse.json(assistantResponse, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("OpenAI chat request failed", error);

    return NextResponse.json(
      { error: "The OpenAI request failed." },
      { status: 500 },
    );
  }
}
