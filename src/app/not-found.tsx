import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-[640px] flex-col justify-center gap-4 px-7">
      <p className="m-0 font-mono text-xs text-brand">404</p>
      <h1 className="m-0 text-[44px] font-normal leading-[1.1] tracking-[-1.98px]">We couldn&apos;t find that page</h1>
      <p className="m-0 text-base text-muted">It may have been deleted, or the link is wrong.</p>
      <Link href="/" className="inline-flex min-h-11 items-center self-start rounded-full bg-black px-[18px] text-sm font-medium text-white no-underline hover:text-white">
        Go to my dashboard
      </Link>
    </main>
  );
}
