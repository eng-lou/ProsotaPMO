from __future__ import annotations

# Tool registry (2026-08-31) — Anthropic tool-def shape (name/description/
# input_schema). Every future create-tool's input schema must stay
# restricted to the same manual fields the human-facing forms accept —
# never a derivable value (duration_days, rating, emv_cost, start/finish,
# is_critical, total_float_hours, ...) — this app's existing "never expose
# a derivable value as manual input" rule, applied here the same as
# everywhere else (Activity/Risk's own models document exactly which
# fields those are).
#
# 2026-09-01 (per Maro: "in one run include all the server/proposal and
# client tools needed") — every tool kind the original plan named now
# exists: get_project_snapshot/find_records/explain_causal_baseline (plain
# server reads), propose_create_risks/propose_create_activities/
# propose_link_records (proposal — PROPOSAL_TOOL_NAMES), and
# highlight_elements/isolate_elements/color_by_criteria/run_clash_detection
# (client — CLIENT_TOOL_NAMES, executed by the 4D module itself via
# AiFourDBridgeContext, only available at all while that module is
# mounted — see frontend/src/modules/fourD/aiFourDBridge.tsx's own header).
# explain_causal_baseline's own real-data caveat (checked directly against
# the dev DB, not assumed): every real RecordLink today is single-hop
# (issue/change/decision -> activity/cost_element) — the multi-hop BFS it
# runs is there for whenever richer linking data exists, not because
# today's data needs it.

