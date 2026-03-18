"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  APPROVAL_MODE_OPTIONS,
  type ApprovalModeOption,
} from "@/lib/google-workspace/approval-mode-options";

function getApprovalModeClasses(
  mode: ApprovalModeOption["mode"],
  isSelected: boolean,
) {
  switch (mode) {
    case "SAFE":
      return isSelected
        ? {
            accent:
              "absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(196,161,78,0.14),transparent_58%)]",
            badge: "border-[#d7c18c] bg-white/80 text-[#705214]",
            card: "border-[#cbb57e] bg-[linear-gradient(180deg,rgba(255,252,244,0.98),rgba(248,242,227,0.92))] text-[#3d2d10] shadow-[0_24px_55px_rgba(170,138,63,0.12)]",
            description: "text-[#73551a]",
            meta: "text-[#8c6b27]",
          }
        : {
            accent:
              "absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(196,161,78,0.1),transparent_56%)]",
            badge: "border-[#e1d2ad] bg-white/70 text-[#705214]",
            card: "border-[#dfd1ac] bg-[linear-gradient(180deg,rgba(255,253,248,0.95),rgba(250,246,237,0.88))] text-[#463518] hover:border-[#cbb57e]",
            description: "text-[#7a5f29]",
            meta: "text-[#9a7e47]",
          };
    case "BULK_EMAIL_ONLY":
      return isSelected
        ? {
            accent:
              "absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(171,116,77,0.14),transparent_58%)]",
            badge: "border-[#d6b198] bg-white/80 text-[#6f371b]",
            card: "border-[#c79776] bg-[linear-gradient(180deg,rgba(255,249,245,0.98),rgba(247,236,229,0.92))] text-[#482111] shadow-[0_24px_55px_rgba(156,92,51,0.12)]",
            description: "text-[#814426]",
            meta: "text-[#9c5f3d]",
          }
        : {
            accent:
              "absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(171,116,77,0.1),transparent_56%)]",
            badge: "border-[#e1c6b5] bg-white/70 text-[#6f371b]",
            card: "border-[#e0cabd] bg-[linear-gradient(180deg,rgba(255,251,248,0.95),rgba(249,241,236,0.88))] text-[#512717] hover:border-[#c79776]",
            description: "text-[#8a5033]",
            meta: "text-[#a57156]",
          };
    case "DANGEROUS":
      return isSelected
        ? {
            accent:
              "absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(146,88,103,0.14),transparent_58%)]",
            badge: "border-[#d8b5bf] bg-white/80 text-[#5b2231]",
            card: "border-[#c39aa7] bg-[linear-gradient(180deg,rgba(255,248,250,0.98),rgba(246,235,239,0.92))] text-[#431928] shadow-[0_24px_55px_rgba(121,63,79,0.12)]",
            description: "text-[#7a4251]",
            meta: "text-[#945b6a]",
          }
        : {
            accent:
              "absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(146,88,103,0.1),transparent_56%)]",
            badge: "border-[#e1c8cf] bg-white/70 text-[#5b2231]",
            card: "border-[#e2d0d6] bg-[linear-gradient(180deg,rgba(255,250,251,0.95),rgba(248,241,243,0.88))] text-[#4c2230] hover:border-[#c39aa7]",
            description: "text-[#845162]",
            meta: "text-[#9b6b78]",
          };
  }
}

type ApprovalModeSettingsProps = {
  initialApprovalMode: ApprovalModeOption;
};

export function ApprovalModeSettings({
  initialApprovalMode,
}: ApprovalModeSettingsProps) {
  const [approvalMode, setApprovalMode] = useState(initialApprovalMode);
  const approvalModeRequestId = useRef(0);

  async function handleApprovalModeChange(mode: ApprovalModeOption["mode"]) {
    const nextMode =
      APPROVAL_MODE_OPTIONS.find((option) => option.mode === mode) ?? null;
    const previousMode = approvalMode;

    if (!nextMode || previousMode.mode === mode) {
      return;
    }

    const requestId = approvalModeRequestId.current + 1;
    approvalModeRequestId.current = requestId;
    setApprovalMode(nextMode);

    try {
      const response = await fetch("/api/approval-mode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to update approval mode.");
      }

      const payload = (await response.json()) as {
        approvalMode?: ApprovalModeOption;
      };

      if (approvalModeRequestId.current !== requestId) {
        return;
      }

      setApprovalMode(payload.approvalMode ?? nextMode);
    } catch (error) {
      if (approvalModeRequestId.current !== requestId) {
        return;
      }

      setApprovalMode(previousMode);
      toast.error(
        error instanceof Error ? error.message : "Unable to update approval mode.",
      );
    } finally {
      // The latest request owns rollback behavior; no separate loading state is shown.
    }
  }

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur md:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              Settings
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Permissions
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Control when Gmail and Calendar changes pause for review.
            </p>
          </div>
          <Link
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            href="/"
          >
            Back to inbox
          </Link>
        </div>

        <section className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(249,250,251,0.96),rgba(244,247,250,0.92))] p-5">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="max-w-xl">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                  Approval policy
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Switching updates immediately in the interface and rolls back only if the server rejects it.
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                {approvalMode.label}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {APPROVAL_MODE_OPTIONS.map((option) => {
                const isSelected = approvalMode.mode === option.mode;
                const classes = getApprovalModeClasses(option.mode, isSelected);

                return (
                  <button
                    key={option.mode}
                    className={`relative overflow-hidden rounded-[1.1rem] border px-4 py-3.5 text-left transition sm:min-h-[9.5rem] ${classes.card}`}
                    onClick={() => void handleApprovalModeChange(option.mode)}
                    type="button"
                  >
                    <div className={classes.accent} />
                    <div className="relative flex h-full flex-col justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[1.05rem] font-semibold tracking-tight">
                            {option.label}
                          </p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${classes.badge}`}>
                            {option.mode === "SAFE"
                              ? "Maximum review"
                              : option.mode === "BULK_EMAIL_ONLY"
                                ? "Balanced"
                                : "No review"}
                          </span>
                        </div>
                        <p className={`mt-2 text-sm leading-5 ${classes.description}`}>
                          {option.description}
                        </p>
                      </div>
                      <div className="flex items-center justify-end">
                        {isSelected ? (
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${classes.badge}`}>
                            Active
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
