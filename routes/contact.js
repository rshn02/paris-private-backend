import express from "express";
import { resend, FROM_EMAIL, REPLY_TO } from "../config/resend.js";
import {
  cleanMarketingService,
  formatInternalMarketingAttribution,
  sanitizeMarketingAttribution
} from "../utils/marketingAttribution.js";

const router = express.Router();

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidContactEmail(value) {
    if (typeof value !== "string" || value.length > 254) return false;
    const parts = value.split("@");
    return parts.length === 2
        && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(parts[0])
        && parts[0].length <= 64
        && parts[1].includes(".")
        && parts[1].split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function isValidContactPhone(value) {
    if (typeof value !== "string" || !/^\+?[0-9 ()-]+$/.test(value)) return false;
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
}

function subjectLabel(value) {
  const labels = {
    booking: "Booking",
    quote: "Quote request",
    information: "Information request",
    business: "Business partnership",
    other: "Other"
  };

  return labels[value] || value || "Contact request";
}

router.post("/", async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: "Invalid contact data.", message: "Invalid contact data." });
    }

    const { website, service, marketing_attribution } = body;

    // Preserve the existing honeypot protection without sending emails.
    if (website) {
      return res.json({ success: true });
    }

    const name = cleanText(body.name);
    const email = cleanText(body.email);
    const phone = cleanText(body.phone);
    const subject = cleanText(body.subject);
    const message = cleanText(body.message);
    const validationError = !name ? "Your full name is required."
      : !isValidContactEmail(email) ? "A valid email address is required."
      : !isValidContactPhone(phone) ? "A valid phone number is required."
      : !subject ? "A subject is required."
      : !message ? "A message is required."
      : "";

    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
        message: validationError
      });
    }

    const data = {
      name,
      email,
      phone,
      subject: subjectLabel(subject),
      message,
      contact_date: new Date().toLocaleString("fr-FR"),
      reply_to: email
    };

    const sanitizedAttribution = sanitizeMarketingAttribution(marketing_attribution);
    const sanitizedService = cleanMarketingService(service);
    const attributionSummary = formatInternalMarketingAttribution(
      sanitizedAttribution,
      sanitizedService
    );
    const adminData = attributionSummary
      ? { ...data, message: `${data.message}\n\n---\n${attributionSummary}` }
      : data;

    const templateId = process.env.RESEND_TEMPLATE_CONTACT;

if (!templateId) {
  throw new Error("RESEND_TEMPLATE_CONTACT is missing in .env");
}

const adminEmail = await resend.emails.send({
  from: FROM_EMAIL,
  to: process.env.ADMIN_EMAIL,
  reply_to: email,
  subject: `New Contact Request • ${data.subject}`,
  template: {
    id: templateId,
    variables: adminData
  }
});

if (adminEmail?.error) {
  console.error("CONTACT ADMIN EMAIL ERROR:", adminEmail.error);
  throw new Error("Contact message could not be delivered.");
}

console.log("CONTACT ADMIN EMAIL:", adminEmail);

const clientEmail = await resend.emails.send({
  from: FROM_EMAIL,
  to: email,
  reply_to: REPLY_TO,
  subject: "We received your message",
  template: {
    id: templateId,
    variables: data
  }
});

if (clientEmail?.error) {
  console.error("CONTACT CLIENT EMAIL ERROR:", clientEmail.error);
  throw new Error("Contact acknowledgement could not be delivered.");
}

console.log("CONTACT CLIENT EMAIL:", clientEmail);

    console.log("CONTACT CLIENT EMAIL:", clientEmail);

    return res.json({
      success: true,
      message: "Message sent successfully."
    });

  } catch (error) {
    console.error("Contact route error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error."
    });
  }
});

export default router;
