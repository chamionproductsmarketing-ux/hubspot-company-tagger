import { PRODUCT_GROUP_MAP, VALID_SUPPLIER_IDS } from "./mappings.js";
import { getAccessToken } from "./token.js";

const HUBSPOT_BASE = "https://api.hubapi.com";
export const INVOICE_PIPELINE = "820181168";

async function headers() {
  return {
    Authorization: `Bearer ${await getAccessToken()}`,
    "Content-Type": "application/json",
  };
}

async function hubspotGet(path) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, { headers: await headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function hubspotPost(path, body) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: "POST",
    headers: await headers(),
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
    headers: await headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function tagCompanyFromDeal(dealId, skipPipelineCheck = false) {
  // Optionally verify deal is in invoice pipeline
  if (!skipPipelineCheck) {
    const deal = await hubspotGet(
      `/crm/v3/objects/deals/${dealId}?properties=pipeline`
    );
    if (deal.properties?.pipeline !== INVOICE_PIPELINE) {
      return { dealId, skipped: true, reason: "not invoice pipeline" };
    }
  }

  const assocResponse = await hubspotGet(
    `/crm/v3/objects/deals/${dealId}/associations/line_items`
  );
  const lineItemIds = (assocResponse.results || []).map((r) => r.id);

  if (lineItemIds.length === 0) {
    return { dealId, skipped: true, reason: "no line items" };
  }

  const batchRes = await hubspotPost("/crm/v3/objects/line_items/batch/read", {
    properties: ["supplier_id", "product_group_id"],
    inputs: lineItemIds.map((id) => ({ id })),
  });

  const newCategories = new Set();
  const newSuppliers = new Set();

  for (const item of batchRes.results || []) {
    const pgId = String(item.properties?.product_group_id || "").trim();
    const sId = String(item.properties?.supplier_id || "").trim();

    if (pgId && PRODUCT_GROUP_MAP[pgId]) {
      newCategories.add(PRODUCT_GROUP_MAP[pgId]);
    } else if (pgId) {
      console.warn(`Deal ${dealId}: unmapped product_group_id "${pgId}"`);
    }

    if (sId && VALID_SUPPLIER_IDS.has(sId)) {
      newSuppliers.add(sId);
    } else if (sId) {
      console.warn(`Deal ${dealId}: unknown supplier_id "${sId}"`);
    }
  }

  if (newCategories.size === 0 && newSuppliers.size === 0) {
    return { dealId, skipped: true, reason: "no mappable values on line items" };
  }

  const companyAssoc = await hubspotGet(
    `/crm/v3/objects/deals/${dealId}/associations/companies`
  );
  const companyId = companyAssoc.results?.[0]?.id;

  if (!companyId) {
    return { dealId, skipped: true, reason: "no associated company" };
  }

  const company = await hubspotGet(
    `/crm/v3/objects/companies/${companyId}?properties=categories_purchased,vendors_purchased`
  );

  const existingCategories = parseSemicolonField(company.properties?.categories_purchased);
  const existingSuppliers = parseSemicolonField(company.properties?.vendors_purchased);

  const mergedCategories = mergeUnique(existingCategories, newCategories);
  const mergedSuppliers = mergeUnique(existingSuppliers, newSuppliers);

  const categoriesAdded = mergedCategories.length - existingCategories.length;
  const suppliersAdded = mergedSuppliers.length - existingSuppliers.length;

  if (categoriesAdded === 0 && suppliersAdded === 0) {
    return { dealId, companyId, categoriesAdded: 0, suppliersAdded: 0, note: "all values already present" };
  }

  const updates = {};
  if (categoriesAdded > 0) updates.categories_purchased = mergedCategories.join(";");
  if (suppliersAdded > 0) updates.vendors_purchased = mergedSuppliers.join(";");

  await hubspotPatch(`/crm/v3/objects/companies/${companyId}`, { properties: updates });

  console.log(`Deal ${dealId} → Company ${companyId}: +${categoriesAdded} categories, +${suppliersAdded} suppliers`);
  return { dealId, companyId, categoriesAdded, suppliersAdded };
}

function parseSemicolonField(value) {
  if (!value) return [];
  return value.split(";").map((s) => s.trim()).filter(Boolean);
}

function mergeUnique(existing, incoming) {
  const set = new Set(existing);
  for (const v of incoming) set.add(v);
  return [...set];
}
