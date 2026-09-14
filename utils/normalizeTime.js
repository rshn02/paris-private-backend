// SQL TIME may include seconds while HTML time inputs commonly omit them.
// Preserve nonzero seconds/fractions: only equivalent representations collapse.
export function normalizeTime(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(text);
  if (!match) return text;
  const fraction = (match[4] || "").replace(/0+$/, "");
  return `${match[1]}:${match[2]}:${match[3] || "00"}${fraction ? "." + fraction : ""}`;
}
