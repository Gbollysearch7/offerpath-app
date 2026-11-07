import type { Metadata } from "next";
import { legal } from "@/lib/legal";
import { LegalPage } from "../LegalPage";

export const metadata: Metadata = { title: "Accessibility statement" };

export default function Accessibility() {
  return (
    <LegalPage title="Accessibility statement" draft intro={<>We want everyone to be able to use Offerpath, including people who use screen readers, keyboard navigation, magnification or voice control.</>}>
      <section>
        <h2>How accessible this service is</h2>
        <p>We&apos;re working towards the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. We can&apos;t yet say how far Offerpath meets them. The main student tasks have been checked with automated tools and scripted keyboard tests, but Offerpath has not had an independent accessibility audit or testing with people who use assistive technology, and no screen reader has been tried.</p>
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">[Founder and accessibility reviewer: add the formal compliance status once there is evidence for one.]</p>
        <ul>
          <li>We test the main student tasks with a keyboard. Most student pages have a skip link.</li>
          <li>Forms have labels and error messages.</li>
          <li>In automated checks of the main student pages, text colours met AA contrast, though the tool couldn&apos;t judge the numbers inside score rings. These pages were also checked at 320 pixels wide, where long tables scroll sideways.</li>
          <li>Charts and score rings have text alternatives.</li>
          <li>Animations stop if you have reduced motion switched on.</li>
        </ul>
      </section>
      <section>
        <h2>Known limitations</h2>
        <ul>
          <li>Many buttons and links are smaller than 44 pixels. On a typical report page, most controls are.</li>
          <li>Downloaded PDF templates, letters and tailored CVs are simple text documents but are not yet tagged PDFs, so a screen reader gets no headings or lists. Use the Word version if you need them.</li>
          <li>Word downloads have headings and lists. They have not yet been tested with screen readers.</li>
          <li>The careers team pages have had lighter checks than the student pages.</li>
          <li>Some charts on the careers dashboard have a text summary rather than a full data table.</li>
        </ul>
      </section>
      <section>
        <h2>Feedback and contact</h2>
        <p>If you find a problem or need information in a different format, email {legal.supportEmail()}.</p>
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm">[Founder to decide before any pilot goes live: who answers these requests, and how quickly.]</p>
        <p>If you&apos;re not happy with our response, you can contact the Equality Advisory and Support Service (EASS).</p>
      </section>
      <section>
        <h2>How we tested</h2>
        <p>Automated checks with axe-core on the main student and public pages at desktop and mobile sizes, plus scripted keyboard checks, in Chrome on macOS, in November 2026. No person has yet run the manual keyboard or assistive technology tests. We&apos;ll review this statement after those tests, and after any independent audit.</p>
      </section>
    </LegalPage>
  );
}
