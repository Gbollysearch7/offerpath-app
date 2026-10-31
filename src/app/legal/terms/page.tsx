import type { Metadata } from "next";
import Link from "next/link";
import { legal } from "@/lib/legal";
import { LegalPage } from "../LegalPage";

export const metadata: Metadata = { title: "Terms of use" };

export default function Terms() {
  return (
    <LegalPage title="Terms of use" intro={<>These terms apply when you use Offerpath through your university. By signing in you agree to them.</>}>
      <section>
        <h2>Who can use Offerpath</h2>
        <p>Students and staff at partner universities, signing in with their university account. Keep your sign-in links to yourself, and don&apos;t let anyone else use your account.</p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>You keep ownership of everything you upload or write. You give us permission to process it only to provide the service to you and your university. Only upload documents you have the right to share, and don&apos;t upload other people&apos;s personal data beyond what normally appears on a CV or cover letter.</p>
      </section>
      <section>
        <h2>Feedback is guidance</h2>
        <p>Scores, suggestions and drafts are there to help you. They don&apos;t guarantee any outcome with an employer. Check everything before you send it, and only include facts that are true. Opportunity details are provided for convenience; always confirm deadlines, eligibility and visa sponsorship with the employer.</p>
      </section>
      <section>
        <h2>Fair use</h2>
        <ul>
          <li>Don&apos;t try to break, overload, probe or get round the security or limits of the service, including daily limits on AI features.</li>
          <li>Don&apos;t use the service to create misleading applications or content for anyone else.</li>
          <li>Don&apos;t upload anything unlawful, harmful or containing malware.</li>
        </ul>
        <p>We may suspend accounts that break these terms, and will tell your university if we do.</p>
      </section>
      <section>
        <h2>Availability and changes</h2>
        <p>We work to keep Offerpath available but can&apos;t promise it will always be uninterrupted. We may update features and these terms; if a change matters, we&apos;ll tell you in the app.</p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>Nothing in these terms limits liability that can&apos;t be limited by law. Otherwise, we aren&apos;t responsible for decisions made by employers or for losses arising from how you use the feedback.</p>
      </section>
      <section>
        <h2>Contact and law</h2>
        <p>
          Questions: {legal.supportEmail()}. These terms are governed by the law of England and Wales. Your data is covered by the <Link href="/legal/privacy">privacy notice</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
