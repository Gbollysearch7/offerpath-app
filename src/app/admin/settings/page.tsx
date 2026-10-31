import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { isDemoMode, requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Settings and SSO" };

const MAPPING = {
  keys: {
    email: { name: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" },
    full_name: { name: "http://schemas.microsoft.com/identity/claims/displayname" },
    student_number: { name: "urn:oid:1.3.6.1.4.1.5923.1.1.1.6", default: "" },
    course: { name: "course" },
    year_of_study: { name: "yearOfStudy" },
    faculty: { name: "faculty" },
    fee_status: { name: "feeStatus" },
  },
};

export default async function SettingsPage() {
  const { repo, profile } = await requireAdmin();
  const uni = await repo.adminUniversity();
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://your-offerpath-domain";
  return (
    <AdminShell profile={profile} university={uni.name} active="settings" title="Settings and SSO" intro={<>How students at {uni.name || "your university"} sign in, and how their course details reach Offerpath.</>}>
      <section className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
        <h2 className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">SIGN-IN</h2>
        <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[200px_1fr]">
          <dt className="text-subtle">University</dt>
          <dd className="m-0">{uni.name || "Not set"}</dd>
          <dt className="text-subtle">Allowed email domain</dt>
          <dd className="m-0 font-mono">{uni.domain || "Not set"} (and its subdomains)</dd>
          <dt className="text-subtle">Email sign-in links</dt>
          <dd className="m-0">{isDemoMode() ? "Demo mode: sign-in opens a sample account" : "On"}</dd>
          <dt className="text-subtle">University single sign-on</dt>
          <dd className="m-0">Set up by Offerpath with your identity team (SAML 2.0). Students then use &quot;Continue with university sign-in&quot;.</dd>
        </dl>
      </section>
      <section className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
        <h2 className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">SETTING UP SINGLE SIGN-ON (FOR YOUR IDENTITY TEAM)</h2>
        <ol className="m-0 flex flex-col gap-2 pl-5 text-sm leading-relaxed text-body">
          <li>Send Offerpath your identity provider&apos;s SAML metadata URL (Microsoft Entra ID, Shibboleth, Okta or Google Workspace all work).</li>
          <li>
            Add Offerpath as a service provider using the details we send back. The sign-in return address is <span className="font-mono">{site}/auth/callback</span>.
          </li>
          <li>Release these attributes so course details fill in automatically (optional, but saves CSV imports):</li>
        </ol>
        <pre className="m-0 overflow-x-auto rounded-2xl bg-canvas p-4 font-mono text-xs leading-relaxed">{JSON.stringify(MAPPING, null, 2)}</pre>
        <p className="m-0 text-sm text-muted">Attribute names vary by provider; we&apos;ll adjust the mapping to match yours. Values from an imported CSV take priority over SSO values.</p>
      </section>
    </AdminShell>
  );
}
