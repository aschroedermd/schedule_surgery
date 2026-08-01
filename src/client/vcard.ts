import { DirectoryContact } from "../shared/types";

export function makeTelephoneUrl(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `tel:${digits.length === 10 ? `+1${digits}` : `+${digits}`}`;
}

export function buildVCard(contact: DirectoryContact): string {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const phones = [contact.phoneNumber, ...(contact.alternatePhoneNumbers ?? [])]
    .map((phoneNumber) => makeTelephoneUrl(phoneNumber).slice(4));
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:;${escape(contact.name)};;;`,
    `FN:${escape(contact.name)}`,
    `ORG:${escape(contact.organization)}`,
    ...phones.map((phone) => `TEL;TYPE=WORK,VOICE:${phone}`),
    `CATEGORIES:${escape(contact.category)}`,
    `UID:${escape(contact.id)}@hospital-directory`,
    "END:VCARD",
    ""
  ].join("\r\n");
}

export function vCardFilename(contact: DirectoryContact): string {
  return `${contact.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "hospital-contact"}.vcf`;
}
