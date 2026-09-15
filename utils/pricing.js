export const NIGHT_SURCHARGE = 10;

// This mirrors the public calculator. The server remains the authoritative source.
const PRICING = {
  "cdg-paris": { 1: 80, 2: 80, 3: 90, 4: 100, 5: 110, 6: 110, 7: 120, 8: 130, 9: 210, 10: 220, 11: 220, 12: 220, 13: 240, 14: 240, 15: 250, 16: 260 },
  "orly-paris": { 1: 75, 2: 75, 3: 80, 4: 100, 5: 100, 6: 100, 7: 110, 8: 120, 9: 180, 10: 200, 11: 200, 12: 200, 13: 220, 14: 220, 15: 240, 16: 240 },
  "orly-disney": { 1: 80, 2: 80, 3: 85, 4: 90, 5: 95, 6: 100, 7: 105, 8: 110, 9: 185, 10: 190, 11: 195, 12: 200, 13: 205, 14: 210, 15: 215, 16: 220 },
  "cdg-disney": { 1: 70, 2: 70, 3: 75, 4: 80, 5: 85, 6: 90, 7: 95, 8: 100, 9: 165, 10: 170, 11: 175, 12: 180, 13: 185, 14: 190, 15: 195, 16: 200 },
  "beauvais-disney": { 1: 160, 2: 160, 3: 160, 4: 160, 5: 165, 6: 170, 7: 175, 8: 180, 9: 315, 10: 325, 11: 330, 12: 340, 13: 345, 14: 350, 15: 355, 16: 360 },
  "paris-disney": { 1: 90, 2: 90, 3: 95, 4: 100, 5: 105, 6: 110, 7: 115, 8: 120, 9: 200, 10: 210, 11: 215, 12: 220, 13: 225, 14: 230, 15: 235, 16: 240 },
  "beauvais-paris": { 1: 160, 2: 160, 3: 160, 4: 180, 5: 180, 6: 180, 7: 180, 8: 180 },
  "paris-gares": { 1: 80, 2: 80, 3: 80, 4: 90, 5: 90, 6: 90, 7: 90, 8: 90 },
  "cdg-orly": { 1: 100, 2: 100, 3: 100, 4: 120, 5: 120, 6: 120, 7: 120, 8: 120 },
  "cdg-beauvais": { 1: 150, 2: 150, 3: 150, 4: 160, 5: 160, 6: 160, 7: 160, 8: 160 },
  "beauvais-orly": { 1: 180, 2: 180, 3: 180, 4: 210, 5: 210, 6: 210, 7: 210, 8: 210 },
  "dispo-4h": { default: 280 },
  "dispo-8h": { default: 520 },
  "dispo-10h": { default: 600 }
};

const SERVICE_MAX = {
  "cdg-paris": 16, "orly-paris": 16, "orly-disney": 16, "cdg-disney": 16,
  "beauvais-disney": 16, "paris-disney": 16,
  "beauvais-paris": 8, "paris-gares": 8, "cdg-orly": 8, "cdg-beauvais": 8, "beauvais-orly": 8
};

export function isSupportedService(serviceType) {
  return Object.hasOwn(PRICING, serviceType);
}

export function isNightTime(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) return false;
  const hour = Number(String(time).slice(0, 2));
  return hour >= 22 || hour < 6;
}

// Match the existing form: 1–8 adults, 0–8 children, the 5+ bags
// option encoded as 5, and seat counters capped at 10.
export function normalizeBookingNumbers(data) {
  const limits = { passengers: [1, 8, 1], children: [0, 8, 0], luggage: [0, 5, 0],
    baby_seats: [0, 10, 0], child_seats: [0, 10, 0] };
  const normalized = {};
  for (const [field, [min, max, fallback]] of Object.entries(limits)) {
    const raw = data[field] === undefined ? fallback : data[field];
    const value = typeof raw === "number" ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${field} must be an integer between ${min} and ${max}.`);
    }
    normalized[field] = value;
  }
  return normalized;
}

export function calculateBookingPrice(data) {
  const serviceType = data.service_type;
  const grid = isSupportedService(serviceType) ? PRICING[serviceType] : null;

  if (!grid) {
    throw new Error("Unsupported service type.");
  }

  const counts = normalizeBookingNumbers(data);
  const people = counts.passengers + counts.children;
  // Preserve the existing public calculator's service cap for valid integers.
  const base = grid.default ?? grid[Math.min(people, SERVICE_MAX[serviceType])];
  if (!Number.isFinite(base) || base <= 0) throw new Error("No fare is available for this booking.");
  const isRoundTrip = data.trip_type === "round_trip";
  const outboundNight = isNightTime(data.booking_time) ? NIGHT_SURCHARGE : 0;
  const returnNight = isRoundTrip && isNightTime(data.return_time) ? NIGHT_SURCHARGE : 0;
  const night = outboundNight + returnNight;
  const total = (isRoundTrip ? base * 2 : base) + night;

  return { base, outboundNight, returnNight, night, total };
}

export function calculateAdminFinalPrice(calculatedPrice, override = {}) {
  const customPrice = override.custom_price === null || override.custom_price === undefined
    ? null
    : Number(override.custom_price);

  if (customPrice !== null && (!Number.isFinite(customPrice) || customPrice <= 0)) {
    throw new Error("Custom price must be a positive number.");
  }

  const discountValue = override.discount?.amount === undefined ? 0 : Number(override.discount.amount);
  const discountType = override.discount?.type || "fixed";

  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error("Discount must be a positive number.");
  }
  if (!["fixed", "percent"].includes(discountType)) {
    throw new Error("Unsupported discount type.");
  }
  if (discountType === "percent" && discountValue > 100) {
    throw new Error("Percentage discount cannot exceed 100%.");
  }

  const priceBeforeDiscount = customPrice ?? calculatedPrice.total;
  const discountAmount = discountType === "percent"
    ? Math.round(priceBeforeDiscount * discountValue / 100)
    : Math.min(discountValue, priceBeforeDiscount);
  const finalPrice = Math.max(0, priceBeforeDiscount - discountAmount);

  return {
    ...calculatedPrice,
    calculatedPrice: calculatedPrice.total,
    finalPrice,
    discountAmount,
    hasOverride: customPrice !== null || discountAmount > 0,
    customPrice,
    discountLabel: String(override.discount?.label || "").trim() || null,
    overrideReason: String(override.reason || "").trim() || null
  };
}

// Deliberately accepts only trip data through calculateBookingPrice; any pricing
// fields included by a public client are ignored.
export function calculatePublicBookingPrice(data) {
  return calculateAdminFinalPrice(calculateBookingPrice(data));
}
