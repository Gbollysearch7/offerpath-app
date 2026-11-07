import Link from "next/link";
import { getRepo } from "@/lib/session";

// In-app only. Nothing here sends anything, or says anything has been delivered. It shows on a student's next page.
export async function CaseworkNotice() {
  const repo = await getRepo();
  if (!repo) return null;
  const unseen = await repo.myCaseworkUnseen();
  if (unseen === 0) return null;
  return (
    <div role="status" className="border-b border-mist bg-mist px-4 py-2.5 text-center text-sm sm:px-7">
      Your careers service has added something for you. <Link href="/careers-service" className="underline">See what&apos;s new</Link>
    </div>
  );
}
