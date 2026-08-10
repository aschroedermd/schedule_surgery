const SURNAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "della",
  "den",
  "der",
  "di",
  "dos",
  "du",
  "la",
  "le",
  "st",
  "van",
  "von"
]);

const NAME_PREFIXES = new Set(["dr", "mr", "mrs", "ms", "prof"]);
const NAME_SUFFIXES = new Set(["ii", "iii", "iv", "jr", "sr"]);

export function comparePersonNames(
  left: string | undefined,
  right: string | undefined
): number {
  const leftName = left?.trim() ?? "";
  const rightName = right?.trim() ?? "";
  const surnameDelta = getPersonSurnameSortKey(leftName).localeCompare(
    getPersonSurnameSortKey(rightName),
    undefined,
    { sensitivity: "base" }
  );
  return surnameDelta || leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
}

export function getPersonSurnameSortKey(name: string): string {
  const displayName = name.trim();
  if (!displayName) return "";

  const commaParts = displayName.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1 && looksLikeLastNameFirst(displayName, commaParts[1])) {
    return normalizeNamePart(commaParts[0]);
  }

  const beforeCredentials = commaParts[0] ?? displayName;
  const words = beforeCredentials
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter(Boolean)
    .filter((word, index) => index > 0 || !NAME_PREFIXES.has(word));

  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1])) words.pop();
  if (words.length <= 1) return words[0] ?? "";

  let surnameStart = words.length - 1;
  while (surnameStart > 0 && SURNAME_PARTICLES.has(words[surnameStart - 1])) surnameStart -= 1;
  return words.slice(surnameStart).join(" ");
}

function looksLikeLastNameFirst(displayName: string, secondPart: string): boolean {
  if (!displayName.includes(",")) return false;
  const normalizedSecond = normalizeNamePart(secondPart.split(/\s+/)[0] ?? "");
  return Boolean(normalizedSecond && !/^(?:md|do|np|pa|rn|phd|pgy\d|ms\d)$/.test(normalizedSecond));
}

function normalizeNamePart(value: string): string {
  return value.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
