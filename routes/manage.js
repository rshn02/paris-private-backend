import express from "express";
import { supabase } from "../config/supabase.js";
import { resend, FROM_EMAIL, REPLY_TO } from "../config/resend.js";

const router = express.Router();

const NIGHT_SURCHARGE = 10;

const PRICING = {
  "cdg-paris": { 1:80,2:80,3:90,4:100,5:110,6:110,7:120,8:130,9:210,10:220,11:220,12:220,13:240,14:240,15:250,16:260 },
  "orly-paris": { 1:75,2:75,3:80,4:100,5:100,6:100,7:110,8:120,9:180,10:200,11:200,12:200,13:220,14:220,15:240,16:240 },
  "orly-disney": { 1:80,2:80,3:85,4:90,5:95,6:100,7:105,8:110,9:185,10:190,11:195,12:200,13:205,14:210,15:215,16:220 },
  "cdg-disney": { 1:70,2:70,3:75,4:80,5:85,6:90,7:95,8:100,9:165,10:170,11:175,12:180,13:185,14:190,15:195,16:200 },
  "beauvais-disney": { 1:160,2:160,3:160,4:160,5:165,6:170,7:175,8:180,9:315,10:325,11:330,12:340,13:345,14:350,15:355,16:360 },
  "paris-disney": { 1:90,2:90,3:95,4:100,5:105,6:110,7:115,8:120,9:200,10:210,11:215,12:220,13:225,14:230,15:235,16:240 },
  "beauvais-paris": { 1:160,2:160,3:160,4:180,5:180,6:180,7:180,8:180 },
  "paris-gares": { 1:80,2:80,3:80,4:90,5:90,6:90,7:90,8:90 },
  "cdg-orly": { 1:100,2:100,3:100,4:120,5:120,6:120,7:120,8:120 },
  "cdg-beauvais": { 1:150,2:150,3:150,4:160,5:160,6:160,7:160,8:160 },
  "beauvais-orly": { 1:180,2:180,3:180,4:210,5:210,6:210,7:210,8:210 },
  "dispo-4h": { default: 280 },
  "dispo-8h": { default: 520 },
  "dispo-10h": { default: 600 }
};

const SERVICE_MAX = {
  "cdg-paris":16, "orly-paris":16, "orly-disney":16, "cdg-disney":16,
  "beauvais-disney":16, "paris-disney":16,
  "beauvais-paris":8, "paris-gares":8, "cdg-orly":8, "cdg-beauvais":8, "beauvais-orly":8
};

