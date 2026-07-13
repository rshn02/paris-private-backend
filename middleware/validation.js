export function required(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function validateBookingData(data) {
  const missing = [];

  if (!required(data.customer_name)) missing.push("customer_name");
  if (!required(data.customer_email)) missing.push("customer_email");
  if (!required(data.pickup_location)) missing.push("pickup_location");
  if (!required(data.destination)) missing.push("destination");
  if (!required(data.booking_date)) missing.push("booking_date");
  if (!required(data.booking_time)) missing.push("booking_time");

  return missing;
}