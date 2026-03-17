import { NextResponse } from "next/server";
import OpenAI from "openai";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function toResponseInputMessage(message: ChatMessage) {
  return {
    role: message.role,
    content: message.content,
    type: "message" as const,
  };
}

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
    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = body.messages?.filter((message) => message.content.trim());

    if (!messages?.length) {
      return NextResponse.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          const stream = await client.responses.create({
            model,
            stream: true,
            input: [
              {
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: "You are Inbox Concierge, a concise assistant for an inbox triage app.",
                  },
                ],
              },
              ...messages.map(toResponseInputMessage),
            ],
          });

          for await (const event of stream) {
            if (event.type === "response.output_text.delta") {
              controller.enqueue(encoder.encode(event.delta));
            }
          }

          controller.close();
        } catch (error) {
          console.error("OpenAI chat stream failed", error);
          controller.error(error);
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/plain; charset=utf-8",
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
