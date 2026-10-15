import { notFound } from "next/navigation";
import { QuoteWidget } from "@/components/widget/QuoteWidget";
import { publicConfig } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The page the hauler's site frames. Transparent background so it sits on any theme. */
export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getStore().getTenantBySlug((await params).slug);
  if (!tenant) notFound();
  return (
    <main className="embed-root p-2 sm:p-4">
      <QuoteWidget config={publicConfig(tenant)} />
    </main>
  );
}
