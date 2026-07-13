import express from "express";
import { resend, FROM_EMAIL, REPLY_TO } from "../config/resend.js";

const router = express.Router();

function required(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
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
    const { name, email, phone, subject, message, website } = req.body;

    if (website) {
      return res.json({ success: true });
    }

    if (!required(name) || !required(email) || !required(phone) || !required(subject) || !required(message)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields."
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
    variables: data
  }
});

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