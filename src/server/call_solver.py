#!/usr/bin/env python3
"""Local CP-SAT worker for resident call scheduling.

The Node server sends a normalized, identifier-only JSON problem on stdin. This
process writes exactly one JSON response to stdout and never makes network calls.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model


ENGINE_VERSION = "cp-sat-call-builder-v4"


def debug(message: str) -> None:
    if os.environ.get("CALL_SOLVER_DEBUG") == "1":
        print(message, file=sys.stderr, flush=True)


def solve(problem: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    deadline = started + float(problem.get("timeLimitSeconds", 5.0))
    model = cp_model.CpModel()
    slots = problem["slots"]
    residents = problem["residents"]
    slot_by_id = {item["id"]: item for item in slots}
    resident_by_id = {item["id"]: item for item in residents}
    variables: dict[tuple[str, str, str], cp_model.IntVar] = {}

    for resident in residents:
        for slot_id in resident["eligibleSlotIds"]:
            for position in resident.get("eligiblePositions", [resident["position"]]):
                variables[(resident["id"], slot_id, position)] = model.new_bool_var(
                    f"x_{resident['id']}_{safe(slot_id)}_{safe(position)}"
                )
    debug(f"variables={len(variables)}")

    conflicts: list[str] = []
    for slot in slots:
        slot_id = slot["id"]
        for position in ("senior", "mid-level", "intern"):
            slot_vars = [
                variables[(resident["id"], slot_id, position)]
                for resident in residents
                if (resident["id"], slot_id, position) in variables
            ]
            if not slot_vars:
                conflicts.append(f"No eligible {position} resident is available for {slot['date']} {slot['shift']}.")
            else:
                model.add_exactly_one(slot_vars)

        for resident in residents:
            resident_slot_vars = [
                variable
                for (resident_id, variable_slot_id, _), variable in variables.items()
                if resident_id == resident["id"] and variable_slot_id == slot_id
            ]
            if len(resident_slot_vars) > 1:
                model.add(sum(resident_slot_vars) <= 1)

    if conflicts:
        return infeasible_response(started, conflicts)
    debug("hard constraints built")

    # Absolutely no consecutive call dates.
    slots_by_date: dict[str, list[str]] = defaultdict(list)
    for slot in slots:
        slots_by_date[slot["date"]].append(slot["id"])
    ordered_dates = sorted(slots_by_date)
    for resident in residents:
        resident_id = resident["id"]
        for left_index, left_date in enumerate(ordered_dates):
            for right_date in ordered_dates[left_index + 1 :]:
                if abs(days_ordinal(slot_by_id[slots_by_date[left_date][0]]) - days_ordinal(slot_by_id[slots_by_date[right_date][0]])) != 1:
                    continue
                left_vars = [
                    variable
                    for (variable_resident_id, slot_id, _), variable in variables.items()
                    if variable_resident_id == resident_id and slot_id in slots_by_date[left_date]
                ]
                right_vars = [
                    variable
                    for (variable_resident_id, slot_id, _), variable in variables.items()
                    if variable_resident_id == resident_id and slot_id in slots_by_date[right_date]
                ]
                for left in left_vars:
                    for right in right_vars:
                        model.add(left + right <= 1)

    # The EGS chief and EGS mid-level resident cannot share a call weekend.
    slots_by_weekend: dict[str, list[str]] = defaultdict(list)
    for item in slots:
        slots_by_weekend[item["weekend"]].append(item["id"])
    for weekend_slots in slots_by_weekend.values():
        chief_vars = [
            variable
            for resident in residents
            for (resident_id, slot_id, _), variable in variables.items()
            if resident_id == resident["id"] and slot_id in weekend_slots and slot_id in resident["egsChiefSlotIds"]
        ]
        midlevel_vars = [
            variable
            for resident in residents
            for (resident_id, slot_id, _), variable in variables.items()
            if resident_id == resident["id"] and slot_id in weekend_slots and slot_id in resident["egsMidlevelSlotIds"]
        ]
        for chief in chief_vars:
            for midlevel in midlevel_vars:
                model.add(chief + midlevel <= 1)

    for locked in problem.get("lockedAssignments", []):
        slot_id = assignment_slot_id(locked)
        variable = variables.get((locked["residentId"], slot_id, locked["callPosition"]))
        resident = resident_by_id.get(locked["residentId"])
        if variable is None or resident is None:
            conflicts.append(
                f"Locked assignment {locked['date']} {locked['callPosition']} is not eligible."
            )
        else:
            model.add(variable == 1)
    for required in problem.get("requiredAssignments", []):
        slot_id = assignment_slot_id(required)
        variable = variables.get((required["residentId"], slot_id, required["callPosition"]))
        resident = resident_by_id.get(required["residentId"])
        if variable is None or resident is None:
            conflicts.append(
                f"Required call assignment {required['date']} {required['callPosition']} is not eligible."
            )
        else:
            model.add(variable == 1)
    if conflicts:
        return infeasible_response(started, conflicts)

    objectives: list[tuple[str, str, Any]] = []
    loads: dict[str, cp_model.IntVar] = {}
    used: dict[str, cp_model.IntVar] = {}
    fairness_unassigned: list[Any] = []
    fairness_deviation: list[Any] = []
    three_unit_overload: list[Any] = []
    reserve_units: list[Any] = []

    max_block_units = sum(item["units"] for item in slots)
    for resident in residents:
        resident_id = resident["id"]
        resident_vars = [
            (variable, item["units"])
            for item in slots
            for (variable_resident_id, slot_id, _), variable in variables.items()
            if variable_resident_id == resident_id and slot_id == item["id"]
        ]
        load = model.new_int_var(0, max_block_units, f"load_{resident_id}")
        model.add(load == sum(variable * units for variable, units in resident_vars))
        loads[resident_id] = load
        resident_used = model.new_bool_var(f"used_{resident_id}")
        if resident_vars:
            model.add(sum(variable for variable, _ in resident_vars) >= resident_used)
            model.add(sum(variable for variable, _ in resident_vars) <= len(resident_vars) * resident_used)
        else:
            model.add(resident_used == 0)
        used[resident_id] = resident_used

        over_two = model.new_int_var(0, max_block_units, f"over_two_{resident_id}")
        model.add(over_two >= load - 2)
        three_unit_overload.append(over_two)

        if resident["regularPool"]:
            fairness_unassigned.append(1 - resident_used)
            under = model.new_int_var(0, max_block_units, f"under_{resident_id}")
            over = model.new_int_var(0, max_block_units, f"over_{resident_id}")
            model.add(under >= int(resident["targetMinUnits"]) - load)
            model.add(over >= load - int(resident["targetMaxUnits"]))
            fairness_deviation.extend((under, over))
        elif resident["nrv"]:
            reserve_units.append(load)

    objectives.append(("fairness-participation", "Regular-pool residents without call", sum(fairness_unassigned)))
    objectives.append(("fairness-max-two-units", "Call equivalents beyond two per resident", sum(three_unit_overload)))

    senior_midlevel_terms = [
        variable
        for (resident_id, _, position), variable in variables.items()
        if position == "mid-level" and resident_by_id[resident_id]["position"] == "senior"
    ]
    objectives.append((
        "senior-midlevel-coverage",
        "PGY-4/5 assignments covering mid-level call",
        sum(senior_midlevel_terms),
    ))
    objectives.append(("fairness-block-load", "Call units outside the achievable block range", sum(fairness_deviation)))

    historical_ranges: list[Any] = []
    for position in ("senior", "mid-level", "intern"):
        pool = [resident for resident in residents if resident["position"] == position and resident["regularPool"]]
        if len(pool) < 2:
            continue
        upper_bound = max(int(resident["historicalUnits"]) for resident in pool) + max_block_units
        maximum = model.new_int_var(0, upper_bound, f"historical_max_{position}")
        minimum = model.new_int_var(0, upper_bound, f"historical_min_{position}")
        for resident in pool:
            total = loads[resident["id"]] + int(resident["historicalUnits"])
            model.add(maximum >= total)
            model.add(minimum <= total)
        historical_ranges.append(maximum - minimum)
    objectives.append(("fairness-longitudinal", "Year-to-date burden spread", sum(historical_ranges)))
    objectives.append(("fairness-reserve", "NRV reserve call units", sum(reserve_units)))

    # EGS weekday restrictions are encoded in eligibleDates; these zero-valued
    # levels remain visible so the result mirrors the published hierarchy.
    objectives.append(("egs-chief", "EGS chief Sunday-only violations", 0))
    objectives.append(("egs-midlevel", "EGS mid-level weekend violations", 0))

    trauma_terms: list[Any] = []
    for resident in residents:
        trauma_slots = [
            slot_id
            for slot_id in resident["traumaChiefSlotIds"]
            if any(resident_id == resident["id"] and variable_slot_id == slot_id for resident_id, variable_slot_id, _ in variables)
        ]
        if not trauma_slots:
            continue
        trauma_vars_by_slot = {
            slot_id: [
                variable
                for (resident_id, variable_slot_id, _), variable in variables.items()
                if resident_id == resident["id"] and variable_slot_id == slot_id
            ]
            for slot_id in trauma_slots
        }
        count = sum(variable for slot_vars in trauma_vars_by_slot.values() for variable in slot_vars)
        delta = model.new_int_var(0, len(trauma_slots) + 2, f"trauma_count_delta_{resident['id']}")
        model.add_abs_equality(delta, count - 2)
        trauma_terms.append(delta)
        ordered = sorted(trauma_slots, key=lambda slot_id: slot_by_id[slot_id]["date"])
        for left, right in zip(ordered, ordered[1:]):
            if abs(days_ordinal(slot_by_id[left]) - days_ordinal(slot_by_id[right])) != 7:
                continue
            both = model.new_bool_var(f"trauma_back_to_back_{resident['id']}_{right}")
            left_assigned = sum(trauma_vars_by_slot[left])
            right_assigned = sum(trauma_vars_by_slot[right])
            model.add(both <= left_assigned)
            model.add(both <= right_assigned)
            model.add(both >= left_assigned + right_assigned - 1)
            trauma_terms.append(both)
    objectives.append(("trauma-chief", "Trauma-chief Friday target violations", sum(trauma_terms)))
    objectives.append(("approved-unavailable", "Approved unavailable violations", 0))

    append_call_off_request_objectives(
        objectives,
        "priority",
        problem.get("callOffRequestHierarchy", {}).get("priority", []),
        variables,
        slot_by_id,
    )

    same_day_split_terms: list[Any] = []
    for resident in residents:
        resident_id = resident["id"]
        for date, date_slot_ids in slots_by_date.items():
            date_vars = [
                variable
                for (variable_resident_id, slot_id, _), variable in variables.items()
                if variable_resident_id == resident_id and slot_id in date_slot_ids
            ]
            if len(date_vars) < 2:
                continue
            excess = model.new_int_var(0, len(date_vars) - 1, f"same_day_split_{resident_id}_{date}")
            model.add(excess >= sum(date_vars) - 1)
            same_day_split_terms.append(excess)
    objectives.append(("same-day-split", "Residents covering both holiday day and regular call", sum(same_day_split_terms)))

    same_weekend_terms: list[Any] = []
    for resident in residents:
        for weekend, weekend_slot_ids in slots_by_weekend.items():
            weekend_vars = [
                variable
                for (resident_id, slot_id, _), variable in variables.items()
                if resident_id == resident["id"] and slot_id in weekend_slot_ids
            ]
            if len(weekend_vars) < 2:
                continue
            excess = model.new_int_var(0, len(weekend_vars) - 1, f"same_weekend_{resident['id']}_{weekend}")
            model.add(excess >= sum(weekend_vars) - 1)
            same_weekend_terms.append(excess)
    objectives.append(("same-weekend", "Repeat call assignments in one weekend", sum(same_weekend_terms)))

    vacation_terms = assignment_terms(residents, variables, "vacationAdjacentDates")
    objectives.append(("vacation", "Vacation-adjacent call assignments", sum(vacation_terms)))

    same_service_terms: list[Any] = []
    for weekend, weekend_slot_ids in slots_by_weekend.items():
        service_resident_vars: dict[str, list[cp_model.IntVar]] = defaultdict(list)
        for resident in residents:
            slots_by_service: dict[str, list[str]] = defaultdict(list)
            for slot_id in weekend_slot_ids:
                date = slot_by_id[slot_id]["date"]
                service = resident["serviceByDate"].get(date, "")
                if service and any(
                    resident_id == resident["id"] and variable_slot_id == slot_id
                    for resident_id, variable_slot_id, _ in variables
                ):
                    slots_by_service[service].append(slot_id)
            for service, service_slot_ids in slots_by_service.items():
                service_used = model.new_bool_var(f"service_{safe(service)}_{resident['id']}_{weekend}")
                service_vars = [
                    variable
                    for (resident_id, slot_id, _), variable in variables.items()
                    if resident_id == resident["id"] and slot_id in service_slot_ids
                ]
                model.add(sum(service_vars) >= service_used)
                model.add(sum(service_vars) <= len(service_vars) * service_used)
                service_resident_vars[service].append(service_used)
        for service, service_used_vars in service_resident_vars.items():
            if len(service_used_vars) < 2:
                continue
            excess = model.new_int_var(0, len(service_used_vars) - 1, f"service_excess_{safe(service)}_{weekend}")
            model.add(excess >= sum(service_used_vars) - 1)
            same_service_terms.append(excess)
    objectives.append(("same-service", "Same-service residents sharing a call weekend", sum(same_service_terms)))

    cross_block_terms = assignment_terms(residents, variables, "crossBlockSaturdayDates")
    objectives.append(("cross-block-saturday", "Back-to-back cross-block Saturdays", sum(cross_block_terms)))
    append_call_off_request_objectives(
        objectives,
        "secondary",
        problem.get("callOffRequestHierarchy", {}).get("secondary", []),
        variables,
        slot_by_id,
    )

    baseline_by_slot = {
        (assignment_slot_id(item), item["callPosition"]): item["residentId"]
        for item in problem.get("baselineAssignments", [])
    }
    if baseline_by_slot:
        change_terms: list[Any] = []
        for slot in slots:
            slot_id = slot["id"]
            for position in ("senior", "mid-level", "intern"):
                baseline_resident = baseline_by_slot.get((slot_id, position))
                baseline_var = variables.get((baseline_resident, slot_id, position)) if baseline_resident else None
                change_terms.append(1 - baseline_var if baseline_var is not None else 1)
        objectives.append(("minimum-change", "Assignments changed from the current draft", sum(change_terms)))

    tie_break_terms = [
        variable * int(resident_by_id[resident_id]["tieBreakBySlot"][slot_id])
        for (resident_id, slot_id, _), variable in variables.items()
    ]
    objectives.append(("stable-tie-break", "Stable equal-score tie break", sum(tie_break_terms)))
    debug(f"objectives built={len(objectives)}")

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = int(problem.get("randomSeed", 37))
    objective_results: list[dict[str, Any]] = []
    best_values: dict[tuple[str, str, str], int] | None = None
    all_optimal = True

    for key, label, expression in objectives:
        remaining = deadline - time.monotonic()
        if remaining <= 0.02:
            all_optimal = False
            break
        solver.parameters.max_time_in_seconds = max(0.02, remaining)
        debug(f"solving {key} remaining={remaining:.3f}")
        model.minimize(expression)
        if best_values:
            if hasattr(model, "clear_hints"):
                model.clear_hints()
            for variable_key, value in best_values.items():
                model.add_hint(variables[variable_key], value)
        status = solver.solve(model)
        debug(f"solved {key} status={solver.status_name(status)} value={solver.objective_value}")
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if status == cp_model.INFEASIBLE:
                return infeasible_response(started, ["The configured hard constraints cannot all be satisfied."])
            all_optimal = False
            break
        value = int(round(solver.objective_value))
        optimal = status == cp_model.OPTIMAL
        objective_results.append({"key": key, "label": label, "value": value, "optimal": optimal})
        all_optimal = all_optimal and optimal
        best_values = {variable_key: int(solver.value(variable)) for variable_key, variable in variables.items()}
        if not isinstance(expression, int):
            model.add(expression == value)

    if best_values is None:
        return infeasible_response(started, ["The solver did not find a feasible schedule within the time limit."], "unknown")

    assignments = []
    for (resident_id, slot_id, position), value in best_values.items():
        if value != 1:
            continue
        slot = slot_by_id[slot_id]
        assignments.append({
            "date": slot["date"],
            "callPosition": position,
            "residentId": resident_id,
            **({"shift": "holiday-day"} if slot["shift"] == "holiday-day" else {}),
        })
    assignments.sort(key=lambda item: (item["date"], item.get("shift", "regular"), ("senior", "mid-level", "intern").index(item["callPosition"])))
    duration_ms = round((time.monotonic() - started) * 1000)
    return {
        "status": "optimal" if all_optimal and len(objective_results) == len(objectives) else "feasible",
        "optimalityProven": all_optimal and len(objective_results) == len(objectives),
        "engineVersion": ENGINE_VERSION,
        "durationMs": duration_ms,
        "objectives": objective_results,
        "assignments": assignments,
        "conflicts": [],
    }


def assignment_terms(
    residents: list[dict[str, Any]],
    variables: dict[tuple[str, str, str], cp_model.IntVar],
    field: str,
) -> list[cp_model.IntVar]:
    return [
        variable
        for resident in residents
        for (resident_id, slot_id, _), variable in variables.items()
        if resident_id == resident["id"] and slot_id.split(":", 1)[0] in resident[field]
    ]


def append_call_off_request_objectives(
    objectives: list[tuple[str, str, Any]],
    priority: str,
    tiers: list[dict[str, Any]],
    variables: dict[tuple[str, str, str], cp_model.IntVar],
    slot_by_id: dict[str, dict[str, Any]],
) -> None:
    if not tiers:
        objectives.append((f"{priority}-request", f"{priority.title()} call-off requests not honored", 0))
        return

    for tier in tiers:
        request_terms: list[tuple[Any, int]] = []
        for request in tier["requests"]:
            dates = set(request["dates"])
            expression = sum(
                variable
                for (resident_id, slot_id, _), variable in variables.items()
                if resident_id == request["residentId"] and slot_by_id[slot_id]["date"] in dates
            )
            request_terms.append((expression, int(request["timestampWeight"])))
        key = f"{priority}-request-{tier['key']}"
        label = f"{priority.title()} {tier['label']} call-off conflicts, weighted by submission time"
        objectives.append((key, label, sum(expression * weight for expression, weight in request_terms)))


def assignment_slot_id(assignment: dict[str, Any]) -> str:
    return f"{assignment['date']}:{assignment.get('shift', 'regular')}"


def days_ordinal(date_info: dict[str, Any]) -> int:
    return int(date_info["ordinal"])


def safe(value: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in value)


def infeasible_response(started: float, conflicts: list[str], status: str = "infeasible") -> dict[str, Any]:
    return {
        "status": status,
        "optimalityProven": status == "infeasible",
        "engineVersion": ENGINE_VERSION,
        "durationMs": round((time.monotonic() - started) * 1000),
        "objectives": [],
        "assignments": [],
        "conflicts": conflicts,
    }


def main() -> None:
    try:
        problem = json.load(sys.stdin)
        result = solve(problem)
        json.dump(result, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
    except Exception as error:  # pragma: no cover - surfaced to the Node wrapper
        json.dump({"error": f"{type(error).__name__}: {error}"}, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
        raise


if __name__ == "__main__":
    main()
