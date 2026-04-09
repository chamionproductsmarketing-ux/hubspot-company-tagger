import { tagCompanyFromDeal, INVOICE_PIPELINE } from "@/lib/hubspot";
import { getAccessToken } from "@/lib/token";

export const maxDuration = 60;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const expected = process.env.BACKFILL_KEY;
  if (expected && key !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const after = searchParams.get("after") || "0";
  const totalTagged = parseInt(searchParams.get("tt") || "0");
  const totalSkipped = parseInt(searchParams.get("ts") || "0");
  const totalErrors = parseInt(searchParams.get("te") || "0");
  const batchNum = parseInt(searchParams.get("b") || "1");

  const startTime = Date.now();
  const MAX_MS = 45000;
  let cursor = after;
  let tagged = 0, skipped = 0, errors = 0, processed = 0;

  while (Date.now() - startTime < MAX_MS) {
    const token = await getAccessToken();
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "pipeline",
            operator: "EQ",
            value: INVOICE_PIPELINE,
          }],
        }],
        limit: 100,
        after: cursor,
        properties: ["pipeline"],
      }),
    });

    if (res.status === 429) {
      await sleep(3000);
      continue;
    }

    const page = await res.json();
    const deals = page.results || [];

    for (const deal of deals) {
      if (Date.now() - startTime > MAX_MS) break;
      processed++;
      try {
        const result = await tagCompanyFromDeal(deal.id, true);
        if (result && !result.skipped) tagged++;
        else skipped++;
      } catch (err) {
        if (err.message.includes("429")) {
          await sleep(3000);
          try {
            const retry = await tagCompanyFromDeal(deal.id, true);
            if (retry && !retry.skipped) tagged++;
            else skipped++;
          } catch (retryErr) {
            errors++;
          }
        } else {
          errors++;
          console.error(`Backfill error deal ${deal.id}: ${err.message}`);
        }
      }
      await sleep(200);
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
    <head><meta http-equiv="refresh" content="2;url=${nextUrl}"></head>
    <body style="font-family:system-ui;padding:2rem">
      <h1>Backfill in progress...</h1>
      <p><strong>Batch:</strong> ${batchNum} | <strong>This batch:</strong> ${processed} deals</p>
      <p><strong>Running total — Tagged:</strong> ${runTagged} | <strong>Skipped:</strong> ${runSkipped} | <strong>Errors:</strong> ${runErrors}</p>
      <p>Auto-continuing in 2 seconds... <a href="${nextUrl}">Click here if not redirected</a></p>
    </body>
  </html>`, { headers: { "Content-Type": "text/html" } });
}
