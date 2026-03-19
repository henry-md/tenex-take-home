import { describe, expect, it } from "vitest";

import { getInboxLoadToastMessages } from "./load-feedback";

describe("getInboxLoadToastMessages", () => {
  it("reports Gmail and sorting cache hits separately", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          addedThreadCount: 0,
          cacheHit: true,
          changedThreadCount: 0,
          durationMs: 0,
          fetchedThreadCount: 100,
          kind: "none",
          removedThreadCount: 0,
        },
        sorting: {
          cacheHit: true,
          durationMs: 24,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Gmail thread cache hit: loaded 100 threads from cache.",
      "Inbox cache hit: reused cached bucket memberships in 24ms.",
    ]);
  });

  it("reports a Gmail fetch miss separately from a sorting cache hit", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          addedThreadCount: 100,
          cacheHit: false,
          changedThreadCount: 100,
          durationMs: 18_000,
          fetchedThreadCount: 100,
          kind: "new-threads",
          removedThreadCount: 0,
        },
        sorting: {
          cacheHit: true,
          durationMs: 920,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Fetched 100 Gmail threads in 18s.",
      "Inbox cache hit: reused cached bucket memberships in 920ms.",
    ]);
  });

  it("reports Gmail cache hits separately from sorting refreshes", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          addedThreadCount: 0,
          cacheHit: true,
          changedThreadCount: 0,
          durationMs: 0,
          fetchedThreadCount: 100,
          kind: "none",
          removedThreadCount: 0,
        },
        sorting: {
          cacheHit: false,
          durationMs: 1_250,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Gmail thread cache hit: loaded 100 threads from cache.",
      "Inbox cache refresh updated bucket memberships in 1.3s.",
    ]);
  });

  it("reports incremental Gmail refreshes using the new thread count", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          addedThreadCount: 1,
          cacheHit: false,
          changedThreadCount: 1,
          durationMs: 4_200,
          fetchedThreadCount: 100,
          kind: "new-threads",
          removedThreadCount: 1,
        },
        sorting: {
          cacheHit: false,
          durationMs: 8_200,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Synced 1 new Gmail thread in 4.2s.",
      "Inbox refresh and cache update finished in 8.2s.",
    ]);
  });

  it("reports deletion-driven refreshes without calling them new mail", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          addedThreadCount: 9,
          cacheHit: false,
          changedThreadCount: 9,
          durationMs: 12_000,
          fetchedThreadCount: 100,
          kind: "deleted-threads",
          removedThreadCount: 9,
        },
        sorting: {
          cacheHit: false,
          durationMs: 16_000,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Synced 9 Gmail deletions and refreshed the latest 100 threads in 12s.",
      "Inbox refresh and cache update finished in 16s.",
    ]);
  });

  it("reports mixed inbox changes generically", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          addedThreadCount: 3,
          cacheHit: false,
          changedThreadCount: 5,
          durationMs: 2_450,
          fetchedThreadCount: 100,
          kind: "mixed",
          removedThreadCount: 5,
        },
        sorting: {
          cacheHit: false,
          durationMs: 3_100,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Synced 5 Gmail thread changes in 2.5s.",
      "Inbox refresh and cache update finished in 3.1s.",
    ]);
  });
});
