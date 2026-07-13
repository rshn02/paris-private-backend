export function generateReference() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const random = Math.random().toString(36).substring(2, 8).toUpperCase();

  return `PPAT-${year}${month}${day}-${random}`;
}