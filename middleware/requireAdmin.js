import { supabase } from "../config/supabase.js";

function configuredAdminIds() {
  return new Set(
    String(process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

export async function requireAdmin(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ success: false, message: "Admin authentication is required." });
  }

  let result;
  try {
    result = await supabase.auth.getUser(match[1]);
  } catch {
    return res.status(503).json({ success: false, message: "Admin authentication is temporarily unavailable." });
  }
  const { data, error } = result || {};
  if (error || !data?.user) {
    return res.status(401).json({ success: false, message: "Invalid or expired admin session." });
  }

  const adminIds = configuredAdminIds();
  if (adminIds.size === 0) {
    console.error("ADMIN_USER_IDS is not configured.");
    return res.status(503).json({ success: false, message: "Admin access is not configured." });
  }
  if (!adminIds.has(data.user.id)) {
    return res.status(403).json({ success: false, message: "This account is not authorized for admin access." });
  }

  req.adminUser = data.user;
  return next();
}
