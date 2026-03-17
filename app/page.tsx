import { getServerSession } from "next-auth";

import { AuthButton } from "@/app/components/auth-button";
import { authOptions } from "@/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = Boolean(session?.user);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-6 py-12 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl items-center">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="grid gap-10 px-8 py-10 md:grid-cols-[1.2fr_0.8fr] md:px-12 md:py-12">
            <div className="space-y-6">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                Inbox Concierge
              </p>
              <div className="space-y-4">
                <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
                  Connect Google Workspace and start sorting your inbox.
                </h1>
                <p className="max-w-xl text-base leading-7 text-slate-600 md:text-lg">
                  Sign in with Google to grant read-only Gmail access. The app
                  will use that access to load recent threads and organize them
                  into triage buckets.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <AuthButton isAuthenticated={isAuthenticated} />
                <p className="text-sm text-slate-500">
                  Scope requested: Gmail read-only, profile, email.
                </p>
              </div>
            </div>

            <aside className="rounded-[1.5rem] bg-slate-950 p-6 text-slate-50">
              {isAuthenticated ? (
                <div className="space-y-4">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                    Signed in
                  </p>
                  <h2 className="text-2xl font-semibold">
                    {session?.user?.name ?? "Google account connected"}
                  </h2>
                  <p className="text-sm text-slate-300">
                    {session?.user?.email}
                  </p>
                  <p className="text-sm leading-6 text-slate-300">
                    OAuth is configured. The Google access token is now stored
                    in the JWT-backed session for the next Gmail integration
                    step.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                    Before you continue
                  </p>
                  <h2 className="text-2xl font-semibold">
                    Create Google OAuth credentials
                  </h2>
                  <p className="text-sm leading-6 text-slate-300">
                    Add the values from <code>.env.example</code> to your local
                    <code> .env.local</code> file and set the Google OAuth
                    callback URL to
                    <code> http://localhost:3000/api/auth/callback/google</code>
                    .
                  </p>
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
