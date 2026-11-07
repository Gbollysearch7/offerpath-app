import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessLogEntry, AdviserTeam, CaseworkQueue, InstitutionConfig, InstitutionRepo, InstitutionView, MyCasework } from "@/lib/institution/types";

// Every call runs with the signed-in user's own session, never the service role, and every rule is in the SQL: this
// file only passes arguments. A migration that isn't applied yet makes the student-side reads empty, not broken.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: string | null) => v === null || UUID_RE.test(v);

const check = <T>(res: { data: T; error: { message: string; code?: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return res.data;
};

export function supabaseInstitutionMethods(sb: SupabaseClient): InstitutionRepo {
  return {
    async institutionConfig() {
      return check(await sb.rpc("admin_institution_config")) as InstitutionConfig;
    },
    async saveInstitutionSettings(i) {
      check(await sb.rpc("admin_save_institution_settings", { p_brand_name: i.brandName, p_brand_colour: i.brandColour, p_welcome: i.welcome, p_adviser_scope: i.adviserScope }));
    },
    async stopReportSharing() {
      check(await sb.rpc("admin_stop_report_sharing"));
    },
    async saveInstitutionContact(i) {
      return check(await sb.rpc("admin_save_contact", { p_id: i.id ?? null, p_label: i.label, p_purpose: i.purpose, p_email: i.email, p_phone: i.phone, p_url: i.url, p_hours: i.hours })) as string;
    },
    async deleteInstitutionContact(id) {
      check(await sb.rpc("admin_delete_contact", { p_id: id }));
    },
    async saveInstitutionResource(i) {
      return check(await sb.rpc("admin_save_resource", { p_id: i.id ?? null, p_title: i.title, p_url: i.url, p_description: i.description, p_group: i.groupId, p_active: i.active })) as string;
    },
    async deleteInstitutionResource(id) {
      check(await sb.rpc("admin_delete_resource", { p_id: id }));
    },
    async saveProgrammeGroup(i) {
      return check(await sb.rpc("admin_save_group", { p_id: i.id ?? null, p_name: i.name, p_faculties: i.faculties, p_courses: i.courses })) as string;
    },
    async deleteProgrammeGroup(id) {
      check(await sb.rpc("admin_delete_group", { p_id: id }));
    },
    async adviserTeam() {
      return check(await sb.rpc("admin_list_advisers")) as AdviserTeam;
    },
    async setAdviser(email, adviser) {
      return String(check(await sb.rpc("admin_set_adviser", { p_email: email, p_adviser: adviser })));
    },
    async setAdviserGroups(adviserId, groupIds) {
      check(await sb.rpc("admin_set_adviser_groups", { p_adviser: adviserId, p_groups: groupIds }));
    },
    async myInstitution() {
      // Fails closed: before the migration, or on any error, a student sees no institution content rather than a broken page.
      try {
        const { data, error } = await sb.rpc("my_institution");
        return error ? null : ((data as InstitutionView | null) ?? null);
      } catch {
        return null;
      }
    },
    async adminRecordDisagreement(i) {
      if (!isId(i.reportId)) return null;
      return (check(await sb.rpc("admin_record_disagreement", { p_report: i.reportId, p_target_kind: i.targetKind, p_target_key: i.targetKey, p_rationale: i.rationale })) as string | null) ?? null;
    },
    async adminWithdrawDisagreement(id, reason) {
      return (check(await sb.rpc("admin_withdraw_disagreement", { p_id: id, p_reason: reason })) as string | null) ?? null;
    },
    async adminCreateReferral(i) {
      if (!isId(i.studentKey) || !isId(i.reportId) || !isId(i.contactId) || !isId(i.ownerId)) return null;
      return (check(await sb.rpc("admin_create_referral", { p_student: i.studentKey, p_report: i.reportId, p_contact: i.contactId, p_target: i.target, p_reason: i.reason, p_owner: i.ownerId })) as string | null) ?? null;
    },
    async adminUpdateReferral(i) {
      if (!isId(i.ownerId)) return false;
      return (check(await sb.rpc("admin_update_referral", { p_id: i.id, p_status: i.status, p_owner: i.ownerId, p_note: i.note })) as boolean | null) === true;
    },
    async adminCasework() {
      return check(await sb.rpc("admin_casework")) as CaseworkQueue;
    },
    async adminAccessLog(page = {}) {
      return ((check(await sb.rpc("admin_access_log", { p_limit: page.limit ?? 100, p_offset: page.offset ?? 0 })) as AccessLogEntry[] | null) ?? []) as AccessLogEntry[];
    },
    async adminRecordExport(kind, rows, detail = {}) {
      check(await sb.rpc("admin_record_export", { p_kind: kind, p_rows: rows, p_detail: detail }));
    },
    async myCasework() {
      try {
        const { data, error } = await sb.rpc("my_casework");
        if (error || !data) return { seenAt: null, disagreements: [], referrals: [], access: [] };
        return data as MyCasework;
      } catch {
        return { seenAt: null, disagreements: [], referrals: [], access: [] };
      }
    },
    async myCaseworkUnseen() {
      try {
        const { data, error } = await sb.rpc("my_casework_unseen");
        return error ? 0 : Number(data ?? 0);
      } catch {
        return 0;
      }
    },
    async markCaseworkSeen() {
      await sb.rpc("mark_casework_seen");
    },
    async respondToReferral(id, accept) {
      return (check(await sb.rpc("respond_to_referral", { p_id: id, p_accept: accept })) as boolean | null) === true;
    },
  };
}
