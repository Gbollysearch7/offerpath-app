"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-[640px] flex-col justify-center gap-4 px-7">
      <h1 className="m-0 text-[44px] font-normal leading-[1.1] tracking-[-1.98px]">Something went wrong</h1>
      <p className="m-0 text-base text-muted">Your work is saved. Try again, and if it keeps happening, contact your careers service.</p>
      <button type="button" onClick={reset} className="min-h-11 self-start rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white">
        Try again
      </button>
    </main>
  );
}
