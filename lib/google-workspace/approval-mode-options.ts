export type ApprovalModeOption = {
  description: string;
  label: string;
  mode: "BULK_EMAIL_ONLY" | "DANGEROUS" | "SAFE";
};

export const APPROVAL_MODE_OPTIONS: ApprovalModeOption[] = [
  {
    description: "All Gmail and Calendar modifications require approval.",
    label: "Safe mode",
    mode: "SAFE",
  },
  {
    description:
      "Only actions that modify or delete more than one email require approval.",
    label: "Bulk email guard",
    mode: "BULK_EMAIL_ONLY",
  },
  {
    description: "No Gmail or Calendar modifications require approval.",
    label: "Dangerous mode",
    mode: "DANGEROUS",
  },
];

export function getApprovalModeOption(
  mode: ApprovalModeOption["mode"],
): ApprovalModeOption {
  const matchedOption = APPROVAL_MODE_OPTIONS.find((option) => option.mode === mode);

  if (!matchedOption) {
    return APPROVAL_MODE_OPTIONS[0];
  }

  return matchedOption;
}
