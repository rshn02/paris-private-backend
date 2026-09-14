import { createHash } from "node:crypto";
import { isValidEmail } from "../middleware/emailValidation.js";
import { resend } from "../config/resend.js";

// A short-lived operation key is supplied by the public-route duplicate guard.
// Resend then deduplicates each recipient separately, including partial retries.
export async function sendEmail(type, payload, operationKey) {
  if (typeof payload.to !== "string" || !isValidEmail(payload.to.trim())) {
    console.error("EMAIL", { type, status: "error", reason: "invalid_recipient" });
    throw new Error("A valid email recipient is required.");
  }
  payload = { ...payload, to: payload.to.trim() };
  const options = operationKey ? {
    idempotencyKey: createHash("sha256").update(`${operationKey}:${type}`).digest("hex")
  } : {};
  let result;
  try {
    result = await resend.emails.send(payload, options);
  } catch {
    console.error("EMAIL", { type, status: "error", reason: "transport_error" });
    throw new Error("Email delivery request failed. Please try again shortly.");
  }
  if (result?.error || !result?.data?.id) {
    // Do not log provider messages: they can contain addresses or submitted data.
    console.error("EMAIL", { type, status: "error", reason: result?.error ? "provider_error" : "missing_id" });
    throw new Error("Email delivery request failed. Please try again shortly.");
  }
  console.log("EMAIL", { type, status: "accepted", id: result.data.id });
  return result;
}
