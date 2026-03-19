import { describe, expect, it } from "vitest";

import {
  selectCachedInboxStatePayload,
  type InboxStatePayloadShape,
} from "./cache-helpers";

type TestMembership = {
  applies: boolean;
};

type TestThread = {
  threadId: string;
};

function createPayload(
  configuredThreadLimit: number,
  threadIds: string[],
): InboxStatePayloadShape<TestThread, TestMembership> {
  return {
    bucketMembershipsByThreadId: Object.fromEntries(
      threadIds.map((threadId) => [
        threadId,
        {
          important: {
            applies: true,
          },
        },
      ]),
    ),
    configuredThreadLimit,
    threadIds,
    threadsById: Object.fromEntries(
      threadIds.map((threadId) => [
        threadId,
        {
          threadId,
        },
      ]),
    ),
    version: 2,
  };
}

describe("selectCachedInboxStatePayload", () => {
  it("reuses the freshest compatible larger snapshot and slices it down", () => {
    const largerThreadIds = Array.from({ length: 200 }, (_, index) => `thread-${index + 1}`);
    const exactThreadIds = Array.from({ length: 100 }, (_, index) => `thread-${index + 1}`);
    const result = selectCachedInboxStatePayload({
      configuredThreadLimit: 100,
      expectedCacheKey: "inbox-state-v2:100",
      rows: [
        {
          cacheKey: "inbox-state-v2:100",
          payload: createPayload(100, exactThreadIds),
          updatedAt: new Date("2026-03-18T10:00:00.000Z"),
        },
        {
          cacheKey: "inbox-state-v2:200",
          payload: createPayload(200, largerThreadIds),
          updatedAt: new Date("2026-03-18T11:00:00.000Z"),
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.isPartial).toBe(false);
    expect(result?.requiresSave).toBe(true);
    expect(result?.payload.configuredThreadLimit).toBe(100);
    expect(result?.payload.threadIds).toHaveLength(100);
    expect(result?.payload.threadIds.at(-1)).toBe("thread-100");
    expect(result?.payload.threadsById["thread-100"]).toEqual({
      threadId: "thread-100",
    });
    expect(result?.payload.threadsById["thread-101"]).toBeUndefined();
    expect(result?.payload.bucketMembershipsByThreadId["thread-100"]).toEqual({
      important: {
        applies: true,
      },
    });
  });

  it("marks exact legacy-key matches for rewrite", () => {
    const payload = createPayload(100, ["thread-1"]);
    const result = selectCachedInboxStatePayload({
      configuredThreadLimit: 100,
      expectedCacheKey: "inbox-state-v2:100",
      rows: [
        {
          cacheKey: "inbox-state-v2",
          payload,
          updatedAt: new Date("2026-03-18T11:00:00.000Z"),
        },
      ],
    });

    expect(result).toEqual({
      isPartial: false,
      payload,
      requiresSave: true,
    });
  });

  it("falls back to the freshest smaller snapshot as a partial cache hit", () => {
    const olderSmallerPayload = createPayload(40, ["thread-1"]);
    const fresherSmallerPayload = createPayload(25, ["thread-1", "thread-2"]);
    const result = selectCachedInboxStatePayload({
      configuredThreadLimit: 50,
      expectedCacheKey: "inbox-state-v2:50",
      rows: [
        {
          cacheKey: "inbox-state-v2:40",
          payload: olderSmallerPayload,
          updatedAt: new Date("2026-03-18T10:00:00.000Z"),
        },
        {
          cacheKey: "inbox-state-v2:25",
          payload: fresherSmallerPayload,
          updatedAt: new Date("2026-03-18T11:00:00.000Z"),
        },
      ],
    });

    expect(result).toEqual({
      isPartial: true,
      payload: fresherSmallerPayload,
      requiresSave: true,
    });
  });
});
