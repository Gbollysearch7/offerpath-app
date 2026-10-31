import { permanentRedirect } from "next/navigation";

// The privacy notice moved to /legal/privacy.
export default function PrivacyNoticeRedirect() {
  permanentRedirect("/legal/privacy");
}