TOOLS: list[dict] = [
    {
        "name": "get_project_snapshot",
        "description": (
            "Condensed cross-pillar stats for the current project: schedule "
            "project_start/project_finish dates, named milestones with their own "
            "dates, critical-path activity count and names; resources (assignment "
            "count and the top 10 most cost-committed resources by name/type); cost "
            "(portfolio BAC/AC/EAC/CPI/SPI — None where there's no cost-linked data "
            "yet, never a guessed figure); open risk count and EMV totals; open ICD "
            "item counts by type. Call this first to ground any answer about project "
            "status, dates, cost, or resourcing — never guess IDs, numbers, or dates."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    # propose_create_risks (2026-08-31, per Maro's own precedent pointer: "the
    # generate risk register button in risk register" — see
    # frontend/src/modules/risks/riskGeneration.ts's own DraftRisk and
    # backend/app/schemas/risk_bulk_generate.py's own BulkRiskInput, which
    # this input_schema deliberately mirrors field-for-field). Never executed
    # here — PROPOSAL_TOOL_NAMES below tells the orchestrator to stop the
    # loop and hand the raw drafts to the frontend instead (see
    # orchestrator.py's own pending_proposals branch), which renders one
    # card per draft and, only on explicit human approval, POSTs the
    # approved subset straight to the *existing* /risk-bulk-generate/
    # endpoint — the same dedupe-by-title and contingency-rollup behaviour
    # the button itself gets, never a second, bespoke creation path.
    {
        "name": "propose_create_risks",
        "description": (
            "Draft one or more risks for human review in the Risk Register — nothing is "
            "saved until the human explicitly approves each one. Use this whenever asked to "
            "identify or draft risks (from the schedule, a workshop, or an attached "
            "document) — never invent a way to write directly, you have no write access at "
            "all, only this reviewable-proposal path."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "risks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Short risk title."},
                            "category": {"type": "string", "description": "e.g. Cost, Schedule, Technical, Safety."},
                            "area": {"type": "string", "description": "e.g. Site, Vendor, Design."},
                            "risk_type": {"type": "string", "enum": ["threat", "opportunity"]},
                            "response_strategy": {
                                "type": "string",
                                "description": (
                                    "Threat: avoid/mitigate/transfer/escalate/accept. "
                                    "Opportunity: exploit/enhance/share/escalate/accept."
                                ),
                            },
                            "cause": {"type": "string"},
                            "effect": {"type": "string"},
                            "rationale": {"type": "string"},
                            "probability": {
                                "type": "number", "minimum": 0, "maximum": 1,
                                "description": "Qualitative likelihood (0-1) — never a computed rating.",
                            },
                            "impact": {
                                "type": "number", "minimum": 0, "maximum": 1,
                                "description": "Qualitative severity (0-1) — never a computed rating.",
                            },
                            "cost_most_likely": {
                                "type": "number",
                                "description": "Most-likely cost impact, positive magnitude — never a signed EMV.",
                            },
                            "schedule_most_likely_days": {
                                "type": "integer",
                                "description": "Most-likely schedule impact in days, positive magnitude — never a signed EMV.",
                            },
                        },
                        "required": ["title", "risk_type"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["risks"],
            "additionalProperties": False,
        },
    },
    # find_records (2026-09-01) — closes a real gap propose_link_records
    # otherwise has: RecordLink's own source_id/target_id must be real
    # existing UUIDs (see record_link.py's own docstring), and
    # get_project_snapshot only ever returns *names* for most record
    # types. This is the "never guess an ID" rule applied to a lookup step.
    {
        "name": "find_records",
        "description": (
            "Search for a record by name/title within one record type and get back its real "
            "id. Call this before propose_link_records or explain_causal_baseline whenever you "
            "don't already have a record's real id from get_project_snapshot — never invent or "
            "guess one. Returns up to 20 matches."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "record_type": {
                    "type": "string",
                    "enum": ["activity", "risk", "cost_element", "issue", "change", "decision"],
                },
                "query": {"type": "string", "description": "Partial or full name/title to search for."},
            },
            "required": ["record_type", "query"],
            "additionalProperties": False,
        },
    },
    # explain_causal_baseline (2026-09-01) — see record_tools.py's own
    # header for the real-data caveat (today's RecordLinks are single-hop
    # only) and why this is a fresh generic BFS, not a specific script —
    # nothing under app/services/ already traces a causal chain.
    {
        "name": "explain_causal_baseline",
        "description": (
            "Trace real RecordLink connections from one record outward (e.g. which Activities "
            "an Issue/Change/Decision impacts, or vice versa) up to a few hops, and return the "
            "actual chain of linked records with their real names — use this to explain *why* "
            "something is happening, grounded in real links, never an invented causal story. "
            "Call find_records first if you don't already have the starting record's real id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "record_type": {
                    "type": "string",
                    "enum": ["activity", "risk", "cost_element", "issue", "change", "decision"],
                },
                "record_id": {
                    "type": "string",
                    "description": "Real UUID of the starting record — from get_project_snapshot or find_records, never invented.",
                },
            },
            "required": ["record_type", "record_id"],
            "additionalProperties": False,
        },
    },
    # propose_create_activities (2026-09-01) — mirrors
    # backend/app/schemas/schedule_bulk_generate.py's own BulkActivityInput/
    # BulkRelationshipInput field-for-field (checked directly), scoped down
    # to the subset a schedule/workshop-drafting conversation would
    # actually supply — element_refs/quantity/material_* (IFC-linking
    # fields) are left out of this tool's own input on purpose, the same
    # "never let the model guess a field it has no real basis for" scoping
    # propose_create_risks's own subset of RiskCreate already follows.
    # temp_id/parent_temp_id/predecessor_temp_id/successor_temp_id are the
    # model's own scratch labels for cross-referencing *within this one
    # proposal* — never real ids, and never persisted as such (the real
    # /schedule-bulk-generate/ endpoint resolves them to real UUIDs at
    # creation time, same as the real "Generate Schedule" flow already
    # does).
    {
        "name": "propose_create_activities",
        "description": (
            "Draft one or more new schedule activities, optionally with predecessor logic "
            "between them, for human review — nothing is saved until explicitly approved. Use "
            "this whenever asked to add or draft activities or a chunk of schedule logic. "
            "Never state a start/finish/duration_days/float yourself — those are always "
            "CPM-computed once the approved activities are actually created."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activities": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "temp_id": {"type": "string", "description": "Your own scratch label, unique within this proposal only — never a real id."},
                            "task_name": {"type": "string"},
                            "parent_temp_id": {"type": "string", "description": "Another activity's temp_id to nest under; omit for a top-level activity."},
                            "duration_hours": {"type": "number", "description": "Working hours — never state duration_days/start/finish yourself."},
                            "activity_type": {"type": "string", "enum": ["task", "start_milestone", "finish_milestone"]},
                            "category": {"type": "string"},
                            "discipline": {"type": "string"},
                        },
                        "required": ["temp_id", "task_name"],
                        "additionalProperties": False,
                    },
                },
                "relationships": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "predecessor_temp_id": {"type": "string", "description": "A temp_id from the activities array above."},
                            "successor_temp_id": {"type": "string", "description": "A temp_id from the activities array above."},
                            "relationship_type": {"type": "string", "enum": ["FS", "SS", "FF", "SF"]},
                            "lag_hours": {"type": "number"},
                        },
                        "required": ["predecessor_temp_id", "successor_temp_id"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["activities"],
            "additionalProperties": False,
        },
    },
    # propose_link_records (2026-09-01) — mirrors
    # backend/app/schemas/record_link.py's own RecordLinkCreate
    # field-for-field. source_id/target_id must be real ids (find_records/
    # get_project_snapshot) — this tool has no way to invent one, and its
    # own review card (frontend) is expected to reject a proposal carrying
    # one that doesn't resolve to a real record.
    {
        "name": "propose_link_records",
        "description": (
            "Draft one or more links between two existing records (e.g. an Issue impacting an "
            "Activity, a Risk mitigated by a Decision) for human review — nothing is saved "
            "until explicitly approved. source_id/target_id must be real ids from "
            "get_project_snapshot or find_records — call find_records first if you don't "
            "already have them, never invent one."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "links": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_type": {
                                "type": "string",
                                "enum": ["activity", "risk", "cost_element", "issue", "change", "decision"],
                            },
                            "source_id": {"type": "string"},
                            "target_type": {
                                "type": "string",
                                "enum": ["activity", "risk", "cost_element", "issue", "change", "decision"],
                            },
                            "target_id": {"type": "string"},
                            "link_type": {"type": "string", "enum": ["causes", "impacts", "mitigates", "relates_to"]},
                            "note": {"type": "string"},
                        },
                        "required": ["source_type", "source_id", "target_type", "target_id", "link_type"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["links"],
            "additionalProperties": False,
        },
    },
    # highlight_elements / isolate_elements (2026-09-01) — client tools:
    # the backend never executes these (see CLIENT_TOOL_NAMES below), it
    # only stops the loop and hands the raw call to the frontend, which
    # resolves activity names to their linked 3D elements the same way
    # clicking an activity already does (FourD.tsx's own
    # selectedObjectIds/selectedExpressIds and isolatedObjectIds/
    # isolatedExpressIds state — checked directly, no new selection
    # primitives needed) and drives those same setters. Only present in
    # client_tools_available while the 4D module is actually mounted (see
    # aiFourDBridge.tsx) — the description tells Poe to say so plainly
    # rather than silently fail if asked for this outside 4D.
    {
        "name": "highlight_elements",
        "description": (
            "Highlight the 3D elements linked to one or more activities in the currently-open "
            "4D viewport. Only available while the 4D module is open — if you don't have this "
            "tool, tell the user to open 4D first rather than pretending to do it. Use real "
            "activity names/codes from get_project_snapshot or find_records, never invented ones."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_names": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Real activity names or codes to highlight the linked 3D elements for.",
                },
            },
            "required": ["activity_names"],
            "additionalProperties": False,
        },
    },
    {
        "name": "isolate_elements",
        "description": (
            "Isolate the 3D elements linked to one or more activities in the currently-open 4D "
            "viewport, hiding everything else. Only available while the 4D module is open — if "
            "you don't have this tool, tell the user to open 4D first. Use real activity "
            "names/codes, never invented ones."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_names": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["activity_names"],
            "additionalProperties": False,
        },
    },
    # color_by_criteria (2026-09-01) — deliberately scoped to the two REAL
    # colouring modes this app has (checked directly, 2026-09-01: no
    # generic "colour by arbitrary criteria" system exists anywhere in
    # Viewport3D.tsx — only two hardcoded modes, showVarianceColors/
    # showClashColors in viewerSettings.ts). Never claim a colouring
    # criterion beyond these two exist.
    {
        "name": "color_by_criteria",
        "description": (
            "Switch the 4D viewport's element colouring. Only two real modes exist — "
            "'variance' (colours by schedule variance vs baseline) and 'clash' (colours "
            "elements flagged by Clash Detective) — there is no free-form colour-by-arbitrary-"
            "criteria mode. Only available while the 4D module is open."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"mode": {"type": "string", "enum": ["variance", "clash", "off"]}},
            "required": ["mode"],
            "additionalProperties": False,
        },
    },
    # run_clash_detection (2026-09-01) — deliberately does NOT try to set
    # up a clash test blind. Checked directly, 2026-09-01: sceneClash.ts's
    # own findClashes needs pre-resolved ResolvedClashElement[] on both
    # sides, built from a Clash Detective Selection A/B (or Collection)
    # pairing that has to already exist — there's no "just test everything
    # against everything" fallback, and inventing one isn't this tool's
    # job. If nothing is configured, the frontend handler reports that
    # plainly instead of guessing what to test.
    {
        "name": "run_clash_detection",
        "description": (
            "Run the Clash Detective's already-configured Selection A vs Selection B test in "
            "the current 4D viewport and report the results. Requires a clash test to already "
            "be set up in the Clash Detective panel — if none is configured, this tells you "
            "that plainly rather than guessing what to test. Only available while the 4D "
            "module is open."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]

# The orchestrator treats any tool name in this set as "stop the loop,
# hand it to the frontend" instead of executing it inline — only ever
# actually offered to the model when frontend/src/modules/fourD/
# aiFourDBridge.tsx's own context is mounted (see PoePanel.tsx's own
# client_tools_available, orchestrator.py's own `tools` filter), since
# these only mean anything while the 4D module is open.
CLIENT_TOOL_NAMES: frozenset[str] = frozenset({
    "highlight_elements", "isolate_elements", "color_by_criteria", "run_clash_detection",
})

# Tools whose result is a structured proposal (no DB write) rather than a
# query result — the orchestrator stops the loop the same way it does for
# CLIENT_TOOL_NAMES, but returns these via pending_proposals instead of
# pending_client_tool_calls, since a human approving/rejecting a draft
# record is a fundamentally different frontend job than a viewport action.
PROPOSAL_TOOL_NAMES: frozenset[str] = frozenset({
    "propose_create_risks", "propose_create_activities", "propose_link_records",
})
