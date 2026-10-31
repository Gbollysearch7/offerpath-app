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
          <li>What you upload or write: CVs, job adverts, cover letters and the notes you add.</li>
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
        <p>When AI feedback is used, the relevant text is sent to Anthropic only to produce the result. Under Anthropic&apos;s commercial terms it isn&apos;t used to train their models.</p>
      </section>
      <section>
        <h2>Where your data is kept, and who helps us</h2>
        <p>Your account, files and reports are stored in the UK or EU. Some service providers process data outside the UK, under data processing agreements and approved safeguards such as the UK International Data Transfer Addendum. See the <Link href="/legal/sub-processors">list of sub-processors</Link>.</p>
      </section>
      <section>
        <h2>How long we keep it</h2>
        <p>Until you delete your account, or until your account has been inactive for {months} months, when it is deleted automatically. Deleting your account removes your CVs, reports, letters, applications and cached feedback straight away. Backups are overwritten within 30 days.</p>
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