function required(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function isNightTime(time) {
  if (!time) return false;
  const hour = Number(String(time).split(":")[0]);
  return hour >= 22 || hour < 6;
}

function calculatePrice(data) {
  const service = data.service || data.service_type || data.trip_service || data.route || data.service_key || data.pricing_service;
  const pricingKey = service || data.service_type || "cdg-paris";

  const adults = Number(data.passengers || 1);
  const children = Number(data.children || 0);
  const totalPeople = Math.max(adults + children, 1);

  const grid = PRICING[pricingKey];

  let base = 0;

  if (grid?.default !== undefined) {
    base = grid.default;
  } else if (grid) {
    const max = SERVICE_MAX[pricingKey] || 16;
    const nb = Math.min(Math.max(totalPeople, 1), max);
    base = grid[nb] || grid[max] || 0;
  }

  const isRoundTrip = data.trip_type === "round_trip";

  const outboundNight = isNightTime(data.booking_time) ? NIGHT_SURCHARGE : 0;

  const returnNight =
    isRoundTrip && isNightTime(data.return_time)
      ? NIGHT_SURCHARGE
      : 0;

  const night = outboundNight + returnNight;

  const total = (isRoundTrip ? base * 2 : base) + night;

  return {
    base,
    outboundNight,
    returnNight,
    night,
    total
  };
}


function buildEmailData(booking) {
  const outboundNight = isNightTime(booking.booking_time) ? NIGHT_SURCHARGE : 0;

  const returnNight =
    booking.trip_type === "round_trip" && isNightTime(booking.return_time)
      ? NIGHT_SURCHARGE
      : 0;

  const totalNight = outboundNight + returnNight;
  const discountAmount = Number(booking.discount_amount || 0);

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

  return {
    ref: booking.booking_number || "",

    client_name: booking.customer_name || "",
    client_email: booking.customer_email || "",
    client_phone: booking.customer_phone || "",

    service_type: serviceType,
    service: serviceType,

    trip_type:
      booking.trip_type === "round_trip"
        ? "Round Trip"
        : "One Way",

    pickup: booking.pickup_location || "",
    destination: booking.destination || "",

    date: booking.booking_date || "",
    time: booking.booking_time || "",

    return_date: booking.return_date || "",
    return_time: booking.return_time || "",

    vehicle: booking.vehicle_type || "",

    passengers: String(booking.passengers || 0),
    children: String(booking.children || 0),
    luggage: String(booking.luggage || 0),

    baby_seats: String(booking.baby_seats || 0),
    child_seats: String(booking.child_seats || 0),

    flight: booking.flight_number || "",
    flight_number: booking.flight_number || "",
    terminal: booking.terminal || "",
    notes: booking.notes || "",

    price_base: booking.original_price ? `${booking.original_price}€` : "0€",
    price_outbound_night: `${outboundNight}€`,
    price_return_night: `${returnNight}€`,
    price_night: `${totalNight}€`,
    price_discount: `${discountAmount}€`,
    price_total: booking.price ? `${booking.price}€` : "0€",

    manage_url: `${process.env.CLIENT_URL}/manage-booking.html`
  };
}


/* FIND BOOKING */
router.post("/find", async (req, res) => {
  try {
    const { booking_number, customer_email } = req.body;

    if (!required(booking_number) || !required(customer_email)) {
      return res.status(400).json({
        success: false,
        message: "Booking number and email are required."
      });
    }

    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_number", booking_number)
      .eq("customer_email", customer_email)
      .single();

    if (error || !booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found."
      });
    }

    return res.json({ success: true, booking });

  } catch (error) {
    console.error("Find booking error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});

/* MODIFY BOOKING */
router.post("/modify", async (req, res) => {
  try {
    const {
      booking_number,
      customer_email,

      service_type,
      trip_type,

      booking_date,
      booking_time,
      return_date,
      return_time,

      pickup_location,
      destination,

      vehicle_type,

      passengers,
      children,
      luggage,

      baby_seats,
      child_seats,

      flight_number,
      terminal,
      notes
    } = req.body;

    if (!required(booking_number) || !required(customer_email)) {
      return res.status(400).json({
        success: false,
        message: "Booking number and email are required."
      });
    }

    const { data: booking, error: findError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_number", booking_number)
      .eq("customer_email", customer_email)
      .single();

    if (findError || !booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found."
      });
    }

    if (booking.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "This booking is cancelled and cannot be modified."
      });
    }

    const mergedBooking = {
      ...booking,
      service_type: service_type ?? booking.service_type,
      trip_type: trip_type ?? booking.trip_type,
      booking_date: booking_date ?? booking.booking_date,
      booking_time: booking_time ?? booking.booking_time,
      return_date: return_date ?? booking.return_date,
      return_time: return_time ?? booking.return_time,
      pickup_location: pickup_location ?? booking.pickup_location,
      destination: destination ?? booking.destination,
      vehicle_type: vehicle_type ?? booking.vehicle_type,
      passengers: required(passengers) ? Number(passengers) : booking.passengers,
      children: required(children) ? Number(children) : booking.children,
      luggage: required(luggage) ? Number(luggage) : booking.luggage,
      baby_seats: required(baby_seats) ? Number(baby_seats) : booking.baby_seats,
      child_seats: required(child_seats) ? Number(child_seats) : booking.child_seats,
      flight_number: flight_number ?? booking.flight_number,
      terminal: terminal ?? booking.terminal,
      notes: notes ?? booking.notes
    };

    const price = calculatePrice(mergedBooking);

    const updateData = {
      service_type: mergedBooking.service_type || null,
      trip_type: mergedBooking.trip_type || "one_way",

      booking_date: mergedBooking.booking_date,
      booking_time: mergedBooking.booking_time,

      return_date: mergedBooking.trip_type === "round_trip" ? mergedBooking.return_date || null : null,
      return_time: mergedBooking.trip_type === "round_trip" ? mergedBooking.return_time || null : null,

      pickup_location: mergedBooking.pickup_location,
      destination: mergedBooking.destination,

      vehicle_type: mergedBooking.vehicle_type || null,

      passengers: Number(mergedBooking.passengers || 1),
      children: Number(mergedBooking.children || 0),
      luggage: Number(mergedBooking.luggage || 0),

      baby_seats: Number(mergedBooking.baby_seats || 0),
      child_seats: Number(mergedBooking.child_seats || 0),

      flight_number: mergedBooking.flight_number || null,
      terminal: mergedBooking.terminal || null,
      notes: mergedBooking.notes || null,

      original_price: price.base,
      price: price.total,

      status: "modified",
      modified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: "customer"
    };

    const { data: updatedBooking, error: updateError } = await supabase
      .from("bookings")
      .update(updateData)
      .eq("id", booking.id)
      .select()
      .single();

    if (updateError) {
      console.error("Modify booking error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Booking could not be modified."
      });
    }

    const emailData = buildEmailData(updatedBooking);
    const templateAlias = process.env.RESEND_TEMPLATE_MODIFIED;

    if (!templateAlias) {
      throw new Error("RESEND_TEMPLATE_MODIFIED is missing in .env");
    }

    const clientEmail = await resend.emails.send({
      from: FROM_EMAIL,
      to: updatedBooking.customer_email,
      reply_to: REPLY_TO,
      subject: `Your Booking Has Been Updated • ${emailData.ref}`,
      template: {
        id: templateAlias,
        variables: emailData
      }
    });

    console.log("MODIFIED CLIENT EMAIL:", clientEmail);

    const adminEmail = await resend.emails.send({
      from: FROM_EMAIL,
      to: process.env.ADMIN_EMAIL,
      reply_to: REPLY_TO,
      subject: `Booking Modified by Client • ${emailData.ref}`,
      template: {
        id: templateAlias,
        variables: emailData
      }
    });

    console.log("MODIFIED ADMIN EMAIL:", adminEmail);

    await supabase
      .from("bookings")
      .update({ last_email_sent: new Date().toISOString() })
      .eq("id", updatedBooking.id);

    return res.json({
      success: true,
      message: "Booking modified successfully.",
      booking: updatedBooking,
      price
    });

  } catch (error) {
    console.error("Modify route error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error."
    });
  }
});

