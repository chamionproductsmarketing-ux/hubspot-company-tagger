import { tagCompanyFromDeal } from "@/lib/hubspot";
import { getAccessToken } from "@/lib/token";

export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const expected = process.env.BACKFILL_KEY;
  if (expected && key !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const after = searchParams.get("after") || undefined;
  const batchSize = 20;
  const qs = after ? `?limit=${batchSize}&after=${after}` : `?limit=${batchSize}`;

  const token = await getAccessToken();
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const page = await res.json();

  let tagged = 0, skipped = 0, errors = [];

  for (const deal of page.results || []) {
    try {
      const result = await tagCompanyFromDeal(deal.id);
      if (result && !result.skipped) tagged++;
      else skipped++;
    } catch (err) {
      errors.push({ dealId: deal.id, error: err.message });
    }
  }

  const nextAfter = page.paging?.next?.after;
  const baseUrl = `https://hubspot-company-tagger.vercel.app/api/hubspot/backfill?key=${key}`;

  return Response.json({
    batch: page.results?.length || 0,
    tagged, skipped, errors,
    next: nextAfter ? `${baseUrl}&after=${nextAfter}` : null,
    message: nextAfter ? "Click next URL to continue" : "Backfill complete — no more deals",
  });
}
