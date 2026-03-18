import { getServerSession } from "next-auth";
import Link from "next/link";

import { AuthButton } from "@/app/components/auth-button";
import { InboxDashboard } from "@/app/components/inbox-dashboard";
import { OpenAIChat } from "@/app/components/openai-chat";
import { authOptions } from "@/auth";
import type { ApprovalModeOption } from "@/lib/google-workspace/approval-mode-options";
import {
  getWorkspaceApprovalMode,
  serializeWorkspaceApprovalMode,
} from "@/lib/google-workspace/approval-mode";
import {
  getDefaultInboxThreadLimit,
  getWorkspaceInboxThreadLimit,
} from "@/lib/google-workspace/inbox-thread-limit";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = Boolean(session?.user);
  const firstName = session?.user?.name?.split(" ")[0];
  const ownerEmail = session?.user?.email;
  let approvalMode: ApprovalModeOption | null = null;
  let inboxThreadLimit = getDefaultInboxThreadLimit();

  if (ownerEmail) {
    [approvalMode, inboxThreadLimit] = await Promise.all([
      getWorkspaceApprovalMode(ownerEmail).then(serializeWorkspaceApprovalMode),
      getWorkspaceInboxThreadLimit(ownerEmail),
    ]);
  }

  return (
    <main
      className={`min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,248,235,0.95),_rgba(247,250,252,0.96)_42%,_rgba(226,232,240,0.92)_100%)] px-5 text-slate-950 sm:px-6 ${
        isAuthenticated ? "py-5 md:py-6" : "py-12"
      }`}
    >
      <div className="mx-auto max-w-7xl">
        {isAuthenticated && approvalMode ? (
          <>
            <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_25px_70px_rgba(15,23,42,0.08)] backdrop-blur md:flex-row md:items-center md:justify-between md:px-6">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Inbox Concierge
                </p>
                <p className="text-sm text-slate-600">
                  Bucket-first Gmail triage for the latest {inboxThreadLimit} inbox threads.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.2em] text-emerald-700">
                  {approvalMode.label}
                </div>
                <Link
                  className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  href="/settings"
                >
                  Settings
                </Link>
                <AuthButton className="px-4 py-2.5 text-sm" isAuthenticated />
              </div>
            </header>

            <InboxDashboard
              firstName={firstName}
              initialInboxThreadLimit={inboxThreadLimit}
            />
            <OpenAIChat
              firstName={firstName}
              initialApprovalMode={approvalMode}
            />
          </>
        ) : (
          <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
            <div className="grid gap-10 px-8 py-10 md:grid-cols-[1.2fr_0.8fr] md:px-12 md:py-12">
              <div className="space-y-6">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Inbox Concierge
                </p>
                <div className="space-y-4">
                  <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
                    Sort {inboxThreadLimit} inbox threads into clear buckets the
                    moment you load the app.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-slate-600 md:text-lg">
                    Sign in to let the app classify Gmail threads into
                    Important, Can wait, Auto-archive, Newsletter, Finance, and
                    any custom buckets you add later.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <AuthButton isAuthenticated={isAuthenticated} />
                </div>
              </div>

              <aside className="rounded-[1.5rem] bg-slate-950 p-6 text-slate-50">
                <div className="space-y-5">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                    What you get
                  </p>
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-xl font-semibold">LLM-first triage</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Recent inbox threads are grouped into scan-friendly
                        buckets before you ask the assistant anything.
                      </p>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">Custom taxonomy</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Add a new bucket and rerun classification against the
                        same loaded inbox set.
                      </p>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">Assistant on demand</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Expand the workspace assistant only when you want Gmail
                        or Calendar help beyond the inbox board.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
