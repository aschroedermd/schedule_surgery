import type { Resident, ServiceLine } from "./types";

export interface StudentPlacement { service: ServiceLine; startDate: string; endDate: string }
export interface NewStudentInput { name: string; placement: StudentPlacement; distinctPerson: boolean }
export function studentNameKey(name: string): string {
  return name.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
}
export function matchingStudents(residents: Resident[], name: string): Resident[] {
  const key = studentNameKey(name);
  return key ? residents.filter(person => person.trainingLevel === "Student" && [person.name, ...(person.aliases ?? [])].some(value => studentNameKey(value) === key)) : [];
}
