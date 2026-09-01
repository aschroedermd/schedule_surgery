import type { CallOffRequest, Resident, TrainingLevel } from "./types";

export interface CallOffRequestSeniority {
  key: "senior" | "midlevel" | "intern" | "other";
  label: string;
  rank: number;
}

export function getCallOffRequestSeniority(trainingLevel: TrainingLevel): CallOffRequestSeniority {
  if (trainingLevel === "PGY4" || trainingLevel === "PGY5") {
    return { key: "senior", label: "PGY-4/5", rank: 0 };
  }
  if (trainingLevel === "PGY2" || trainingLevel === "PGY3") {
    return { key: "midlevel", label: "PGY-2/3", rank: 1 };
  }
  if (trainingLevel === "PGY1") {
    return { key: "intern", label: "PGY-1", rank: 2 };
  }
  return { key: "other", label: trainingLevel, rank: 3 };
}

export function compareCallOffRequestPrecedence(
  left: CallOffRequest,
  right: CallOffRequest,
  residentsById: ReadonlyMap<string, { trainingLevel?: Resident["trainingLevel"] }>
): number {
  const priorityDifference = Number(left.priority === "secondary") - Number(right.priority === "secondary");
  if (priorityDifference !== 0) return priorityDifference;

  const leftSeniority = residentsById.get(left.residentId)?.trainingLevel;
  const rightSeniority = residentsById.get(right.residentId)?.trainingLevel;
  const seniorityDifference = (leftSeniority ? getCallOffRequestSeniority(leftSeniority).rank : 4)
    - (rightSeniority ? getCallOffRequestSeniority(rightSeniority).rank : 4);
  return seniorityDifference
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}
