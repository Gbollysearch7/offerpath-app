import type { AccessAction, Referral, ReferralStatus } from "./types";

export const ACCESS_ACTION_LABEL: Record<AccessAction, string> = {
  view_student: "Opened the student's page",
  open_cv: "Opened a CV file",
  add_note: "Added a note",
  record_disagreement: "Recorded a disagreement",
  withdraw_disagreement: "Withdrew a disagreement",
  create_referral: "Proposed a referral",
  update_referral: "Updated a referral",
  export_students: "Exported the student list",
  export_outcomes: "Exported the outcomes pack",
  export_access_log: "Exported the access log",
  change_configuration: "Changed the service configuration",
  change_role: "Changed the careers team",
};

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  proposed: "Waiting for the student",
  accepted: "Accepted by the student",
  in_progress: "In progress",
  closed: "Closed",
  declined: "Declined by the student",
  withdrawn: "Withdrawn by staff",
};

/** Clear ownership: at every stage, who the next step is with. */
export function nextStepWith(r: Pick<Referral, "status" | "owner">): string {
  if (r.status === "proposed") return "the student, who can accept or decline";
  if (r.status === "accepted" || r.status === "in_progress") return r.owner ?? "nobody yet: a careers admin needs to give it an owner";
  return "nobody: this referral is finished";
}
