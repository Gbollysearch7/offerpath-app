// Shared by the document writers (server) and the CV preview (client).
export interface DocBlock {
  kind: "name" | "tagline" | "contact" | "heading" | "role" | "para" | "bullet" | "note";
  text: string;
  /** Role lines only: the dates. */
  date?: string;
}
