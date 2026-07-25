import express from "express";
import { supabase } from "../config/supabase.js";
import { resend, FROM_EMAIL, REPLY_TO } from "../config/resend.js";
import { syncBookingCalendarEvents } from "../utils/calendar.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Missing confirmation token."
      });
    }

    const { data: booking, error: findError } = await supabase
      .from("bookings")
      .select("*")
      .eq("confirm_token", token)
      .single();

    if (findError || !booking) {
      return res.status(404).json({
        success: false,
        message: "Invalid or expired confirmation link."
      });
    }

    if (booking.status === "confirmed") {
      return res.json({
        success: true,
        already_confirmed: true,
        booking_number: booking.booking_number
      });
    }

    if (booking.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "This booking has already been cancelled."
      });
    }

    const { data: updatedBooking, error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        email_confirmed: true,
        confirmed_at: new Date().toISOString(),
        confirm_token: null,
        updated_by: "customer",
        updated_at: new Date().toISOString()
      })
      .eq("id", booking.id)
      .select()
      .single();

    if (updateError) {
      console.error("Confirmation update error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Booking could not be confirmed."
      });
    }

    let calendarIds = {
      outboundEventId: null,
      returnEventId: null
    };

    try {
      calendarIds = await syncBookingCalendarEvents(updatedBooking);

      console.log("CONFIRM CALENDAR IDS:", {
        bookingId: updatedBooking.id,
        bookingNumber: updatedBooking.booking_number,
        ...calendarIds
      });
    } catch (calendarError) {
      console.error("GOOGLE CALENDAR ERROR:", {
        message: calendarError?.message,
        code: calendarError?.code,
        errors: calendarError?.errors,
        response: calendarError?.response?.data,
        stack: calendarError?.stack
      });
    }

    const { error: calendarUpdateError } = await supabase
      .from("bookings")
      .update({
        google_event_outbound_id: calendarIds.outboundEventId,
        google_event_return_id: calendarIds.returnEventId
      })
      .eq("id", updatedBooking.id);

    if (calendarUpdateError) {
      console.error("GOOGLE CALENDAR IDS SAVE ERROR:", calendarUpdateError);
    }

    const basePrice = Number(updatedBooking.original_price || 0);
    const totalPrice = Number(updatedBooking.price || 0);
    const discountAmount = Number(updatedBooking.discount_amount || 0);

    const outboundNight = Number(updatedBooking.outbound_night_surcharge || 0);
    const returnNight = Number(updatedBooking.return_night_surcharge || 0);
    const nightTotal = Number(
      updatedBooking.night_surcharge || (outboundNight + returnNight)
    );

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
      serviceLabels[updatedBooking.service_type] ||
      updatedBooking.service_type ||
      "Private Transfer";

    const paymentMethodLabels = {
      cash: "Cash",
      card: "Credit Card",
      paypal: "PayPal",
      bank_transfer: "Bank Transfer"
    };

    const paymentMethod =
      paymentMethodLabels[updatedBooking.payment_method] ||
      updatedBooking.payment_method ||
      "";

    const emailData = {
      ref: updatedBooking.booking_number || "",

      client_name: updatedBooking.customer_name || "",
      client_email: updatedBooking.customer_email || "",
      client_phone: updatedBooking.customer_phone || "",

      pickup: updatedBooking.pickup_location || "",
      destination: updatedBooking.destination || "",
      date: updatedBooking.booking_date || "",
      time: updatedBooking.booking_time || "",
      return_date: updatedBooking.return_date || "",
      return_time: updatedBooking.return_time || "",

      service_type: serviceType,
      trip_type: updatedBooking.trip_type === "round_trip" ? "Round Trip" : "One Way",
      vehicle: updatedBooking.vehicle_type || "",
      payment_method: paymentMethod,

      passengers: String(updatedBooking.passengers || 0),
      children: String(updatedBooking.children || 0),
      luggage: String(updatedBooking.luggage || 0),
      baby_seats: String(updatedBooking.baby_seats || 0),
      child_seats: String(updatedBooking.child_seats || 0),

      flight_number: updatedBooking.flight_number || "",
      terminal: updatedBooking.terminal || "",
      notes: updatedBooking.notes || "",

      price_base: `${basePrice}€`,
      price_outbound_night: `${outboundNight}€`,
      price_return_night: `${returnNight}€`,
      price_night: `${nightTotal}€`,
      price_discount: `${discountAmount}€`,
      price_total: `${totalPrice}€`,

      manage_url: `${process.env.CLIENT_URL}/manage-booking.html`
    };
    const templateAlias = process.env.RESEND_TEMPLATE_CONFIRMED;

if (!templateAlias) {
  throw new Error("RESEND_TEMPLATE_CONFIRMED is missing in .env");
}

const clientEmail = await resend.emails.send({
  from: FROM_EMAIL,
  to: updatedBooking.customer_email,
  reply_to: REPLY_TO,
  subject: `Your Booking is Confirmed • ${emailData.ref}`,
  template: {
    id: templateAlias,
    variables: emailData
  }
});

console.log("CONFIRMED CLIENT EMAIL :", clientEmail);

const adminEmail = await resend.emails.send({
  from: FROM_EMAIL,
  to: process.env.ADMIN_EMAIL,
  reply_to: REPLY_TO,
  subject: `Booking Confirmed by Client • ${emailData.ref}`,
  template: {
    id: templateAlias,
    variables: emailData
  }
});

console.log("CONFIRMED ADMIN EMAIL :", adminEmail);

    await supabase
      .from("bookings")
      .update({
        last_email_sent: new Date().toISOString()
      })
      .eq("id", updatedBooking.id);

    return res.json({
      success: true,
      booking_number: updatedBooking.booking_number
    });

  } catch (error) {
    console.error("Confirm route error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error."
    });
  }
});

export default router;
