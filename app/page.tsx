import { getServerSession } from "next-auth";

import { AuthButton } from "@/app/components/auth-button";
import { OpenAIChat } from "@/app/components/openai-chat";
import { authOptions } from "@/auth";
import {
  getWorkspaceApprovalMode,
  serializeWorkspaceApprovalMode,
} from "@/lib/google-workspace/approval-mode";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = Boolean(session?.user);
  const firstName = session?.user?.name?.split(" ")[0];
  const ownerEmail = session?.user?.email;
  const approvalMode = ownerEmail
    ? serializeWorkspaceApprovalMode(await getWorkspaceApprovalMode(ownerEmail))
    : null;

  return (
    <main
      className={`min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-6 text-slate-950 ${
        isAuthenticated ? "py-5 md:py-6" : "py-12"
      }`}
    >
      <div className="mx-auto max-w-6xl">
        {isAuthenticated && approvalMode ? (
          <OpenAIChat
            firstName={firstName}
            initialApprovalMode={approvalMode}
          />
        ) : (
          <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
            <div className="grid gap-10 px-8 py-10 md:grid-cols-[1.2fr_0.8fr] md:px-12 md:py-12">
              <div className="space-y-6">
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Inbox Concierge
                </p>
                <div className="space-y-4">
                  <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
                    Triage your inbox without digging through every thread.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-slate-600 md:text-lg">
                    Sign in to search Gmail, inspect Calendar, and queue Google
                    Workspace changes that stay pending until you approve them.
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
                      <h2 className="text-xl font-semibold">Clear priorities</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Search mail and upcoming events without bouncing between
                        tabs.
                      </p>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">Safe approvals</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Review proposed Gmail and Calendar changes before they
                        execute.
                      </p>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">Focused actions</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-300">
                        Keep the assistant on narrow Workspace tasks instead of
                        exposing raw Google APIs.
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
