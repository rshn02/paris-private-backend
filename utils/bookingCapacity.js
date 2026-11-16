// Passenger semantics: passengers = adults; children includes infants.
// Seat requests are equipment, never additional passengers. Fare logic is separate.
export const CHILD_SEAT_POLICY = "Baby seats and child seats are available free of charge upon request. Please specify the children's ages and required seats when booking.";
const CONTACT_MESSAGE = "Travelling with more than 8 passengers? Please contact us to arrange transportation with two vehicles.";

function count(value, fallback, minimum) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : null;
}

export function bookingCapacityIssue(data) {
  // There is no separate infant/aggregate-count field in the existing contract.
  // Reject alternative counts instead of silently ignoring or double-counting them.
  if (["infants", "infant_count", "adults", "total_passengers", "passenger_count"].some(key => Object.hasOwn(data, key))) {
    return { code: "INVALID_PASSENGER_COUNTS", message: "Use passengers for adults and children for all children, including infants. Seat requests do not replace passenger counts." };
  }
  const adults = count(data.passengers, 1, 1);
  const children = count(data.children, 0, 0);
  if (adults === null || children === null || !Number.isSafeInteger(adults + children)) {
    return { code: "INVALID_PASSENGER_COUNTS", message: "Passenger counts must be whole numbers: at least one adult and zero or more children, including infants." };
  }
  if (adults + children > 8) {
    return { code: "GROUP_CONTACT_REQUIRED", message: CONTACT_MESSAGE, contact_url: "https://www.parisprivateairporttransfer.com/contact" };
  }
  const luggage = count(data.luggage, 0, 0);
  if (data.luggage === "more-than-8" || (luggage !== null && luggage > 8)) {
    return { code: "LUGGAGE_CONTACT_REQUIRED", message: "Travelling with more than 8 suitcases? Please contact us to arrange a suitable vehicle solution for your group.", contact_url: "https://www.parisprivateairporttransfer.com/contact" };
  }
  if (luggage === null) {
    return { code: "INVALID_LUGGAGE_COUNT", message: "Please enter a whole number of suitcases from 0 to 8, excluding hand luggage." };
  }
  if (["suitcases", "suitcase_count", "large_suitcases", "bags"].some(key => Object.hasOwn(data, key))) {
    return { code: "INVALID_LUGGAGE_COUNT", message: "Use luggage for the number of large suitcases, excluding hand luggage." };
  }
  if (adults + children > 2 && String(data.vehicle_type || "").trim() === "Premium Sedan") {
    return { code: "SEDAN_CAPACITY_EXCEEDED", message: "The sedan accommodates up to 2 passengers. Please select a van and check luggage and child-seat suitability." };
  }
  if (luggage > 2 && String(data.vehicle_type || "").trim() === "Premium Sedan") {
    return { code: "SEDAN_LUGGAGE_CAPACITY_EXCEEDED", message: "The sedan accommodates up to 2 large suitcases. Please select a van and check passenger, child-seat and luggage suitability." };
  }
  return null;
}

export function validateBookingCapacity(req, res, next) {
  const issue = bookingCapacityIssue(req.body || {});
  if (issue) return res.status(400).json({ success: false, ...issue });
  return next();
}

export function displayBookingVehicle(booking) {
  const issue = bookingCapacityIssue(booking);
  if (issue) return "Vehicle arrangement requires confirmation. " + issue.message;
  const vehicle = String(booking.vehicle_type || "").trim();
  // Presentation only: retain stored/API identifiers and do not rename unrelated models.
  if (/^(?:Luxury|Private) Van(?: \(?[1-8](?:[-–][1-8])? (?:seats|passengers)\)?(?: \([1-8][-–][1-8] people\))?)?$/i.test(vehicle)) {
    return "Private van (1–8 passengers, excluding the chauffeur)";
  }
  return vehicle;
}
