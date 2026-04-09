import { tagCompanyFromDeal, INVOICE_PIPELINE } from "@/lib/hubspot";
import { getAccessToken } from "@/lib/token";

export const maxDuration = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const expected = process.env.BACKFILL_KEY;
  if (expected && key !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (searchParams.get("debug") === "1") {
    const token = await getAccessToken();
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: INVOICE_PIPELINE }] }],
        limit: 5,
        properties: ["pipeline", "dealname", "dealstage"],
      }),
    });
    const data = await res.json();

    // Also test tagging the first deal to see skip reason
    const testResults = [];
    for (const deal of (data.results || []).slice(0, 3)) {
      try {
        const result = await tagCompanyFromDeal(deal.id, true);
        testResults.push({ dealId: deal.id, name: deal.properties?.dealname, ...result });
      } catch (err) {
        testResults.push({ dealId: deal.id, name: deal.properties?.dealname, error: err.message });
      }
      await sleep(500);
    }

    return Response.json({ total: data.total, testResults });
  }

  const after = searchParams.get("after") || null;
  const totalTagged = parseInt(searchParams.get("tt") || "0");
  const totalSkipped = parseInt(searchParams.get("ts") || "0");
  const totalErrors = parseInt(searchParams.get("te") || "0");
  const batchNum = parseInt(searchParams.get("b") || "1");

  const startTime = Date.now();
  const MAX_MS = 270000;
  let cursor = after;
  let tagged = 0, skipped = 0, errors = 0, processed = 0;
  const skipReasons = {};

  while (Date.now() - startTime < MAX_MS) {
    const token = await getAccessToken();
    const searchBody = {
      filterGroups: [{ filters: [{ propertyName: "pipeline", operator: "EQ", value: INVOICE_PIPELINE }] }],
      limit: 100,
      properties: ["pipeline"],
    };
    if (cursor) searchBody.after = cursor;

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(searchBody),
    });

    if (res.status === 429) { await sleep(5000); continue; }
    if (!res.ok) { await sleep(2000); continue; }

    const page = await res.json();
    const deals = page.results || [];
    if (deals.length === 0) { cursor = null; break; }

    for (const deal of deals) {
      if (Date.now() - startTime > MAX_MS) break;
      processed++;
      try {
        const result = await tagCompanyFromDeal(deal.id, true);
        if (result && !result.skipped) {
          tagged++;
        } else {
          skipped++;
          const reason = result?.reason || "unknown";
          skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        }
      } catch (err) {
        if (err.message.includes("429")) {
          await sleep(5000);
          try {
            const retry = await tagCompanyFromDeal(deal.id, true);
            if (retry && !retry.skipped) tagged++;
            else skipped++;
          } catch (retryErr) { errors++; }
        } else {
          errors++;
          console.error(`Backfill error deal ${deal.id}: ${err.message}`);
        }
      }
      await sleep(150);
    }

    cursor = page.paging?.next?.after || null;
    if (!cursor) break;
  }

  const runTagged = totalTagged + tagged;
  const runSkipped = totalSkipped + skipped;
  const runErrors = totalErrors + errors;
  const reasonsHtml = Object.entries(skipReasons).map(([r, c]) => `<li>${r}: ${c}</li>`).join("");

  if (!cursor) {
    return new Response(`<html><body style="font-family:system-ui;padding:2rem">
      <h1>Backfill Complete!</h1>
      <p><strong>Total tagged:</strong> ${runTagged}</p>
      <p><strong>Total skipped:</strong> ${runSkipped}</p>
      <p><strong>Total errors:</strong> ${runErrors}</p>
      <p><strong>Skip reasons (this batch):</strong></p><ul>${reasonsHtml}</ul>
    </body></html>`, { headers: { "Content-Type": "text/html" } });
  }

  const nextUrl = `https://hubspot-company-tagger.vercel.app/api/hubspot/backfill?key=${key}&after=${cursor}&tt=${runTagged}&ts=${runSkipped}&te=${runErrors}&b=${batchNum + 1}`;

  return new Response(`<html>
    <head><meta http-equiv="refresh" content="3;url=${nextUrl}"></head>
    <body style="font-family:system-ui;padding:2rem">
      <h1>Backfill in progress...</h1>
      <p><strong>Batch:</strong> ${batchNum} | <strong>This batch:</strong> ${processed} deals</p>
      <p><strong>Running total — Tagged:</strong> ${runTagged} | <strong>Skipped:</strong> ${runSkipped} | <strong>Errors:</strong> ${runErrors}</p>
      <p><strong>Skip reasons (this batch):</strong></p><ul>${reasonsHtml}</ul>
      <p>Auto-continuing in 3 seconds... <a href="${nextUrl}">Click here if not redirected</a></p>
    </body>
  </html>`, { headers: { "Content-Type": "text/html" } });
}
