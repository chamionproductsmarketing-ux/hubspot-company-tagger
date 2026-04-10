import { getAccessToken } from "@/lib/token";
import { PRODUCT_GROUP_MAP, VALID_SUPPLIER_IDS } from "@/lib/mappings";
import { INVOICE_PIPELINE } from "@/lib/hubspot";

export const maxDuration = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function hubspotFetch(url, options = {}, retries = 3) {
  const HUBSPOT_BASE = "https://api.hubapi.com";
  for (let i = 0; i < retries; i++) {
    const token = await getAccessToken();
    const res = await fetch(url.startsWith("http") ? url : `${HUBSPOT_BASE}${url}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (res.status === 429) { await sleep((i + 1) * 5000); continue; }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${options.method || "GET"} ${url} → ${res.status}: ${body}`);
    }
    return res.json();
  }
  throw new Error(`Rate limited after ${retries} retries: ${url}`);
}

function parseSemicolon(value) {
  if (!value) return [];
  return value.split(";").map(s => s.trim()).filter(Boolean);
}

async function processCompany(company) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const assocRes = await hubspotFetch(
    `/crm/v3/objects/companies/${company.id}/associations/deals`
  );
  const dealIds = (assocRes.results || []).map(r => r.id);

  const activeCategories = new Set();
  const activeVendors = new Set();

  if (dealIds.length > 0) {
    for (let i = 0; i < dealIds.length; i += 100) {
      const batch = dealIds.slice(i, i + 100);
      const dealsRes = await hubspotFetch("/crm/v3/objects/deals/batch/read", {
        method: "POST",
        body: JSON.stringify({
          properties: ["pipeline", "createdate"],
          inputs: batch.map(id => ({ id })),
        }),
      });

      const recentDeals = (dealsRes.results || []).filter(d =>
        d.properties?.pipeline === INVOICE_PIPELINE &&
        d.properties?.createdate >= thirtyDaysAgo
      );

      for (const deal of recentDeals) {
        const lineAssoc = await hubspotFetch(
          `/crm/v3/objects/deals/${deal.id}/associations/line_items`
        );
        const lineItemIds = (lineAssoc.results || []).map(r => r.id);
        if (lineItemIds.length === 0) continue;

        const lineItemsRes = await hubspotFetch("/crm/v3/objects/line_items/batch/read", {
          method: "POST",
          body: JSON.stringify({
            properties: ["supplier_id", "product_group_id"],
            inputs: lineItemIds.map(id => ({ id })),
          }),
        });

        for (const item of lineItemsRes.results || []) {
          const pgId = String(item.properties?.product_group_id || "").trim();
          const sId = String(item.properties?.supplier_id || "").trim();
          if (pgId && PRODUCT_GROUP_MAP[pgId]) activeCategories.add(PRODUCT_GROUP_MAP[pgId]);
          if (sId && VALID_SUPPLIER_IDS.has(sId)) activeVendors.add(sId);
        }
        await sleep(150);
      }
      await sleep(200);
    }
  }

  const lapsedCategories = company.categories_purchased.filter(c => !activeCategories.has(c));
  const lapsedVendors = company.vendors_purchased.filter(v => !activeVendors.has(v));

  await hubspotFetch(`/crm/v3/objects/companies/${company.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        active_categories: [...activeCategories].join(";") || "",
        lapsed_categories: lapsedCategories.join(";") || "",
        active_vendors_purchased: [...activeVendors].join(";") || "",
        lapsed_vendors_purchased: lapsedVendors.join(";") || "",
      },
    }),
  });

  return {
    activeCat: activeCategories.size,
    activeVen: activeVendors.size,
    lapsedCat: lapsedCategories.length,
    lapsedVen: lapsedVendors.length,
  };
}

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const expected = process.env.BACKFILL_KEY;
  const cronSecret = process.env.CRON_SECRET;

  const isVercelCron = authHeader === `Bearer ${cronSecret}`;
  const isManual = expected && key === expected;

  if (!isVercelCron && !isManual) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const after = searchParams.get("after") || null;
  const totalUpdated = parseInt(searchParams.get("tu") || "0");
  const totalErrors = parseInt(searchParams.get("te") || "0");
  const batchNum = parseInt(searchParams.get("b") || "1");

  const startTime = Date.now();
  const MAX_MS = 270000;
  let cursor = after;
  let updated = 0, errors = 0, processed = 0;

  while (Date.now() - startTime < MAX_MS) {
    const searchBody = {
      filterGroups: [
        { filters: [{ propertyName: "categories_purchased", operator: "HAS_PROPERTY" }] },
        { filters: [{ propertyName: "vendors_purchased", operator: "HAS_PROPERTY" }] },
      ],
      limit: 100,
      properties: ["categories_purchased", "vendors_purchased", "name"],
    };
    if (cursor) searchBody.after = cursor;

    const page = await hubspotFetch("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify(searchBody),
    });

    const companies = page.results || [];
    if (companies.length === 0) { cursor = null; break; }

    for (const co of companies) {
      if (Date.now() - startTime > MAX_MS) break;
      processed++;

      const company = {
        id: co.id,
        name: co.properties?.name,
        categories_purchased: parseSemicolon(co.properties?.categories_purchased),
        vendors_purchased: parseSemicolon(co.properties?.vendors_purchased),
      };

      try {
        const result = await processCompany(company);
        updated++;
        console.log(`Company ${company.id} (${company.name}): active=${result.activeCat}cat/${result.activeVen}ven, lapsed=${result.lapsedCat}cat/${result.lapsedVen}ven`);
      } catch (err) {
        errors++;
        console.error(`Lapsed error company ${company.id}: ${err.message}`);
      }
      await sleep(200);
    }

    cursor = page.paging?.next?.after || null;
    if (!cursor) break;
  }

  const runUpdated = totalUpdated + updated;
  const runErrors = totalErrors + errors;

  if (!cursor) {
    return new Response(`<html><body style="font-family:system-ui;padding:2rem">
      <h1>Lapsed Check Complete!</h1>
      <p><strong>Total companies updated:</strong> ${runUpdated}</p>
      <p><strong>Total errors:</strong> ${runErrors}</p>
      <p><strong>Batches:</strong> ${batchNum}</p>
    </body></html>`, { headers: { "Content-Type": "text/html" } });
  }

  const nextUrl = `https://hubspot-company-tagger.vercel.app/api/cron/lapsed?key=${key}&after=${cursor}&tu=${runUpdated}&te=${runErrors}&b=${batchNum + 1}`;

  return new Response(`<html>
    <head><meta http-equiv="refresh" content="3;url=${nextUrl}"></head>
    <body style="font-family:system-ui;padding:2rem">
      <h1>Lapsed check in progress...</h1>
      <p><strong>Batch:</strong> ${batchNum} | <strong>This batch:</strong> ${processed} companies</p>
      <p><strong>Running total — Updated:</strong> ${runUpdated} | <strong>Errors:</strong> ${runErrors}</p>
      <p>Auto-continuing in 3 seconds...</p>
    </body>
  </html>`, { headers: { "Content-Type": "text/html" } });
}
