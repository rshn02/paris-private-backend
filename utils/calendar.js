import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

function getCalendarClient() {
  return google.calendar({ version: "v3", auth });
}

const CALENDAR_TIME_ZONE = "Europe/Paris";

const STATUS_LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  modified: "Modified",
  cancelled: "Cancelled"
};

const STATUS_COLOR_IDS = {
  pending: "5",
  confirmed: "10",
  modified: "1",
  cancelled: "11"
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeDatePart(value) {
  if (!value) {
    throw new Error("Missing booking date for Google Calendar event.");
  }

  return String(value).split("T")[0];
}

function normalizeTimePart(value) {
  if (!value) {
    throw new Error("Missing booking time for Google Calendar event.");
  }

  const time = String(value).trim().split(".")[0];
  const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) {
    throw new Error(`Invalid booking time format for Google Calendar: ${value}`);
  }

  const [, hours, minutes, seconds = "00"] = match;
  return `${pad(hours)}:${minutes}:${seconds}`;
}

function buildDateTime(dateStr, timeStr) {
  return `${normalizeDatePart(dateStr)}T${normalizeTimePart(timeStr)}`;
}

function addHours(dateStr, timeStr, hours = 2) {
  const start = new Date(buildDateTime(dateStr, timeStr));

  if (Number.isNaN(start.getTime())) {
    throw new Error(
      `Invalid booking date/time for Google Calendar: ${dateStr} ${timeStr}`
    );
  }

  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);

  return [
    `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    `${pad(end.getHours())}:${pad(end.getMinutes())}:${pad(end.getSeconds())}`,
  ].join("T");
}

function buildDescription(booking, leg = "outbound") {
  const isReturn = leg === "return";
  const pickup = isReturn ? booking.destination : booking.pickup_location;
  const destination = isReturn ? booking.pickup_location : booking.destination;
  const date = isReturn ? booking.return_date : booking.booking_date;
  const time = isReturn ? booking.return_time : booking.booking_time;
  const statusLabel = STATUS_LABELS[booking.status] || "Pending";

  return [
    `Reference: ${booking.booking_number || ""}`,
    `Status: ${statusLabel}`,
    `Trip type: ${booking.trip_type || "one_way"}`,
    `Leg: ${isReturn ? "Return" : "Outbound"}`,
    `Client: ${booking.customer_name || ""}`,
    `Phone: ${booking.customer_phone || ""}`,
    `Email: ${booking.customer_email || ""}`,
    `Service type: ${booking.service_type || ""}`,
    `Pickup: ${pickup || ""}`,
    `Destination: ${destination || ""}`,
    `Date: ${date || ""}`,
    `Time: ${time || ""}`,
    `Passengers: ${booking.passengers || 0}`,
    `Children: ${booking.children || 0}`,
    `Baby seats: ${booking.baby_seats || 0}`,
    `Child seats: ${booking.child_seats || 0}`,
    `Flight number: ${booking.flight_number || ""}`,
    `Terminal: ${booking.terminal || ""}`,
    `Vehicle: ${booking.vehicle_type || ""}`,
    `Payment method: ${booking.payment_method || ""}`,
    `Price: ${booking.price || ""}€`,
    `Notes: ${booking.notes || ""}`,
  ].join("\n");
}

function buildSummary(booking, leg = "outbound") {
  const isRoundTrip = booking.trip_type === "round_trip";
  const isReturn = leg === "return";
  const pickup = isReturn ? booking.destination : booking.pickup_location;
  const destination = isReturn ? booking.pickup_location : booking.destination;
  const statusLabel = STATUS_LABELS[booking.status] || "Pending";

  if (!isRoundTrip) {
    return `${booking.booking_number} • ${statusLabel} • One Way • ${pickup} → ${destination}`;
  }

  return `${booking.booking_number} • ${statusLabel} • ${
    isReturn ? "Round Trip - Return" : "Round Trip - Outbound"
  } • ${pickup} → ${destination}`;
}

function getCalendarId() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!calendarId) {
    throw new Error("Missing GOOGLE_CALENDAR_ID environment variable.");
  }

  return calendarId;
}

function buildEventResource(booking, leg = "outbound") {
  const isReturn = leg === "return";
  const date = isReturn ? booking.return_date : booking.booking_date;
  const time = isReturn ? booking.return_time : booking.booking_time;
  const location = isReturn ? booking.destination : booking.pickup_location;

  return {
    summary: buildSummary(booking, leg),
    location: location || "",
    description: buildDescription(booking, leg),
    colorId: STATUS_COLOR_IDS[booking.status] || STATUS_COLOR_IDS.pending,
    start: {
      dateTime: buildDateTime(date, time),
      timeZone: CALENDAR_TIME_ZONE
    },
    end: {
      dateTime: addHours(date, time, 2),
      timeZone: CALENDAR_TIME_ZONE
    }
  };
}

async function upsertEvent(calendar, calendarId, eventId, resource) {
  if (eventId) {
    const response = await calendar.events.update({
      calendarId,
      eventId,
      resource
    });

    return response.data.id;
  }

  const response = await calendar.events.insert({
    calendarId,
    resource
  });

  return response.data.id;
}

async function deleteEvent(calendar, calendarId, eventId) {
  if (!eventId) {
    return;
  }

  try {
    await calendar.events.delete({
      calendarId,
      eventId
    });
  } catch (error) {
    if (error?.code !== 404) {
      throw error;
    }
  }
}

export async function syncBookingCalendarEvents(booking) {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();

  console.log("GOOGLE CALENDAR SYNC START:", {
    calendarId,
    bookingNumber: booking.booking_number,
    status: booking.status,
    tripType: booking.trip_type,
    outboundDate: booking.booking_date,
    outboundTime: booking.booking_time,
    returnDate: booking.return_date,
    returnTime: booking.return_time,
    existingOutboundEventId: booking.google_event_outbound_id || null,
    existingReturnEventId: booking.google_event_return_id || null
  });

  const outboundEventId = await upsertEvent(
    calendar,
    calendarId,
    booking.google_event_outbound_id,
    buildEventResource(booking, "outbound")
  );

  let returnEventId = booking.google_event_return_id || null;
  const hasReturnLeg =
    booking.trip_type === "round_trip" &&
    booking.return_date &&
    booking.return_time;

  if (hasReturnLeg) {
    returnEventId = await upsertEvent(
      calendar,
      calendarId,
      booking.google_event_return_id,
      buildEventResource(booking, "return")
    );
  } else if (booking.google_event_return_id) {
    await deleteEvent(calendar, calendarId, booking.google_event_return_id);
    returnEventId = null;
  }
  
  console.log("GOOGLE CALENDAR SYNC OK:", {
    calendarId,
    bookingNumber: booking.booking_number,
    outboundEventId,
    returnEventId
  });


  return {
    outboundEventId,
    returnEventId
  };
}

export const createBookingCalendarEvents = syncBookingCalendarEvents;
