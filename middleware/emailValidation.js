export function isValidEmail(value) {
  if (typeof value !== "string" || value.length > 254) return false;
  const parts = value.split("@");
  return parts.length === 2 && parts[0].length <= 64
    && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(parts[0])
    && parts[1].includes(".")
    && parts[1].split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

const limits = {
  name: 150, customer_name: 150, email: 254, customer_email: 254,
  phone: 50, customer_phone: 50, subject: 80, message: 5000, notes: 5000,
  pickup_location: 500, destination: 500, terminal: 100, flight_number: 50,
  vehicle_type: 100, payment_method: 50, service_type: 100, trip_type: 30,
  booking_date: 30, booking_time: 30, return_date: 30, return_time: 30,
  booking_number: 100, website: 500, service: 100
};

export function validateEmailInput(emailField) {
  return (req, res, next) => {
    const body = req.body;
    const reject = message => res.status(400).json({ success: false, error: message, message });
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject("Invalid request data.");
    for (const [field, max] of Object.entries(limits)) {
      if (body[field] === undefined || body[field] === null) continue;
      if (typeof body[field] !== "string") return reject(`Invalid ${field} value.`);
      body[field] = body[field].trim();
      if (body[field].length > max) return reject(`${field} must not exceed ${max} characters.`);
    }
    if (!isValidEmail(body[emailField])) return reject("A valid email address is required.");
    next();
  };
}
