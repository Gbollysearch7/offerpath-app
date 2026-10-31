import type { Metadata } from "next";
import { legal } from "@/lib/legal";
import { LegalPage } from "../LegalPage";

export const metadata: Metadata = { title: "Accessibility statement" };

export default function Accessibility() {
  return (
    <LegalPage title="Accessibility statement" intro={<>We want everyone to be able to use Offerpath, including people who use screen readers, keyboard navigation, magnification or voice control.</>}>
      <section>
        <h2>How accessible this service is</h2>
        <p>Offerpath is designed to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. It is <strong className="text-black">partially compliant</strong>: it has passed automated testing and keyboard checks, but has not yet had a full audit by an independent accessibility specialist or testing with assistive technology users.</p>
        <ul>
          <li>Every page can be used with a keyboard, with a visible focus indicator and a skip link.</li>
          <li>Forms have labels and clear error messages, and touch targets are at least 44 pixels.</li>
          <li>Text colours meet AA contrast, and pages work from 320 pixels wide and at 400% zoom.</li>
          <li>Charts and score rings have text alternatives.</li>
          <li>Animations stop if you have reduced motion switched on.</li>
        </ul>
      </section>
      <section>
        <h2>Known limitations</h2>
        <ul>
          <li>Downloaded PDF templates and letters are simple text documents but are not yet tagged PDFs. Word downloads are fully accessible.</li>
          <li>Some charts on the careers dashboard have a text summary rather than a full data table.</li>
        </ul>
      </section>
      <section>
        <h2>Feedback and contact</h2>
        <p>If you find a problem or need information in a different format, email {legal.supportEmail()}. We aim to reply within 5 working days.</p>
        <p>If you&apos;re not happy with our response, you can contact the Equality Advisory and Support Service (EASS).</p>
      </section>
      <section>
        <h2>How we tested</h2>
        <p>Automated checks with axe-core across every page at desktop and mobile sizes, plus manual keyboard testing. This statement was prepared on {legal.lastUpdated} and will be reviewed after the independent audit.</p>
      </section>
    </LegalPage>
  );
}
