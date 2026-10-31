import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// Fetches a user-supplied URL without letting it reach private or internal addresses (SSRF).
// Every hop is checked: the URL itself, any IP literal, the DNS answer at connect time (which also
// stops DNS rebinding), and each redirect, which is followed by hand.

export class UnsafeUrlError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  // IPv4-mapped in hex form, as URL parsing writes it: ::ffff:7f00:1 is 127.0.0.1.
  const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // IPv4-compatible (deprecated) and NAT64 forms are never legitimate job ad hosts.
  if (/^::[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v6)) return true;
  // ULA, link-local, site-local (fec0::/10), multicast, NAT64, documentation, 6to4 and Teredo.
  return /^(fc|fd|fe[89a-f]|ff)/.test(v6) || /^(64:ff9b:|2001:db8|2002:|2001:0?:|2001::)/.test(v6);
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return (callback as (e: NodeJS.ErrnoException | null, a: string, f: number) => void)(err, "", 0);
    const safe = addresses.filter((a) => !isPrivateAddress(a.address));
    if (!safe.length) return (callback as (e: Error, a: string, f: number) => void)(new UnsafeUrlError("blocked private address"), "", 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, safe);
    (callback as (e: null, a: string, f: number) => void)(null, safe[0].address, safe[0].family);
  });
};

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: 5000 } });

function checkUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("only http and https");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("non-standard port");
  if (url.username || url.password) throw new UnsafeUrlError("credentials in url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError("private address");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new UnsafeUrlError("internal host");
  return url;
}

/** GETs a public web page and returns at most `maxBytes` of its text. */
export async function fetchPublicText(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 600_000;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 8000);
  let url = checkUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await undiciFetch(url, { dispatcher: agent, redirect: "manual", signal, headers: { "user-agent": "OfferpathBot/1.0 (+job ad reader)", accept: "text/html,text/plain" } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new UnsafeUrlError("redirect without location");
      url = checkUrl(new URL(loc, url));
      continue;
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)|application\/xhtml/i.test(type)) {
      await res.body?.cancel();
      throw new UnsafeUrlError("not a web page");
    }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
  }
  throw new UnsafeUrlError("too many redirects");
}
