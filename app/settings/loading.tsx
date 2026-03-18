function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />;
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-6 py-5 text-slate-950 md:py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur md:p-8">
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-10 w-72 max-w-full" />
                <SkeletonBlock className="h-4 w-[26rem] max-w-full" />
              </div>
              <SkeletonBlock className="h-10 w-32 rounded-full" />
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(249,250,251,0.96),rgba(244,247,250,0.92))] p-5">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:justify-between">
                  <div className="space-y-2">
                    <SkeletonBlock className="h-6 w-44" />
                    <SkeletonBlock className="h-4 w-[24rem] max-w-full" />
                  </div>
                  <SkeletonBlock className="h-8 w-28 rounded-full" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <SkeletonBlock className="h-40" />
                  <SkeletonBlock className="h-40" />
                  <SkeletonBlock className="h-40" />
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(252,252,252,0.96),rgba(244,247,250,0.92))] p-5">
              <div className="space-y-4">
                <div className="space-y-2">
                  <SkeletonBlock className="h-6 w-36" />
                  <SkeletonBlock className="h-4 w-[24rem] max-w-full" />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <SkeletonBlock className="h-14 flex-1" />
                  <SkeletonBlock className="h-14 w-40" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-56" />
        </section>
      </div>
    </main>
  );
}
