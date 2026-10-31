"use client";

import { useRouter } from "next/navigation";
import type { Period } from "@/lib/periods";

export function PeriodSelect({ periods, current }: { periods: Period[]; current: string }) {
  const router = useRouter();
  return (
    <label>
      <span className="sr-only-abs">Reporting period</span>
      <select value={current} onChange={(e) => router.push(`/admin?period=${encodeURIComponent(e.target.value)}`)} className="min-h-11 rounded-full border border-edge bg-white px-3.5 text-sm">
        {periods.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
