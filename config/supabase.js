import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

function normalizeEnvValue(value) {
  if (!value) {
    return value;
  }

  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split(".");

    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );

    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const supabaseUrl = normalizeEnvValue(process.env.SUPABASE_URL);
const supabaseServiceKey = normalizeEnvValue(
  process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL environment variable.");
}

if (!supabaseServiceKey) {
  throw new Error(
    "Missing SUPABASE_SECRET_KEY, SUPABASE_SERVICE_KEY, or SUPABASE_SERVICE_ROLE_KEY environment variable."
  );
}

console.log("SUPABASE CONFIG:", {
  url: supabaseUrl,
  keyPrefix: supabaseServiceKey.slice(0, 10),
  keyLength: supabaseServiceKey.length,
  keySource: process.env.SUPABASE_SECRET_KEY
    ? "SUPABASE_SECRET_KEY"
    : process.env.SUPABASE_SERVICE_KEY
      ? "SUPABASE_SERVICE_KEY"
      : "SUPABASE_SERVICE_ROLE_KEY"
});

if (supabaseServiceKey.startsWith("eyJ")) {
  const jwtPayload = decodeJwtPayload(supabaseServiceKey);

  console.log("SUPABASE LEGACY KEY PAYLOAD:", {
    role: jwtPayload?.role || null,
    iss: jwtPayload?.iss || null,
    ref: jwtPayload?.ref || null
  });
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});
