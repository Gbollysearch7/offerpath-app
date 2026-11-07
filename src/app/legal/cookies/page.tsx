import type { Metadata } from "next";
import { LegalPage } from "../LegalPage";

export const metadata: Metadata = { title: "Cookies" };

export default function Cookies() {
  const analytics = !!process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <LegalPage title="Cookies" intro={<>Offerpath only uses cookies that are needed to sign you in and keep you signed in. Because they are strictly necessary, we don&apos;t ask for consent, and there are no advertising or tracking cookies.</>}>
      <div tabIndex={0} role="region" aria-label="Cookies table, scrolls sideways" className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              {["Cookie", "Purpose", "Lasts"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2.5 font-mono text-[11px] font-normal text-subtle">
                  {h.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["sb-*-auth-token", "Keeps you signed in (Supabase)", "Until you sign out, refreshed while you use the app"],
              ["op_demo", "Demo version only: remembers your sample account", "7 days"],
            ].map(([c, p, l]) => (
              <tr key={c}>
                <td className="border-b border-line px-2 py-3 font-mono text-[13px] text-black">{c}</td>
                <td className="border-b border-line px-2 py-3">{p}</td>
                <td className="border-b border-line px-2 py-3">{l}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{analytics ? "We count page visits with Plausible Analytics, which uses no cookies and collects no personal data." : "We don't use analytics cookies."}</p>
    </LegalPage>
  );
}
