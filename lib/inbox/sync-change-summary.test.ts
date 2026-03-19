import { describe, expect, it } from "vitest";

import { summarizeInboxSyncChanges } from "./sync-change-summary";

describe("summarizeInboxSyncChanges", () => {
  it("classifies prepended newer threads as new mail", () => {
    expect(
      summarizeInboxSyncChanges({
        cachedThreadIds: ["a", "b", "c"],
        cachedThreadTimestamps: new Map([
          ["a", "2026-03-18T10:00:00.000Z"],
          ["b", "2026-03-18T09:00:00.000Z"],
          ["c", "2026-03-18T08:00:00.000Z"],
        ]),
        currentThreadIds: ["x", "a", "b"],
        currentThreadTimestamps: new Map([
          ["x", "2026-03-18T11:00:00.000Z"],
          ["a", "2026-03-18T10:00:00.000Z"],
          ["b", "2026-03-18T09:00:00.000Z"],
        ]),
      }),
    ).toEqual({
      addedThreadCount: 1,
      changedThreadCount: 1,
      kind: "new-threads",
      removedThreadCount: 1,
    });
  });

  it("classifies older backfill as deletions", () => {
    expect(
      summarizeInboxSyncChanges({
        cachedThreadIds: ["a", "b", "c"],
        cachedThreadTimestamps: new Map([
          ["a", "2026-03-18T10:00:00.000Z"],
          ["b", "2026-03-18T09:00:00.000Z"],
          ["c", "2026-03-18T08:00:00.000Z"],
        ]),
        currentThreadIds: ["b", "c", "d"],
        currentThreadTimestamps: new Map([
          ["b", "2026-03-18T09:00:00.000Z"],
          ["c", "2026-03-18T08:00:00.000Z"],
          ["d", "2026-03-18T07:00:00.000Z"],
        ]),
      }),
    ).toEqual({
      addedThreadCount: 1,
      changedThreadCount: 1,
      kind: "deleted-threads",
      removedThreadCount: 1,
    });
  });

  it("falls back to mixed when additions and removals overlap in time", () => {
    expect(
      summarizeInboxSyncChanges({
        cachedThreadIds: ["a", "b", "c"],
        cachedThreadTimestamps: new Map([
          ["a", "2026-03-18T10:00:00.000Z"],
          ["b", "2026-03-18T09:00:00.000Z"],
          ["c", "2026-03-18T08:00:00.000Z"],
        ]),
        currentThreadIds: ["x", "b", "y"],
        currentThreadTimestamps: new Map([
          ["x", "2026-03-18T09:30:00.000Z"],
          ["b", "2026-03-18T09:00:00.000Z"],
          ["y", "2026-03-18T07:30:00.000Z"],
        ]),
      }),
    ).toEqual({
      addedThreadCount: 2,
      changedThreadCount: 2,
      kind: "mixed",
      removedThreadCount: 2,
    });
  });

  it("treats reorder-only changes as mixed updates", () => {
    expect(
      summarizeInboxSyncChanges({
        cachedThreadIds: ["a", "b", "c"],
        currentThreadIds: ["b", "a", "c"],
      }),
    ).toEqual({
      addedThreadCount: 0,
      changedThreadCount: 2,
      kind: "mixed",
      removedThreadCount: 0,
    });
  });
});
