export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildResidentUsername(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  if (parts.length < 2) return "";
  const firstInitial = parts[0][0] ?? "";
  const lastName = parts[parts.length - 1];
  return `${firstInitial}${lastName}`.toLowerCase();
}

export function isPlaceholderResidentUsername(username: string | undefined): boolean {
  return Boolean(username && /^resident\d{2}$/i.test(username.trim()));
}
