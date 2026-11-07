// Universities offered on the sign-in page's single sign-on selector. Each must also have its SAML provider connected
// in Supabase (docs/DEPLOY.md). There is deliberately no default: with nothing set, university sign-in isn't offered.

export interface SsoUniversity {
  name: string;
  domain: string;
}

/** SSO_UNIVERSITIES="University of Example=example.ac.uk;Another University=another.ac.uk". Malformed entries are dropped. */
export function ssoUniversities(env: NodeJS.ProcessEnv = process.env): SsoUniversity[] {
  const seen = new Set<string>();
  const out: SsoUniversity[] = [];
  for (const entry of (env.SSO_UNIVERSITIES ?? "").split(";")) {
    const at = entry.lastIndexOf("=");
    if (at < 1) continue;
    const name = entry.slice(0, at).trim();
    const domain = entry.slice(at + 1).trim().toLowerCase();
    if (!name || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ name, domain });
  }
  return out;
}
