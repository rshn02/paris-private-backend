export async function generateReference(supabase) {
  const { data, error } = await supabase
    .from("bookings")
    .select("booking_number")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  const lastNumericRef = (data || [])
    .map((row) => String(row.booking_number || "").trim())
    .find((ref) => /^\d+$/.test(ref));

  const nextNumber = (lastNumericRef ? Number(lastNumericRef) : 1999) + 1;

  return String(nextNumber);
}