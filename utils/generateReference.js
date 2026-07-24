export async function generateReference(supabase) {
  const { data, error } = await supabase
    .from("bookings")
    .select("booking_number")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  const lastRef = (data || [])
    .map((row) => String(row.booking_number || "").trim())
    .find((ref) => /^PPAT-\d+$/.test(ref));

  const lastNumber = lastRef ? Number(lastRef.replace("PPAT-", "")) : 1999;
  const nextNumber = lastNumber + 1;

  return `PPAT-${nextNumber}`;
}