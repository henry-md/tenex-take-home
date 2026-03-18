import { describe, expect, it } from "vitest";

import { getInboxLoadToastMessages } from "./load-feedback";

describe("getInboxLoadToastMessages", () => {
  it("reports Gmail and sorting cache hits separately", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          cacheHit: true,
          durationMs: 0,
          fetchedThreadCount: 100,
        },
        sorting: {
          cacheHit: true,
          durationMs: 24,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Gmail thread cache hit: loaded 100 threads from cache.",
      "Inbox sorting cache hit: reused cached bucket memberships in 24ms.",
    ]);
  });

  it("reports a Gmail fetch miss separately from a sorting cache hit", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          cacheHit: false,
          durationMs: 18_000,
          fetchedThreadCount: 100,
        },
        sorting: {
          cacheHit: true,
          durationMs: 920,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Fetched 100 Gmail threads in 18s.",
      "Inbox sorting cache hit: reused cached bucket memberships in 920ms.",
    ]);
  });

  it("reports Gmail cache hits separately from sorting refreshes", () => {
    expect(
      getInboxLoadToastMessages({
        gmailFetch: {
          cacheHit: true,
          durationMs: 0,
          fetchedThreadCount: 100,
        },
        sorting: {
          cacheHit: false,
          durationMs: 1_250,
          sortedEmailCount: 100,
        },
      }),
    ).toEqual([
      "Gmail thread cache hit: loaded 100 threads from cache.",
      "Inbox sorting refreshed bucket memberships in 1.3s.",
    ]);
  });
});
