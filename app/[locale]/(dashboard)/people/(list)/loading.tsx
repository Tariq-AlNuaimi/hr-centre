import { PageSkeleton } from "@/components/shared/Skeletons";

/**
 * QA D-16: route-level loading boundaries live per section, never on
 * (dashboard) or people/ — a boundary ABOVE people/[id] streams that page, and
 * its out-of-scope `notFound()` then answers HTTP 200 instead of 404.
 */
export default function DashboardLoading() {
  return <PageSkeleton rows={6} />;
}
