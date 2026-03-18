function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />;
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,248,235,0.95),_rgba(247,250,252,0.96)_42%,_rgba(226,232,240,0.92)_100%)] px-5 py-5 text-slate-950 sm:px-6 md:py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[2rem] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_25px_70px_rgba(15,23,42,0.08)] backdrop-blur md:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <SkeletonBlock className="h-3 w-28" />
              <SkeletonBlock className="h-4 w-72 max-w-full" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SkeletonBlock className="h-10 w-32 rounded-full" />
              <SkeletonBlock className="h-10 w-24 rounded-full" />
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
          <div className="space-y-5">
            <div className="space-y-3">
              <SkeletonBlock className="h-4 w-36" />
              <SkeletonBlock className="h-10 w-[34rem] max-w-full" />
              <SkeletonBlock className="h-4 w-[30rem] max-w-full" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-white/70 bg-white/85 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-4 w-[28rem] max-w-full" />
            </div>
            <SkeletonBlock className="h-10 w-28 rounded-full" />
          </div>
        </section>

        <section className="space-y-4">
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
        </section>
      </div>
    </main>
  );
}
