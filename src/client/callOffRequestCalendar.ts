import { getCallBuilderWeekendAnchor } from "../shared/callBuilder";
import { addDays } from "../shared/date";
import { compareCallOffRequestPrecedence } from "../shared/callOffRequests";
import type { CallOffRequest, Resident } from "../shared/types";

export interface CallOffRequestBlockRange {
  startDate: string;
  endDate: string;
}

export interface ResidentCallOffRequests {
  residentId: string;
  residentName: string;
  trainingLevel: Resident["trainingLevel"];
  requests: CallOffRequest[];
}

export function getCallOffRequestDates(request: CallOffRequest, block: CallOffRequestBlockRange): string[] {
  const dates = request.scope === "weekend"
    ? [0, 1, 2].map((offset) => addDays(getCallBuilderWeekendAnchor(request.date), offset))
    : [request.date];
  return dates.filter((date) => date >= block.startDate && date <= block.endDate);
}

export function getBlockCallOffRequests(requests: CallOffRequest[], block: CallOffRequestBlockRange): CallOffRequest[] {
  return requests.filter((request) => getCallOffRequestDates(request, block).length > 0);
}

export function getCallOffRequestResidentIdsByDate(
  requests: CallOffRequest[],
  block: CallOffRequestBlockRange
): Record<string, string[]> {
  const residentsByDate = new Map<string, Set<string>>();
  for (const request of getBlockCallOffRequests(requests, block)) {
    for (const date of getCallOffRequestDates(request, block)) {
      const residentIds = residentsByDate.get(date) ?? new Set<string>();
      residentIds.add(request.residentId);
      residentsByDate.set(date, residentIds);
    }
  }
  return Object.fromEntries(
    [...residentsByDate.entries()].map(([date, residentIds]) => [date, [...residentIds]])
  );
}

export function groupCallOffRequestsByResident(
  requests: CallOffRequest[],
  residents: Array<Pick<Resident, "id" | "name"> & Partial<Pick<Resident, "trainingLevel">>>,
  block: CallOffRequestBlockRange
): ResidentCallOffRequests[] {
  const residentsById = new Map(residents.map((resident) => [resident.id, resident]));
  const grouped = new Map<string, CallOffRequest[]>();
  for (const request of getBlockCallOffRequests(requests, block)) {
    const residentRequests = grouped.get(request.residentId) ?? [];
    residentRequests.push(request);
    grouped.set(request.residentId, residentRequests);
  }
  return [...grouped.entries()]
    .map(([residentId, residentRequests]) => ({
      residentId,
      residentName: residentsById.get(residentId)?.name ?? residentId,
      trainingLevel: residentsById.get(residentId)?.trainingLevel ?? "Medical Student",
      requests: [...residentRequests].sort((left, right) =>
        compareCallOffRequestPrecedence(left, right, residentsById)
        || left.date.localeCompare(right.date)
      )
    }))
    .sort((left, right) => compareCallOffRequestPrecedence(left.requests[0], right.requests[0], residentsById));
}
