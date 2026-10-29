import { PreboardingInvalid } from "@/components/jml/preboarding/PreboardingInvalid";

/** QA2 N-17 — an invalid preboarding link: HTTP 404, the same prop-less page. */
export default function PreboardingNotFound() {
  return <PreboardingInvalid />;
}
