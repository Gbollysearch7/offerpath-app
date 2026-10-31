// Student stages. Kept free of server code so client components can import it.
export const STAGE_OPTIONS = [
  { key: "first", t: "First year", d: "Spring weeks and insight days", label: "first-year student" },
  { key: "penultimate", t: "Penultimate year", d: "Summer internships and placements", label: "penultimate-year student" },
  { key: "final", t: "Final year", d: "Graduate schemes and jobs", label: "final-year student" },
  { key: "graduate", t: "Recent graduate", d: "Graduated in the last two years", label: "recent graduate" },
] as const;