/* CANCEL BOOKING */
router.post("/cancel", async (req, res) => {
  try {
    const { booking_number, customer_email } = req.body;

    if (!required(booking_number) || !required(customer_email)) {
      return res.status(400).json({
        success: false,
        message: "Booking number and email are required."
      });
    }

    const { data: booking, error: findError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_number", booking_number)
      .eq("customer_email", customer_email)
      .single();

    if (findError || !booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found."
      });
    }

    if (booking.status === "cancelled") {
      return res.json({
        success: true,
        message: "Booking already cancelled.",
        booking
      });
    }

    const { data: updatedBooking, error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: "customer",
        confirm_token: null
      })
      .eq("id", booking.id)
      .select()
      .single();

    if (updateError) {
      console.error("Cancel booking error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Booking could not be cancelled."
      });
    }

    const emailData = buildEmailData(updatedBooking);
    const templateAlias = process.env.RESEND_TEMPLATE_CANCELLED;

    if (!templateAlias) {
      throw new Error("RESEND_TEMPLATE_CANCELLED is missing in .env");
    }

    const clientEmail = await resend.emails.send({
      from: FROM_EMAIL,
      to: updatedBooking.customer_email,
      reply_to: REPLY_TO,
      subject: `Booking Cancelled • ${emailData.ref}`,
      template: {
        id: templateAlias,
        variables: emailData
      }
    });

    console.log("CANCELLED CLIENT EMAIL:", clientEmail);

    const adminEmail = await resend.emails.send({
      from: FROM_EMAIL,
      to: process.env.ADMIN_EMAIL,
      reply_to: REPLY_TO,
      subject: `Booking Cancelled by Client • ${emailData.ref}`,
      template: {
        id: templateAlias,
        variables: emailData
      }
    });

    console.log("CANCELLED ADMIN EMAIL:", adminEmail);

    await supabase
      .from("bookings")
      .update({ last_email_sent: new Date().toISOString() })
      .eq("id", updatedBooking.id);

    return res.json({
      success: true,
      message: "Booking cancelled successfully.",
      booking: updatedBooking
    });

  } catch (error) {
    console.error("Cancel route error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error."
    });
  }
});

export default router;
