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
# get_project_snapshot (read) and propose_create_risks (proposal) exist so
# far. CLIENT_TOOL_NAMES stays empty and PROPOSAL_TOOL_NAMES has just the
# one until later phases add propose_create_activities/propose_link_records
# (more server proposal tools) and highlight_elements/isolate_elements/
# color_by_criteria/run_clash_detection (client tools).

TOOLS: list[dict] = [
    {
        "name": "get_project_snapshot",
        "description": (
            "Condensed cross-pillar stats for the current project: schedule "
            "project_start/project_finish dates, named milestones with their own "
            "dates, critical-path activity count and names, open risk count and "
            "EMV totals, open ICD item counts by type. Call this first to ground "
            "any answer about project status, dates, or completion — never guess "
            "IDs, numbers, or dates."
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
]

# Populated by later phases (see the approved plan) — the orchestrator
# treats any tool name in this set as "stop the loop, hand it to the
# frontend" instead of executing it inline.
CLIENT_TOOL_NAMES: frozenset[str] = frozenset()

# Tools whose result is a structured proposal (no DB write) rather than a
# query result — the orchestrator stops the loop the same way it does for
# CLIENT_TOOL_NAMES, but returns these via pending_proposals instead of
# pending_client_tool_calls, since a human approving/rejecting a draft
# record is a fundamentally different frontend job than a viewport action.
PROPOSAL_TOOL_NAMES: frozenset[str] = frozenset({"propose_create_risks"})
