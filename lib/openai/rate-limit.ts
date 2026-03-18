import { OpenAIRateLimitWindow } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

function readRateLimit(value: string | undefined, fallback: number) {
  const parsedValue = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

const OPENAI_CALLS_PER_MINUTE = readRateLimit(
  process.env.OPENAI_RATE_LIMIT_PER_MINUTE,
  30,
);
const OPENAI_CALLS_PER_DAY = readRateLimit(
  process.env.OPENAI_RATE_LIMIT_PER_DAY,
  100,
);

export class OpenAIRateLimitError extends Error {
  limit: number;
  retryAfterSeconds: number;
  window: OpenAIRateLimitWindow;

  constructor(input: {
    limit: number;
    retryAfterSeconds: number;
    window: OpenAIRateLimitWindow;
  }) {
    super(
      input.window === OpenAIRateLimitWindow.MINUTE
        ? "OpenAI minute rate limit exceeded."
        : "OpenAI daily rate limit exceeded.",
    );
    this.name = "OpenAIRateLimitError";
    this.limit = input.limit;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.window = input.window;
  }
}

function getMinuteWindowStart(now: Date) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      0,
      0,
    ),
  );
}

function getDayWindowStart(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
}

function getRetryAfterSeconds(window: OpenAIRateLimitWindow, now: Date) {
  if (window === OpenAIRateLimitWindow.MINUTE) {
    const nextMinuteStart = new Date(getMinuteWindowStart(now).getTime() + 60_000);
    return Math.max(1, Math.ceil((nextMinuteStart.getTime() - now.getTime()) / 1000));
  }

  const nextDayStart = new Date(getDayWindowStart(now).getTime() + 86_400_000);

  return Math.max(1, Math.ceil((nextDayStart.getTime() - now.getTime()) / 1000));
}

async function incrementBucket(input: {
  limit: number;
  now: Date;
  ownerEmail: string;
  windowStart: Date;
  windowType: OpenAIRateLimitWindow;
}) {
  const bucket = await prisma.openAIRateLimitBucket.upsert({
    where: {
      ownerEmail_windowType_windowStart: {
        ownerEmail: input.ownerEmail,
        windowStart: input.windowStart,
        windowType: input.windowType,
      },
    },
    create: {
      count: 1,
      ownerEmail: input.ownerEmail,
      windowStart: input.windowStart,
      windowType: input.windowType,
    },
    update: {
      count: {
        increment: 1,
      },
    },
  });

  if (bucket.count > input.limit) {
    throw new OpenAIRateLimitError({
      limit: input.limit,
      retryAfterSeconds: getRetryAfterSeconds(input.windowType, input.now),
      window: input.windowType,
    });
  }
}

export async function reserveOpenAICall(ownerEmail: string) {
  const now = new Date();

  await incrementBucket({
    limit: OPENAI_CALLS_PER_MINUTE,
    now,
    ownerEmail,
    windowStart: getMinuteWindowStart(now),
    windowType: OpenAIRateLimitWindow.MINUTE,
  });

  try {
    await incrementBucket({
      limit: OPENAI_CALLS_PER_DAY,
      now,
      ownerEmail,
      windowStart: getDayWindowStart(now),
      windowType: OpenAIRateLimitWindow.DAY,
    });
  } catch (error) {
    if (error instanceof OpenAIRateLimitError) {
      await prisma.openAIRateLimitBucket.update({
        where: {
          ownerEmail_windowType_windowStart: {
            ownerEmail,
            windowStart: getMinuteWindowStart(now),
            windowType: OpenAIRateLimitWindow.MINUTE,
          },
        },
        data: {
          count: {
            decrement: 1,
          },
        },
      });
    }

    throw error;
  }
}
