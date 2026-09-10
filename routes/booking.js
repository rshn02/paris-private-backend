import express from "express";
import { supabase } from "../config/supabase.js";
import { resend, FROM_EMAIL, REPLY_TO } from "../config/resend.js";
import { generateReference } from "../utils/generateReference.js";
import { generateToken } from "../utils/generateToken.js";
import { syncBookingCalendarEvents } from "../utils/calendar.js";
import { validateBookingData } from "../middleware/validation.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { calculateAdminFinalPrice, calculatePublicBookingPrice, calculateBookingPrice, isSupportedService } from "../utils/pricing.js";
import { sanitizeMarketingAttribution } from "../utils/marketingAttribution.js";

const router = express.Router();

function cleanAdminText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw new Error("An admin text field is too long.");
  return text || null;
}

function applyServerPricing(allowAdminOverrides) {
  return (req, res, next) => {
    try {
      const data = req.body || {};
      const serviceType = String(data.service_type || "").trim();
      const tripType = data.trip_type === "round_trip" ? "round_trip" : "one_way";

      if (!isSupportedService(serviceType)) {
        return res.status(400).json({ success: false, message: "Unsupported service type." });
      }
      if (tripType === "round_trip" && (!data.return_date || !data.return_time)) {
        return res.status(400).json({ success: false, message: "Return date and time are required for a round trip." });
      }

      data.service_type = serviceType;
      data.trip_type = tripType;
      const calculated = calculateBookingPrice(data);
      const pricing = allowAdminOverrides
        ? calculateAdminFinalPrice(calculated, data.admin_override || {})
        : calculatePublicBookingPrice(data);

      // The browser can display an estimate, but only this middleware sets persisted prices.
      data.outbound_night_surcharge = calculated.outboundNight;
      data.return_night_surcharge = calculated.returnNight;
      data.night_surcharge = calculated.night;
      data.original_price = calculated.base;
      data.price = pricing.finalPrice;
      data.discount_amount = pricing.discountAmount;
      data.promo_code = pricing.discountLabel;

      if (allowAdminOverrides) {
        req.adminBookingMetadata = {
          calculated_price: pricing.calculatedPrice,
          price_override: pricing.hasOverride,
          override_reason: pricing.overrideReason,
          admin_user_id: req.adminUser.id,
          internal_note: cleanAdminText(data.internal_note, 2000),
          internal_reference: cleanAdminText(data.internal_reference, 150),
          audit: {
            calculatedPrice: pricing.calculatedPrice,
            finalPrice: pricing.finalPrice,
            discountAmount: pricing.discountAmount,
            overrideReason: pricing.overrideReason
          }
        };
      } else {
        delete data.admin_override;
        delete data.internal_note;
        delete data.internal_reference;
      }

      return next();
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message || "Invalid pricing data." });
    }
  };
}

