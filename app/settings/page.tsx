import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { ApprovalModeSettings } from "@/app/components/approval-mode-settings";
import { authOptions } from "@/auth";
import {
  getWorkspaceApprovalMode,
  serializeWorkspaceApprovalMode,
} from "@/lib/google-workspace/approval-mode";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const ownerEmail = session?.user?.email;

  if (!ownerEmail) {
    redirect("/");
  }

  const approvalMode = serializeWorkspaceApprovalMode(
    await getWorkspaceApprovalMode(ownerEmail),
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-6 py-5 text-slate-950 md:py-6">
      <div className="mx-auto max-w-6xl">
        <ApprovalModeSettings initialApprovalMode={approvalMode} />
      </div>
    </main>
  );
}
