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
  const totalTagged = parseInt(searchParams.get("tt") || "0");
  const totalSkipped = parseInt(searchParams.get("ts") || "0");
  const totalErrors = parseInt(searchParams.get("te") || "0");
  const batchNum = parseInt(searchParams.get("b") || "1");

  const startTime = Date.now();
  const MAX_MS = 48000; // stop at 48s to leave room
  let cursor = after;
  let tagged = 0, skipped = 0, errors = 0, processed = 0;

  while (Date.now() - startTime < MAX_MS) {
    const qs = cursor ? `?limit=50&after=${cursor}` : "?limit=50";
    const token = await getAccessToken();
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const page = await res.json();
    const deals = page.results || [];

    for (const deal of deals) {
      if (Date.now() - startTime > MAX_MS) break;
      processed++;
      try {
        const result = await tagCompanyFromDeal(deal.id);
        if (result && !result.skipped) tagged++;
        else skipped++;
      } catch (err) {
        errors++;
        console.error(`Backfill error deal ${deal.id}: ${err.message}`);
      }
    }

    cursor = page.paging?.next?.after;
    if (!cursor) break;
    if (Date.now() - startTime > MAX_MS) break;
  }

  const runTagged = totalTagged + tagged;
  const runSkipped = totalSkipped + skipped;
  const runErrors = totalErrors + errors;

  if (!cursor) {
    return new Response(`<html><body style="font-family:system-ui;padding:2rem">
      <h1>Backfill Complete!</h1>
      <p><strong>Total tagged:</strong> ${runTagged}</p>
      <p><strong>Total skipped:</strong> ${runSkipped}</p>
      <p><strong>Total errors:</strong> ${runErrors}</p>
    </body></html>`, { headers: { "Content-Type": "text/html" } });
  }

  const nextUrl = `https://hubspot-company-tagger.vercel.app/api/hubspot/backfill?key=${key}&after=${cursor}&tt=${runTagged}&ts=${runSkipped}&te=${runErrors}&b=${batchNum + 1}`;

  return new Response(`<html>
    <head><meta http-equiv="refresh" content="1;url=${nextUrl}"></head>
    <body style="font-family:system-ui;padding:2rem">
      <h1>Backfill in progress...</h1>
      <p><strong>Batch:</strong> ${batchNum} | <strong>This batch:</strong> ${processed} deals</p>
      <p><strong>Running total — Tagged:</strong> ${runTagged} | <strong>Skipped:</strong> ${runSkipped} | <strong>Errors:</strong> ${runErrors}</p>
      <p>Auto-continuing in 1 second... <a href="${nextUrl}">Click here if not redirected</a></p>
    </body>
  </html>`, { headers: { "Content-Type": "text/html" } });
}
