# Prosota Maritime Scope Statement

Version 1.0 · 17 October 2026

Status: User-approved product scope following review of the eight concept mockups. This statement defines the intended product, not a claim that its capabilities are already implemented. It takes precedence over conflicting mockup details and earlier prototype assumptions. MARITIME_BUILD.md records implementation history; this document governs the target scope.

## Purpose

Extend Prosota into an editable maritime project platform covering Smart Port Digital Twin, Maritime Safety Simulation and Maritime Infrastructure Delivery Intelligence. Reuse the existing architecture, model import and viewer, scheduling, 4D animation, resource, cost, risk, reporting and Poe functionality wherever applicable.

Users must be able to import their own models, create and edit project records, link assets, configure scenarios, run calculations, review results and produce reports. A representative terminal is optional starter content authored through the same tools available to users.

## Three workspaces

### Port Operations

Plan and simulate vessel calls, berth allocations, equipment assignments, yard capacity, gates and transport routes. Support editable workloads, arrival windows, processing rates, operating calendars, priorities and availability restrictions. Animate equipment and logistics according to calculated scenario states.

Tabs: Overview, Vessel Calls, Berths, Equipment, Yard & Gates, Results. Yard & Gates contains Yard, Gates and Routes. Equipment has Details, Performance and Maintenance views, expandable from the selected-asset inspector.

The initial complete workflow configures cargo and handling capacity, simulates a crane outage and compares completion time, throughput, queues, utilisation and cost. Capacity constraints must interact; additional crane capacity may move a bottleneck to transport, yard handling or gates.

### Safety and Training

Author and conduct interactive exercises in the shared environment. Configure locations, assets, hazards, exclusion zones, triggers, available actions and assessment criteria. Participants navigate and act within the scene; attempts record actions and support replay and debrief.

Tabs: Exercises, Setup, Run, Debrief. Action Log belongs to an attempt and its debrief. System events, participant actions and assessment criteria remain distinct. An automatic equipment stop must not be credited as a participant action.

The initial complete workflow is a configurable lifting-zone exercise with hazard identification, equipment interaction, area control and notification, followed by an evidence-based debrief. Exercise criteria are authored rules, not unsupported claims of safety certification.

### Infrastructure Delivery

Reuse Prosota Construction for maritime 4D/5D planning: imported or authored schedules, linked geometry, dependencies, calendars, resources, costs, risks, issues and decisions, animation profiles, baselines and reports.

Tabs: Schedule, Resources, Costs, Risks, Issues & Decisions. The initial complete workflow links a berth-extension model to a schedule and resource/cost assignments, then calculates and visualises a delay against a baseline using the existing engines.

## Shared application structure

| Location | Responsibility |
| --- | --- |
| Global header | Prosota Maritime, project selector, accurate save state, notifications and account |
| Workspace navigation | Port Operations, Safety & Training, Infrastructure Delivery |
| Shared sidebar | Project, Models & Assets, Scenarios, Reports, Poe |
| Workspace toolbar | Actions relevant to the current workspace |
| Main area | Scene, table, editor or report |
| Right inspector | Properties and actions for the selected record |
| Bottom panel | Related records, timelines and results; collapsible and expandable |

Shared tools retain the active workspace context. Returning to a scene preserves selection, camera and playback position where valid.

Project manages settings, units, currency, calendars, access and data sources. Models & Assets manages imports, asset records, geometry mappings, equipment configuration, properties and documents. Scenarios manages alternatives and saved runs. Reports assembles traceable outputs. Poe inspects records, invokes defined tools and presents reviewable proposed changes.

## Shared data and calculation rules

A model is imported geometry. An asset is a stable project record linked to one or more model elements. All workspaces refer to the same asset identifiers and relationships.

| Record | Meaning |
| --- | --- |
| Working plan | Current editable project plan |
| Baseline | Saved reference version |
| Scenario | Alternative inputs derived from a specified plan version |
| Run | Recorded execution using a specified input version |
| Results | Outputs belonging to that run |
| Exercise attempt | Recorded participant interaction with an exercise version |

