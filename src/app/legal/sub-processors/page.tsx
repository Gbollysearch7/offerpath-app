import type { Metadata } from "next";
import { SUB_PROCESSORS } from "@/lib/legal";
import { LegalPage } from "../LegalPage";

export const metadata: Metadata = { title: "Sub-processors" };

export default function SubProcessors() {
  return (
    <LegalPage title="Sub-processors" draft intro={<>These companies process personal data on our behalf to run Offerpath. A data processing agreement with each of them is required before any pilot goes live. Before a pilot starts, we&apos;ll agree with the university how it&apos;s told about changes to this list.</>}>
      <div tabIndex={0} role="region" aria-label="Sub-processors table, scrolls sideways" className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-left">
              {["Company", "What for", "Data", "Where"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2.5 font-mono text-[11px] font-normal text-subtle">
                  {h.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUB_PROCESSORS.map((s) => (
              <tr key={s.name}>
                <td className="border-b border-line px-2 py-3 align-top font-medium text-black">{s.name}</td>
                <td className="border-b border-line px-2 py-3 align-top">{s.purpose}</td>
                <td className="border-b border-line px-2 py-3 align-top">{s.data}</td>
                <td className="border-b border-line px-2 py-3 align-top">{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LegalPage>
  );
}
