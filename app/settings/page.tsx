import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { ApprovalModeSettings } from "@/app/components/approval-mode-settings";
import { authOptions } from "@/auth";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-6 py-5 text-slate-950 md:py-6">
      <div className="mx-auto max-w-6xl">
        <ApprovalModeSettings />
      </div>
    </main>
  );
}
