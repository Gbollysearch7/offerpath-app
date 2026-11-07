import type { Role } from "@/lib/types";

// Who can view each document and do each thing. This is the statement of record: the team page renders it, the admin
// navigation is derived from it, and tests/adviser-db.test.ts checks every row against the database for real, so a page
// can't claim more or less than the role actually has.

export type Access =
  | "yes"
  /** Only their own. */
  | "own"
  /** Students who share progress at the same university, and for an adviser only those their policy allows. */
  | "scope"
  /** As `scope`, and the student has also opted in to CV access, and ADVISER_CV_ACCESS is on. It is off. */
  | "cv"
  | "no";

export const ACCESS_LABEL: Record<Access, string> = {
  yes: "Yes",
  own: "Their own",
  scope: "Students in scope",
  cv: "Only with the student's opt-in, once switched on",
  no: "No",
};

export interface Permission {
  key: string;
  label: string;
  student: Access;
  adviser: Access;
  admin: Access;
}

export const PERMISSIONS: Permission[] = [
  { key: "cv_file", label: "Open an original CV file", student: "own", adviser: "cv", admin: "cv" },
  { key: "cv_text", label: "Read CV text and line-by-line feedback", student: "own", adviser: "no", admin: "no" },
  { key: "letters", label: "Read cover letters, tailored CVs and LinkedIn reviews", student: "own", adviser: "no", admin: "no" },
  { key: "scores", label: "See CV scores and area scores", student: "own", adviser: "scope", admin: "scope" },
  { key: "notes", label: "Read and add adviser notes", student: "own", adviser: "scope", admin: "scope" },
  { key: "disagree", label: "Record a disagreement with automated feedback", student: "no", adviser: "scope", admin: "scope" },
  { key: "refer", label: "Propose and manage referrals", student: "own", adviser: "scope", admin: "scope" },
  { key: "student_list", label: "See the student list", student: "no", adviser: "scope", admin: "scope" },
  { key: "dashboard", label: "See the service dashboard and group figures", student: "no", adviser: "no", admin: "yes" },
  { key: "export", label: "Export student and outcomes files", student: "own", adviser: "no", admin: "scope" },
  { key: "access_log", label: "Read the access log", student: "own", adviser: "no", admin: "yes" },
  { key: "config", label: "Change branding, resources, groups, contacts and access policy", student: "no", adviser: "no", admin: "yes" },
  { key: "team", label: "Add or remove careers admins and advisers", student: "no", adviser: "no", admin: "yes" },
  { key: "import", label: "Import student records", student: "no", adviser: "no", admin: "yes" },
  { key: "score_change", label: "Change a score or automated judgment", student: "no", adviser: "no", admin: "no" },
];

export const permission = (key: string): Permission => {
  const p = PERMISSIONS.find((x) => x.key === key);
  if (!p) throw new Error(`unknown permission ${key}`);
  return p;
};

export const can = (role: Role, key: string): boolean => permission(key)[role] !== "no";

export const isStaff = (role: Role): boolean => role === "admin" || role === "adviser";
export const homeFor = (role: Role): string => (role === "admin" ? "/admin" : role === "adviser" ? "/admin/students" : "/dashboard");

/** The admin navigation. An item a role can't use isn't shown, and the page behind it refuses them regardless. */
export const NAV_ITEMS: { id: string; label: string; href: string; needs: string }[] = [
  { id: "dashboard", label: "Dashboard", href: "/admin", needs: "dashboard" },
  { id: "students", label: "Students", href: "/admin/students", needs: "student_list" },
  { id: "casework", label: "Referrals", href: "/admin/casework", needs: "refer" },
  { id: "import", label: "Import student records", href: "/admin/import", needs: "import" },
  { id: "opportunities", label: "Opportunities", href: "/admin/opportunities", needs: "config" },
  { id: "institution", label: "Your service", href: "/admin/institution", needs: "config" },
  { id: "team", label: "Careers team", href: "/admin/team", needs: "team" },
  { id: "access", label: "Access log", href: "/admin/access-log", needs: "access_log" },
  { id: "settings", label: "Settings and SSO", href: "/admin/settings", needs: "config" },
  { id: "reports", label: "Reports and exports", href: "/admin/students#export", needs: "export" },
];

export const navFor = (role: Role) => (role === "student" ? [] : NAV_ITEMS.filter((i) => permission(i.needs)[role] !== "no"));
