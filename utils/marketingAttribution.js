const CAMPAIGN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid"
];

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanCampaignText(value) {
  const cleaned = cleanText(value, 200);
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(cleaned)) return "";
  if (/(?:\+?\d[\s().-]*){8,}/.test(cleaned)) return "";
  return cleaned;
}

function cleanPath(value) {
  const path = cleanText(value, 500).split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : "";
}

function cleanReferrer(value) {
  const referrer = cleanText(value, 1000);
  if (!referrer) return "";

  try {
    const url = new URL(referrer);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return "";
  }
}

function cleanTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function sanitizeTouch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const touch = {
    marketing_source: cleanText(value.marketing_source, 100)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_"),
    landing_page: cleanPath(value.landing_page),
    initial_referrer: cleanReferrer(value.initial_referrer),
    captured_at: cleanTimestamp(value.captured_at)
  };

  CAMPAIGN_KEYS.forEach((key) => {
    const campaignValue = cleanCampaignText(value[key]);
    if (campaignValue) touch[key] = campaignValue;
  });

  return Object.fromEntries(
    Object.entries(touch).filter(([, fieldValue]) => fieldValue !== "")
  );
}

function cleanEpoch(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

export function sanitizeMarketingAttribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const firstTouch = sanitizeTouch(value.first_touch);
  const lastTouch = sanitizeTouch(value.last_touch);
  if (!firstTouch || !lastTouch) return null;

  return {
    version: 1,
    first_touch: firstTouch,
    last_touch: lastTouch,
    created_at: cleanEpoch(value.created_at),
    updated_at: cleanEpoch(value.updated_at),
    expires_at: cleanEpoch(value.expires_at)
  };
}

export function cleanMarketingService(value) {
  const service = cleanText(value, 100).toLowerCase();
  return /^[a-z0-9_-]+$/.test(service) ? service : "";
}

export function formatInternalMarketingAttribution(attribution, service) {
  if (!attribution && !service) return "";

  const firstTouch = attribution?.first_touch || {};
  const lastTouch = attribution?.last_touch || firstTouch;
  const lines = [
    "Marketing attribution",
    `Source: ${lastTouch.marketing_source || "unknown"}`,
    `Landing page: ${firstTouch.landing_page || "unknown"}`,
    `Campaign: ${lastTouch.utm_campaign || "none"}`,
    `Service: ${cleanMarketingService(service) || "none"}`
  ];

  return lines.join("\n");
}