Input changes mark earlier results as stale and require rerunning. Earlier runs retain their original inputs and assumptions. Reports and Poe cite the selected run rather than silently mixing versions.

Cross-workspace impacts require explicit links. Equipment downtime affects construction only where that equipment is assigned. Berth closures affect calls using that berth. Shared equipment assignments expose conflicts. Maintenance work orders can create planned availability restrictions and be assessed before adoption.

Use one canonical demonstration dataset across all views. Dates, currencies, rates, units, calendars, tables, charts, reports and Poe examples must agree. Synthetic, simulated and recorded data must be distinguishable. Missing actuals are not zero.

Define metric denominators and units: productive versus elapsed hours for crane rates; available-time basis for utilisation; TEU versus container count for yard capacity; working versus elapsed time for delay; rate basis for costs. Scenario cost impact is the difference from the selected reference without double-counting resource costs and allowances. Estimated risk exposure is distinct from a calculated scenario consequence.

## Interaction and presentation

Use one navigation system, logo, typography, spacing scale and icon family. Teal indicates selection and primary actions; status also uses text and icons. Red is reserved for errors, critical states and explicitly labelled demolition profiles.

Support full readable activity and asset names, resizable columns, filtering, sorting, keyboard navigation and appropriate bulk actions. Keep metrics relevant to the current task. Provide one clear primary action per panel.

Distinguish Reset playback, Restart attempt and Discard changes. Accurately show Unsaved, Saving, Saved and Save failed. Design empty, loading, error, stale-result and missing-link states. Apply consistent accessible contrast in light and dark themes, including dialogs.

Asset exploration supports selected-object inspection, locations, saved viewpoints and contextual hotspots. Visual fidelity depends on imported content and rendering performance; concept imagery is not evidence of available assets or functionality.

## Connected workflows

- Operations: configure demand/capacity, validate assignments, run, inspect bottlenecks, compare and adopt selected changes.
- Safety: author, validate triggers/criteria, preview, conduct attempt, review evidence and export debrief.
- Delivery: import/create schedule, link elements, assign resources/costs, calculate, sequence and compare baseline.
- Maintenance: create work order, schedule availability restriction, assess affected work and adopt the plan.

For example, a berth-extension activity can restrict an operating area, affect linked vessel capacity and define a safety exclusion zone. Each workspace presents the relevant consequence from shared inputs.

## MVP boundaries

Include editable persistent projects, model import and asset mapping, configurable scenarios, playback/reset/comparison, the three complete workflows above, actual calculation-driven dashboards, reports and tool-grounded Poe. Maintenance covers work orders, planned downtime and impacts. Use synthetic operational data initially.

Live AIS/IoT telemetry, predictive maintenance, advanced physical simulation, advanced human behaviour, VR hardware integration and certified training are future capabilities. Do not imply they exist through interface labels. Avoid unnecessary dependencies and rebuilding existing Prosota modules.

The Rockwell/iMakerXR Connected Vessel is a reference for spatial exploration, animation, location navigation and informative hotspots. Its published case study does not establish a live telemetry or operational simulation engine. Such presentation interaction complements, but does not replace, Prosota's calculated scenario workflows.

Reference: https://www.imakerxr.com/case-studies/fpso-connected-vessel/

## Acceptance criteria

1. Users can create, save and reopen projects, imports, asset links, plans, scenarios and exercises.
2. The terminal starter project uses the same authoring capabilities as user-created content.
3. Each scope demonstrates its complete workflow with configurable inputs and inspectable outputs.
4. Calculations are repeatable and respect capacities, calendars, dependencies and explicit cross-workspace links.
5. Playback, reset and comparison correspond to the selected run or attempt.
6. Charts, tables, reports and Poe agree with the saved data and reveal their assumptions and units.
7. Asset identity and context remain consistent across navigation and workspace changes.
8. Existing Construction import, scheduling, animation, resource, cost and reporting workflows pass appropriate regression checks.
9. Proposed, implemented and future capabilities are explicitly distinguished in delivery records.

Changes to these boundaries or major workflows require an explicit scope revision. Generated mockup inconsistencies do not independently expand the scope.
