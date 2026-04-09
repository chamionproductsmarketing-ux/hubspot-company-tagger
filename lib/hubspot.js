// lib/hubspot.js
// HubSpot API helpers and core tagging logic

import { PRODUCT_GROUP_MAP, VALID_SUPPLIER_IDS } from "./mappings.js";

const HUBSPOT_BASE = "https://api.hubapi.com";

// ---------------------------------------------------------------------------
// Low-level HTTP helpers
// ---------------------------------------------------------------------------

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function hubspotGet(path) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function hubspotPost(path, body) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function hubspotPatch(path, body) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Core: tag a company from a single deal's line items
// ---------------------------------------------------------------------------

export async function tagCompanyFromDeal(dealId) {
  // 1. Get line item associations
  const assocResponse = await hubspotGet(
    `/crm/v3/objects/deals/${dealId}/associations/line_items`
  );
  const lineItemIds = (assocResponse.results || []).map((r) => r.id);

  if (lineItemIds.length === 0) {
    return { dealId, skipped: true, reason: "no line items" };
  }

  // 2. Batch-read line items for supplier_id and product_group_id
  const batchRes = await hubspotPost("/crm/v3/objects/line_items/batch/read", {
    properties: ["supplier_id", "product_group_id"],
    inputs: lineItemIds.map((id) => ({ id })),
  });

  const newCategories = new Set();
  const newSuppliers = new Set();

  for (const item of batchRes.results || []) {
    const pgId = String(item.properties?.product_group_id || "").trim();
    const sId = String(item.properties?.supplier_id || "").trim();

    // Map product_group_id → categories_purchased label
    if (pgId && PRODUCT_GROUP_MAP[pgId]) {
      newCategories.add(PRODUCT_GROUP_MAP[pgId]);
    } else if (pgId) {
      console.warn(`Deal ${dealId}: unmapped product_group_id "${pgId}"`);
    }

    // For vendors_purchased, internal value = supplier_id string
    if (sId && VALID_SUPPLIER_IDS.has(sId)) {
      newSuppliers.add(sId);
    } else if (sId) {
      console.warn(`Deal ${dealId}: unknown supplier_id "${sId}"`);
    }
  }

  if (newCategories.size === 0 && newSuppliers.size === 0) {
    return { dealId, skipped: true, reason: "no mappable values on line items" };
  }

  // 3. Get associated company
  const companyAssoc = await hubspotGet(
    `/crm/v3/objects/deals/${dealId}/associations/companies`
  );
  const companyId = companyAssoc.results?.[0]?.id;

  if (!companyId) {
    return { dealId, skipped: true, reason: "no associated company" };
  }

  // 4. Read current company tag values
  const company = await hubspotGet(
    `/crm/v3/objects/companies/${companyId}?properties=categories_purchased,vendors_purchased`
  );

  const existingCategories = parseSemicolonField(
    company.properties?.categories_purchased
  );
  const existingSuppliers = parseSemicolonField(
    company.properties?.vendors_purchased
  );

  // 5. Merge — only update if there are genuinely new values
  const mergedCategories = mergeUnique(existingCategories, newCategories);
  const mergedSuppliers = mergeUnique(existingSuppliers, newSuppliers);

  const categoriesAdded = mergedCategories.length - existingCategories.length;
  const suppliersAdded = mergedSuppliers.length - existingSuppliers.length;

  if (categoriesAdded === 0 && suppliersAdded === 0) {
    return {
      dealId,
      companyId,
      categoriesAdded: 0,
      suppliersAdded: 0,
      note: "all values already present",
    };
  }

  // 6. Write back to company
  const updates = {};
  if (categoriesAdded > 0) {
    updates.categories_purchased = mergedCategories.join(";");
  }
  if (suppliersAdded > 0) {
    updates.vendors_purchased = mergedSuppliers.join(";");
  }

  await hubspotPatch(`/crm/v3/objects/companies/${companyId}`, {
    properties: updates,
  });

  console.log(
    `Deal ${dealId} → Company ${companyId}: +${categoriesAdded} categories, +${suppliersAdded} suppliers`
  );

  return { dealId, companyId, categoriesAdded, suppliersAdded };
}

// ---------------------------------------------------------------------------
// Backfill: iterate all deals and tag
// ---------------------------------------------------------------------------

export async function backfillAllDeals(onProgress) {
  let after = undefined;
  let scanned = 0;
  let tagged = 0;
  let errors = 0;

  while (true) {
    const qs = after ? `?limit=100&after=${after}` : "?limit=100";
    const page = await hubspotGet(`/crm/v3/objects/deals${qs}`);

    for (const deal of page.results || []) {
      scanned++;
      try {
        const result = await tagCompanyFromDeal(deal.id);
        if (result && !result.skipped) tagged++;
        if (onProgress) onProgress({ scanned, tagged, errors });
      } catch (err) {
        errors++;
        console.error(`Error on deal ${deal.id}: ${err.message}`);
      }
    }

    if (page.paging?.next?.after) {
      after = page.paging.next.after;
    } else {
      break;
    }
  }

  return { scanned, tagged, errors };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (v3)
// ---------------------------------------------------------------------------

export async function verifyWebhookSignature(
  rawBody,
  signature,
  requestUri,
  requestMethod,
  timestamp
) {
  const secret = process.env.HUBSPOT_WEBHOOK_SECRET;
  if (!secret) return true; // skip if not configured

  const crypto = await import("crypto");

  // HubSpot v3 signature: SHA-256 of (secret + method + uri + body + timestamp)
  const payload = `${secret}${requestMethod}${requestUri}${rawBody}${timestamp}`;
  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  return hash === signature;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseSemicolonField(value) {
  if (!value) return [];
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergeUnique(existing, incoming) {
  const set = new Set(existing);
  for (const v of incoming) set.add(v);
  return [...set];
}
