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

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});
