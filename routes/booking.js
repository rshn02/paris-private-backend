import express from "express";
import { supabase } from "../config/supabase.js";
import { resend, FROM_EMAIL, REPLY_TO } from "../config/resend.js";
import { generateReference } from "../utils/generateReference.js";
import { generateToken } from "../utils/generateToken.js";
import { validateBookingData } from "../middleware/validation.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const data = req.body;
    const missing = validateBookingData(data);

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing fields: ${missing.join(", ")}`
      });
    }

    const bookingNumber = generateReference();
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
      price: data.price || null,
      original_price: data.original_price || data.price || null,
      promo_code: data.promo_code || null,
      payment_method: data.payment_method || null,
      payment_status: "unpaid",
      trip_type: data.trip_type || "one_way",
      status: "pending",
      email_confirmed: false,
      updated_by: "system"
      
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

console.log("CLIENT EMAIL :", clientEmail);

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



console.log("ADMIN EMAIL :", adminEmail);
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
});

export default router;