import type { Metadata } from "next";
import Link from "next/link";
import { legal } from "@/lib/legal";
import { LegalPage } from "../LegalPage";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyNotice() {
  const months = legal.retentionInactiveMonths();
  return (
    <LegalPage
      title="Privacy notice"
      draft
      intro={
        <>
          Offerpath is provided to you by your university. <strong className="text-black">Your university is the data controller</strong>: it decides why and how your data is used. {legal.operator()} runs Offerpath for your university as its <strong className="text-black">data processor</strong>. Your university&apos;s own privacy notice also applies.
        </>
      }
    >
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Account details: your name, university email address and, if your university provides it, your student number, course, year of study, faculty and fee status.</li>
          <li>What you upload or write: CVs, job adverts, cover letters, the LinkedIn profile text you paste or export, your written interview practice answers, and the notes you add.</li>
          <li>What we work out: Readiness Scores, feedback, tailoring results and letter drafts.</li>
          <li>Your choices: your stage, target sectors, sharing and reminder settings, and the opportunities you track.</li>
          <li>Technical data: security and error logs, kept for up to 30 days.</li>
        </ul>
      </section>
      <section>
        <h2>Why we use it, and the lawful basis</h2>
        <p>To give you feedback on your applications and help you track opportunities. Your university relies on its public task of supporting students&apos; education and employability, or on its legitimate interests, as set out in its own privacy notice.</p>
        <p>Sharing your progress with your careers service is optional and off until you switch it on. If you do, careers staff can see your scores and activity next to your student number, but never your CV. You can switch it off at any time.</p>
      </section>
      <section>
        <h2>AI and automated scoring</h2>
        <p>Your Readiness Score is calculated by a fixed set of rules. Part of the input comes from an AI model (Claude, by Anthropic), which answers set questions about each bullet point. No decision with legal or similarly significant effects is made about you automatically. Scores are guidance, and you can ask a careers adviser to look at your CV with you.</p>
        <p>When AI feedback is used, the relevant text is sent to Anthropic only to produce the result. Anthropic&apos;s published commercial terms say it may not train models on customer content.</p>
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">[Founder to confirm before any pilot goes live: that these terms cover Offerpath&apos;s Anthropic account, and how long Anthropic keeps this text.]</p>
      </section>
      <section>
        <h2>Where your data is kept, and who helps us</h2>
        <p>Your account, files and reports are stored in the UK or EU. Some service providers process data outside the UK, including in the United States. A data processing agreement and an approved transfer safeguard with each of them are required before any pilot goes live. See the <Link href="/legal/sub-processors">list of sub-processors</Link>.</p>
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">[Founder and lawyer to complete before any pilot goes live: which agreements are signed, and which transfer safeguard applies.]</p>
      </section>
      <section>
        <h2>Links you choose to share</h2>
        <p>If your university allows it, you can create a link to a limited summary of a CV review. Anyone who has the link can open it, without signing in, until it expires (30 days at most) or you switch it off. It never includes your CV text, name or contact details. We store the time each link was opened, so you can see that it was used, and nothing about who opened it. Links and those times are removed 90 days after a link expires, or straight away when you delete your account.</p>
      </section>
      <section>
        <h2>How long we keep it</h2>
        <p>Until you delete your account. If your account is inactive for {months} months, we email you a warning and delete it 30 days later unless you sign in. Deleting your account removes your CVs (the original files and every corrected or typed version), reports, the spelling suggestions you dismissed and your language choice, letters, applications, interview practice answers and adviser notes, disagreements and referrals about you straight away. We keep a log of when careers staff opened your record, for 24 months; when you delete your account, your name and number are no longer tied to it. Security logs, which don&apos;t contain your CV or letters, expire within 30 days. Records your university gave us about you, such as your course, belong to your university and stay until it removes them. Copies held by our service providers, such as emails we&apos;ve sent you and text sent for AI feedback, follow those providers&apos; own retention periods, and we can&apos;t recall them. Any backup keeps deleted data until that backup expires.</p>
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">[Founder decision before any pilot goes live: how long backups are kept, once backups are running, and whether a record of deleted accounts is kept so that they stay deleted if a backup is restored. No period is stated here because none has been decided.]</p>
      </section>
      <section>
        <h2>Your rights</h2>
        <p>You can see, download and delete your data yourself from <Link href="/privacy">Privacy and my data</Link>. You also have rights to rectification, restriction and objection. To use them, or to complain, contact your university&apos;s data protection officer. You can also complain to the Information Commissioner&apos;s Office at ico.org.uk.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          {legal.operator()}, {legal.operatorAddress()}. Company number {legal.companyNumber()}. ICO registration {legal.icoNumber()}. Email {legal.contactEmail()}.
        </p>
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">[Partner university: add your data protection officer&apos;s contact details and a link to your student privacy notice.]</p>
      </section>
    </LegalPage>
  );
}
