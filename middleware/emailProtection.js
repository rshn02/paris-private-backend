import { createHash, randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";

export function emailRateLimits() {
  const make = (windowMs, limit) => rateLimit({
    windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again shortly." }
  });
  return [make(60_000, 6), make(15 * 60_000, 30)];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

// Each client action has its own UUID. Identical data is never an operation ID.
// Successful responses and resumable email work are retained for at most 24h in
// this process (matching Resend's idempotency window); no 5xx response is cached.
export function preventDuplicateEmails() {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of entries) if (!entry.pending && entry.expires <= now) entries.delete(key);
    const suppliedKey = req.get("Idempotency-Key");
    if (suppliedKey && !/^[a-z0-9-]{16,100}$/i.test(suppliedKey)) {
      return res.status(400).json({ success: false, message: "Invalid operation identifier." });
    }
    // A confirmation token already identifies one particular confirmation.
    const operationId = suppliedKey || (typeof req.body?.token === "string"
      ? createHash("sha256").update(req.body.token).digest("hex") : randomUUID());
    const key = createHash("sha256").update(`${req.originalUrl}:${operationId}`).digest("hex");
    const { marketing_attribution, ...body } = req.body || {};
    const fingerprint = createHash("sha256").update(JSON.stringify(stable(body))).digest("hex");
    const existing = entries.get(key);
    if (existing && existing.fingerprint !== fingerprint) {
      return res.status(409).json({ success: false, message: "Use a new operation identifier for changed details." });
    }
    if (existing?.response) return res.status(existing.status).json(existing.response);
    if (existing?.pending) {
      res.set("Retry-After", "2");
      return res.status(409).json({ success: false, message: "This request is already being processed. Please wait." });
    }
    if (!existing && entries.size >= 2000) {
      return res.status(429).json({ success: false, message: "Too many requests. Please try again shortly." });
    }
    const entry = existing || { operationKey: randomUUID(), fingerprint, expires: now + 24 * 60 * 60_000,
      contactDate: new Date().toLocaleString("fr-FR") };
    entry.pending = true;
    entries.set(key, entry);
    req.emailOperationKey = entry.operationKey;
    req.emailContactDate = entry.contactDate;
    // Save the email phase AFTER database mutations, so retries neither create
    // another booking nor get stopped by an already-confirmed/cancelled state.
    req.runEmailOperation = async finish => {
      entry.resume = finish;
      return finish(res);
    };
    const json = res.json;
    res.json = function(response) {
      entry.pending = false;
      if (res.statusCode >= 200 && res.statusCode < 300 && response?.success) {
        entry.response = response;
        entry.status = res.statusCode;
        entry.resume = null;
      }
      return json.call(this, response);
    };
    // A disconnected browser does not mean the server operation has stopped.
    if (entry.resume) {
      Promise.resolve().then(() => entry.resume(res)).catch(() => {
        res.status(500).json({ success: false, message: "Email delivery request failed. Please try again shortly." });
      });
      return;
    }
    next();
  };
}
