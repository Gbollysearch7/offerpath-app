// A word-level difference between two sentences, for showing what a suggestion changes. No dependencies: the page imports it.

export interface DiffPart {
  t: string;
  kind: "same" | "added" | "removed";
}

const tokens = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  // Longest common subsequence. A sentence is short; anything unusually long is shown as a plain replacement.
  if (a.length * b.length > 250_000) return [...(a.length ? [{ t: a.join(" "), kind: "removed" as const }] : []), ...(b.length ? [{ t: b.join(" "), kind: "added" as const }] : [])];
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (t: string, kind: DiffPart["kind"]) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.t += ` ${t}`;
    else out.push({ t, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i], "same");
      i++;
      j++;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) push(b[j++], "added");
    else push(a[i++], "removed");
  }
  return out;
}
