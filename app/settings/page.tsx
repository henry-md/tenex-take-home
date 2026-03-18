import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { ApprovalModeSettings } from "@/app/components/approval-mode-settings";
import { BucketSettings } from "@/app/components/bucket-settings";
import { authOptions } from "@/auth";
import {
  getWorkspaceApprovalMode,
  serializeWorkspaceApprovalMode,
} from "@/lib/google-workspace/approval-mode";
import { getWorkspaceInboxThreadLimit } from "@/lib/google-workspace/inbox-thread-limit";
import { listBucketSettings } from "@/lib/inbox/classification";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  const ownerEmail = session?.user?.email;

  if (!ownerEmail) {
    redirect("/");
  }

  const [approvalMode, inboxThreadLimit, buckets] = await Promise.all([
    getWorkspaceApprovalMode(ownerEmail).then(serializeWorkspaceApprovalMode),
    getWorkspaceInboxThreadLimit(ownerEmail),
    listBucketSettings({
      ownerEmail,
      ownerImage: session.user?.image,
      ownerName: session.user?.name,
    }),
  ]);
  const showDebugCacheControls = process.env.DEBUG_UI === "true";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-6 py-5 text-slate-950 md:py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <ApprovalModeSettings
          initialApprovalMode={approvalMode}
          initialInboxThreadLimit={inboxThreadLimit}
        />
        <BucketSettings
          initialBuckets={buckets}
          showDebugCacheControls={showDebugCacheControls}
        />
      </div>
    </main>
  );
}
