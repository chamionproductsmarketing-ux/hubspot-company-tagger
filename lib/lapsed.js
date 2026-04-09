import { getAccessToken } from "./token.js";
import { PRODUCT_GROUP_MAP, VALID_SUPPLIER_IDS } from "./mappings.js";
import { INVOICE_PIPELINE } from "./hubspot.js";

const HUBSPOT_BASE = "https://api.hubapi.com";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function hubspotFetch(url, options = {}, retries = 3) {
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
    if (res.status === 429) {
      await sleep((i + 1) * 5000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${options.method || "GET"} ${url} → ${res.status}: ${body}`);
    }
    return res.json();
  }
  throw new Error(`Rate limited after ${retries} retries: ${url}`);
}

async function getTaggedCompanies() {
  const companies = [];
  let after = null;

  while (true) {
    const searchBody = {
      filterGroups: [
        { filters: [{ propertyName: "categories_purchased", operator: "HAS_PROPERTY" }] },
        { filters: [{ propertyName: "vendors_purchased", operator: "HAS_PROPERTY" }] },
      ],
      limit: 100,
      properties: ["categories_purchased", "vendors_purchased", "name"],
    };
    if (after) searchBody.after = after;

    const page = await hubspotFetch("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify(searchBody),
    });

    for (const co of page.results || []) {
      companies.push({
        id: co.id,
        name: co.properties?.name,
        categories_purchased: parseSemicolon(co.properties?.categories_purchased),
        vendors_purchased: parseSemicolon(co.properties?.vendors_purchased),
      });
    }

    after = page.paging?.next?.after || null;
    if (!after) break;
    await sleep(200);
  }

  return companies;
}

async function getActiveTagsForCompany(companyId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const assocRes = await hubspotFetch(
    `/crm/v3/objects/companies/${companyId}/associations/deals`
  );
  const dealIds = (assocRes.results || []).map(r => r.id);

  const activeCategories = new Set();
  const activeVendors = new Set();

  if (dealIds.length === 0) return { activeCategories, activeVendors };

  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    const dealsRes = await hubspotFetch("/crm/v3/objects/deals/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: ["pipeline", "createdate"],
        inputs: batch.map(id => ({ id })),
      }),
    });

    const recentInvoiceDeals = (dealsRes.results || []).filter(d =>
      d.properties?.pipeline === INVOICE_PIPELINE &&
      d.properties?.createdate >= thirtyDaysAgo
    );

    for (const deal of recentInvoiceDeals) {
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

  return { activeCategories, activeVendors };
}

export async function runLapsedCheck() {
  const companies = await getTaggedCompanies();
  let processed = 0, updated = 0, errors = 0;

  for (const company of companies) {
    processed++;
    try {
      const { activeCategories, activeVendors } = await getActiveTagsForCompany(company.id);

      const lapsedCategories = company.categories_purchased.filter(c => !activeCategories.has(c));
      const lapsedVendors = company.vendors_purchased.filter(v => !activeVendors.has(v));

      const updates = {
        active_categories: [...activeCategories].join(";") || "",
        lapsed_categories: lapsedCategories.join(";") || "",
        active_vendors_purchased: [...activeVendors].join(";") || "",
        lapsed_vendors_purchased: lapsedVendors.join(";") || "",
      };

      await hubspotFetch(`/crm/v3/objects/companies/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: updates }),
      });

      updated++;
      console.log(
        `Company ${company.id} (${company.name}): ` +
        `active=${activeCategories.size} cat/${activeVendors.size} ven, ` +
        `lapsed=${lapsedCategories.length} cat/${lapsedVendors.length} ven`
      );
    } catch (err) {
      errors++;
      console.error(`Lapsed check error company ${company.id}: ${err.message}`);
    }

    await sleep(200);
  }

  return { total: companies.length, processed, updated, errors };
}

function parseSemicolon(value) {
  if (!value) return [];
  return value.split(";").map(s => s.trim()).filter(Boolean);
}
