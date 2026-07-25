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

  return [
    `Reference: ${booking.booking_number || ""}`,
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

  if (!isRoundTrip) {
    return `${booking.booking_number} • One Way • ${pickup} → ${destination}`;
  }

  return `${booking.booking_number} • ${
    isReturn ? "Round Trip - Return" : "Round Trip - Outbound"
  } • ${pickup} → ${destination}`;
}

export async function createBookingCalendarEvents(booking) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const outboundStart = buildDateTime(booking.booking_date, booking.booking_time);

  const outboundEvent = {
    summary: buildSummary(booking, "outbound"),
    location: booking.pickup_location || "",
    description: buildDescription(booking, "outbound"),
    start: {
      dateTime: outboundStart,
      timeZone: "Europe/Paris",
    },
    end: {
      dateTime: addHours(booking.booking_date, booking.booking_time, 2),
      timeZone: "Europe/Paris",
    },
  };

  const outboundResponse = await calendar.events.insert({
    calendarId,
    resource: outboundEvent,
  });

  let returnResponse = null;

  if (
    booking.trip_type === "round_trip" &&
    booking.return_date &&
    booking.return_time
  ) {
    const returnStart = buildDateTime(booking.return_date, booking.return_time);

    const returnEvent = {
      summary: buildSummary(booking, "return"),
      location: booking.destination || "",
      description: buildDescription(booking, "return"),
      start: {
        dateTime: returnStart,
        timeZone: "Europe/Paris",
      },
      end: {
        dateTime: addHours(booking.return_date, booking.return_time, 2),
        timeZone: "Europe/Paris",
      },
    };

    returnResponse = await calendar.events.insert({
      calendarId,
      resource: returnEvent,
    });
  }

  return {
    outboundEventId: outboundResponse.data.id,
    returnEventId: returnResponse?.data?.id || null,
  };
}