async function createBooking(req, res) {
  try {
    const data = req.body;
    const missing = validateBookingData(data);
    const marketingAttribution = sanitizeMarketingAttribution(data.marketing_attribution);

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing fields: ${missing.join(", ")}`
      });
    }

    const bookingNumber = await generateReference(supabase);
    const confirmToken = generateToken();
    const confirmUrl = `${process.env.CLIENT_URL}/confirm.html?token=${confirmToken}`;

    const bookingPayload = {
      service_type: data.service_type || null,
      outbound_night_surcharge: Number(data.outbound_night_surcharge || 0),
      return_night_surcharge: Number(data.return_night_surcharge || 0),
      night_surcharge: Number(data.night_surcharge || 0),
      discount_amount: Number(data.discount_amount || 0),
      booking_number: bookingNumber,
      confirm_token: confirmToken,
      customer_name: data.customer_name,
      customer_email: data.customer_email,
      customer_phone: data.customer_phone || null,
      pickup_location: data.pickup_location,
      destination: data.destination,
      booking_date: data.booking_date,
      booking_time: data.booking_time,
      return_date: data.return_date || null,
      return_time: data.return_time || null,
      vehicle_type: data.vehicle_type || null,
      passengers: Number(data.passengers || 1),
      children: Number(data.children || 0),
      luggage: Number(data.luggage || 0),
      baby_seats: Number(data.baby_seats || 0),
      child_seats: Number(data.child_seats || 0),
      flight_number: data.flight_number || null,
      terminal: data.terminal || null,
      notes: data.notes || null,
      price: Number(data.price),
      original_price: Number(data.original_price),
      promo_code: data.promo_code || null,
      payment_method: data.payment_method || null,
      payment_status: "unpaid",
      trip_type: data.trip_type || "one_way",
      status: "pending",
      email_confirmed: false,
      updated_by: req.adminBookingMetadata ? "admin" : "system",
      ...(process.env.STORE_MARKETING_ATTRIBUTION === "true" && marketingAttribution
        ? { marketing_attribution: marketingAttribution }
        : {}),
      ...(req.adminBookingMetadata
        ? {
            calculated_price: req.adminBookingMetadata.calculated_price,
            price_override: req.adminBookingMetadata.price_override,
            override_reason: req.adminBookingMetadata.override_reason,
            admin_user_id: req.adminBookingMetadata.admin_user_id,
            internal_note: req.adminBookingMetadata.internal_note,
            internal_reference: req.adminBookingMetadata.internal_reference
          }
        : {})
      
    };

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert(bookingPayload)
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({
        success: false,
        message: "Booking could not be saved."
      });
    }

    if (req.adminBookingMetadata) {
      const { error: auditError } = await supabase
        .from("booking_admin_audit_logs")
        .insert({
          booking_number: booking.booking_number,
          calculated_price: req.adminBookingMetadata.audit.calculatedPrice,
          previous_price: null,
          final_price: req.adminBookingMetadata.audit.finalPrice,
          discount_amount: req.adminBookingMetadata.audit.discountAmount,
          override_reason: req.adminBookingMetadata.audit.overrideReason,
          admin_user_id: req.adminBookingMetadata.admin_user_id
        });

      if (auditError) {
        await supabase.from("bookings").delete().eq("id", booking.id);
        console.error("Admin audit log insert error:", auditError);
        return res.status(500).json({
          success: false,
          message: "Admin booking audit could not be saved."
        });
      }
    }
    try {
      const calendarIds = await syncBookingCalendarEvents(booking);

      console.log("BOOKING CALENDAR IDS:", {
        bookingId: booking.id,
        bookingNumber: booking.booking_number,
        ...calendarIds
      });

      const { error: calendarUpdateError } = await supabase
        .from("bookings")
        .update({
          google_event_outbound_id: calendarIds.outboundEventId,
          google_event_return_id: calendarIds.returnEventId
        })
        .eq("id", booking.id);

      if (calendarUpdateError) {
        console.error("GOOGLE CALENDAR IDS SAVE ERROR:", calendarUpdateError);
      }
    } catch (calendarError) {
      console.error("GOOGLE CALENDAR ERROR:", {
        message: calendarError?.message,
        code: calendarError?.code,
        errors: calendarError?.errors,
        response: calendarError?.response?.data,
        stack: calendarError?.stack
      });
    }

const outboundNight = Number(data.outbound_night_surcharge || 0);
const returnNight = Number(data.return_night_surcharge || 0);
const totalNight = Number(data.night_surcharge || (outboundNight + returnNight));
const discountAmount = Number(data.discount_amount || 0);


const serviceLabels = {
  "cdg-paris": "Charles de Gaulle Airport ↔ Paris",
  "orly-paris": "Orly Airport ↔ Paris",
  "beauvais-paris": "Beauvais Airport ↔ Paris",
  "cdg-disney": "Charles de Gaulle Airport ↔ Disneyland Paris",
  "orly-disney": "Orly Airport ↔ Disneyland Paris",
  "beauvais-disney": "Beauvais Airport ↔ Disneyland Paris",
  "paris-disney": "Paris ↔ Disneyland Paris",
  "cdg-orly": "Charles de Gaulle Airport ↔ Orly Airport",
  "cdg-beauvais": "Charles de Gaulle Airport ↔ Beauvais Airport",
  "beauvais-orly": "Beauvais Airport ↔ Orly Airport",
  "paris-gares": "Paris ↔ Train Stations",
  "dispo-4h": "Hourly Chauffeur Service — 4h",
  "dispo-8h": "Hourly Chauffeur Service — 8h",
  "dispo-10h": "Hourly Chauffeur Service — 10h"
};

const serviceType =
  serviceLabels[booking.service_type] ||
  booking.service_type ||
  "Private Transfer";

const paymentMethodLabels = {
  cash: "Cash",
  card: "Credit Card",
  paypal: "PayPal",
  bank_transfer: "Bank Transfer"
};

const paymentMethod =
  paymentMethodLabels[booking.payment_method] ||
  booking.payment_method ||
  "";

const emailData = {
  ref: booking.booking_number || "",

  client_name: booking.customer_name || "",
  client_email: booking.customer_email || "",
  client_phone: booking.customer_phone || "",

  pickup: booking.pickup_location || "",
  destination: booking.destination || "",

  date: booking.booking_date || "",
  time: booking.booking_time || "",

  return_date: booking.return_date || "",
  return_time: booking.return_time || "",

  service_type: serviceType,
  trip_type: booking.trip_type === "round_trip" ? "Round Trip" : "One Way",
  vehicle: booking.vehicle_type || "",
  payment_method: paymentMethod,

  passengers: String(booking.passengers || 0),
  children: String(booking.children || 0),
  luggage: String(booking.luggage || 0),
  baby_seats: String(booking.baby_seats || 0),
  child_seats: String(booking.child_seats || 0),

  flight_number: booking.flight_number || "",
  terminal: booking.terminal || "",
  notes: booking.notes || "",

  price_base: booking.original_price ? `${booking.original_price}€` : "0€",
  price_outbound_night: `${outboundNight}€`,
  price_return_night: `${returnNight}€`,
  price_night: `${totalNight}€`,
  price_discount: `${discountAmount}€`,
  price_total: booking.price ? `${booking.price}€` : "0€",

  confirm_url: confirmUrl,
  manage_url: `${process.env.CLIENT_URL}/manage-booking.html`
};



// =========================
// EMAIL CLIENT + ADMIN AVEC TEMPLATE RESEND
// =========================

const templateAlias = process.env.RESEND_TEMPLATE_PENDING;

if (!templateAlias) {
  throw new Error("RESEND_TEMPLATE_PENDING is missing in .env");
}

const clientEmail = await resend.emails.send({
  from: FROM_EMAIL,
  to: booking.customer_email,
  reply_to: REPLY_TO,
  subject: `Booking Confirmation Required • ${emailData.ref}`,
  template: {
    id: templateAlias,
    variables: emailData
  }
});

console.log("CLIENT EMAIL :", JSON.stringify(clientEmail, null, 2));

const adminEmail = await resend.emails.send({
  from: FROM_EMAIL,
  to: process.env.ADMIN_EMAIL,
  reply_to: REPLY_TO,
  subject: `New Booking Pending • ${emailData.ref}`,
  template: {
    id: templateAlias,
    variables: emailData
  }
});



console.log("ADMIN EMAIL :", JSON.stringify(adminEmail, null, 2));
    await supabase
      .from("bookings")
      .update({ last_email_sent: new Date().toISOString() })
      .eq("id", booking.id);

    return res.json({
      success: true,
      booking_number: booking.booking_number
    });

  } catch (error) {
    console.error("Booking route error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error."
    });
  }
}

router.post("/admin", requireAdmin, applyServerPricing(true), createBooking);
router.post("/", applyServerPricing(false), createBooking);

export default router;
