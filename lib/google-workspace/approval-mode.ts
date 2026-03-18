import { WorkspaceApprovalMode } from "@/generated/prisma/client";
import { getApprovalModeOption } from "@/lib/google-workspace/approval-mode-options";
import { prisma } from "@/lib/prisma";

export function serializeWorkspaceApprovalMode(mode: WorkspaceApprovalMode) {
  return getApprovalModeOption(mode);
}

export async function getWorkspaceApprovalMode(ownerEmail: string) {
  const preference = await prisma.workspaceApprovalPreference.findUnique({
    where: {
      ownerEmail,
    },
  });

  return preference?.mode ?? WorkspaceApprovalMode.SAFE;
}

export async function setWorkspaceApprovalMode(
  ownerEmail: string,
  mode: WorkspaceApprovalMode,
) {
  const preference = await prisma.workspaceApprovalPreference.upsert({
    where: {
      ownerEmail,
    },
    create: {
      ownerEmail,
      mode,
    },
    update: {
      mode,
    },
  });

  return serializeWorkspaceApprovalMode(preference.mode);
}

export function requiresApproval(input: {
  affectedEmailCount?: number;
  mode: WorkspaceApprovalMode;
  provider: "GMAIL" | "GOOGLE_CALENDAR";
}) {
  if (input.mode === WorkspaceApprovalMode.SAFE) {
    return true;
  }

  if (input.mode === WorkspaceApprovalMode.DANGEROUS) {
    return false;
  }

  return (
    input.provider === "GMAIL" &&
    (input.affectedEmailCount ?? 0) > 1
  );
}
