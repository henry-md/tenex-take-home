import { WorkspaceApprovalMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const WORKSPACE_APPROVAL_MODE_METADATA = {
  [WorkspaceApprovalMode.SAFE]: {
    description: "All Gmail and Calendar modifications require approval.",
    label: "Safe mode",
  },
  [WorkspaceApprovalMode.BULK_EMAIL_ONLY]: {
    description:
      "Only actions that modify or delete more than one email require approval.",
    label: "Bulk email guard",
  },
  [WorkspaceApprovalMode.DANGEROUS]: {
    description: "No Gmail or Calendar modifications require approval.",
    label: "Dangerous mode",
  },
} as const;

export function serializeWorkspaceApprovalMode(mode: WorkspaceApprovalMode) {
  return {
    description: WORKSPACE_APPROVAL_MODE_METADATA[mode].description,
    label: WORKSPACE_APPROVAL_MODE_METADATA[mode].label,
    mode,
  };
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
