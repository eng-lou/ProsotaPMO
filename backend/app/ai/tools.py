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
                    "enum": ["activity", "risk", "cost_element", "issue", "change", "decision", "resource"],
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
    # find_relationships (2026-09-01, per Maro: "if i ask poe to reassign
    # relationships... how best to describe for best results" — a real gap:
    # propose_create_activities's own `relationships` field only ever wires
    # together temp_ids from brand-new activities in the *same* proposal,
    # never an existing schedule's real links. "Reassign" is delete-then-
    # recreate (ActivityRelationshipUpdate's own docstring — predecessor_id/
    # successor_id aren't editable in place), so Poe needs this to find the
    # real relationship_id to remove before propose_edit_relationships can
    # remove+add one, same "never guess an id" rule as find_records.
    {
        "name": "find_relationships",
        "description": (
            "Look up one activity's own real predecessor/successor relationships (with their "
            "real relationship ids) — call this before propose_edit_relationships whenever "
            "removing or reassigning an existing link, since a relationship can only be removed "
            "by its real id, never guessed from the two activity names alone."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_id": {"type": "string", "description": "Real activity UUID from get_project_snapshot or find_records."},
            },
            "required": ["activity_id"],
            "additionalProperties": False,
        },
    },
    # propose_edit_relationships (2026-09-01) — mirrors
    # backend/app/schemas/activity_relationship.py's own
    # ActivityRelationshipCreate field-for-field for "add"; "remove" only
    # ever needs the real relationship_id (from find_relationships). Real
    # server-side validation (cycle detection, WBS-summary rejection,
    # milestone-type rules, duplicate/reverse-pair checks — all in
    # app/services/activity_relationship.py's own create_relationship,
    # checked directly) already exists and runs unconditionally on
    # approval; this tool doesn't re-implement any of it, it only shapes
    # the draft for review.
    {
        "name": "propose_edit_relationships",
        "description": (
            "Draft adding and/or removing schedule relationships between EXISTING activities, "
            "for human review — nothing is saved until explicitly approved. Use this for "
            "'reassign this relationship' (propose removing the old one by its real "
            "relationship_id from find_relationships, and adding the new one in the same "
            "proposal) or for linking/unlinking already-real activities. predecessor_id/"
            "successor_id/relationship_id must be real ids from get_project_snapshot, "
            "find_records, or find_relationships — never invented. This is NOT for relationships "
            "between activities you're drafting in the same conversation — use "
            "propose_create_activities' own relationships field for that instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "operations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string", "enum": ["add", "remove"]},
                            "predecessor_id": {"type": "string", "description": "Required for action=add. Real activity UUID."},
                            "predecessor_name": {"type": "string", "description": "The predecessor's real task_name — for display in the review card only, not saved."},
                            "successor_id": {"type": "string", "description": "Required for action=add. Real activity UUID."},
                            "successor_name": {"type": "string", "description": "The successor's real task_name — for display in the review card only, not saved."},
                            "relationship_type": {"type": "string", "enum": ["FS", "SS", "FF", "SF"]},
                            "lag_hours": {"type": "number"},
                            "relationship_id": {"type": "string", "description": "Required for action=remove. Real relationship UUID from find_relationships."},
                        },
                        "required": ["action"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["operations"],
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
    # propose_create_resource_assignments (2026-09-02, per Maro: "can poe
    # also work on resources" — a real gap: get_project_snapshot already
    # reads resource/committed-cost data, but no proposal tool could ever
    # create a ResourceAssignment; Risk and Scheduling both had create
    # support, Resources didn't). Mirrors
    # backend/app/schemas/resource.py's own ResourceAssignmentCreate
    # field-for-field. resource_id/activity_id must be real ids —
    # find_records now supports record_type="resource" specifically to
    # close this (see that tool's own updated enum + record_tools.py).
    {
        "name": "propose_create_resource_assignments",
        "description": (
            "Draft one or more resource assignments (assigning a Resource to an Activity) for "
            "human review — nothing is saved until explicitly approved. Call find_records with "
            "record_type='resource' and record_type='activity' first to resolve real ids from "
            "names — never invent one. Which of quantity/utilisation_pct to set depends on the "
            "resource's own type (check get_project_snapshot's resources or ask if unsure): "
            "labour/equipment/crew use utilisation_pct (0-100, % of the activity's own duration "
            "spent on this); material uses quantity (e.g. 267 for '267 piles'); subcontractor "
            "uses neither (its budget is always a flat rate, set at the resource itself)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "assignments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "activity_id": {"type": "string", "description": "Real activity UUID from get_project_snapshot or find_records."},
                            "activity_name": {"type": "string", "description": "The activity's real task_name — display only, not saved."},
                            "resource_id": {"type": "string", "description": "Real resource UUID from find_records(record_type='resource')."},
                            "resource_name": {"type": "string", "description": "The resource's real name — display only, not saved."},
                            "role": {"type": "string", "description": "Free text, e.g. 'Site Engineer' — independent of the resource's own name."},
                            "quantity": {"type": "number", "description": "Material resources only."},
                            "utilisation_pct": {"type": "number", "minimum": 0, "maximum": 100, "description": "Labour/equipment/crew only."},
                        },
                        "required": ["activity_id", "resource_id"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["assignments"],
            "additionalProperties": False,
        },
    },
    # propose_create_dashboard_layout (2026-09-02, per Maro: "I want Poe to
    # be able to create widgets based on the prompts... a new empty layout
    # and create widgets... based on those requests if it doesn't already
    # exist in the template" — round 1 of that ask, per the agreed split:
    # flexibility on the EXISTING 45+ widgets (an optional filter, see
    # frontend widgets.tsx's own WidgetProps.filter header) rather than a
    # new generic/custom widget type, which stays a later round). Mirrors
    # dashboard_layout.py's own DashboardLayoutCreate — approval POSTs
    # straight to the real /dashboard-layouts/ endpoint, which always
    # creates inactive (never auto-applied, matching every other
    # proposal's "review before it affects anything real" shape). Grid
    # x/y/w/h are deliberately NOT part of this schema — PoePanel.tsx's
    # own approval handler auto-stacks widgets top-to-bottom using each
    # one's own WIDGET_REGISTRY.defaultSize, the same registry
    # DashboardGrid.tsx itself already uses for "add widget" — Poe has no
    # reason to guess grid coordinates a human would immediately want to
    # rearrange anyway.
    {
        "name": "propose_create_dashboard_layout",
        "description": (
            "Draft a new, named Reporting & Controls dashboard layout for human review — "
            "nothing is saved until explicitly approved, and creating one never changes what's "
            "currently displayed (a new layout is never auto-applied; the human applies it "
            "themselves from the layout picker once happy with it). Use this when asked to "
            "build a custom dashboard view out of EXISTING widgets, e.g. \"a dashboard showing "
            "just Cost risks and labour resource assignments\" (two widgets: risk_register_table "
            "filtered risk_type='threat' won't work — 'Cost risks' means category, not type — "
            "so category='Cost'; resource_assignments_table filtered resource_type='labour'). "
            "If what's asked for genuinely isn't expressible with any existing widget_type even "
            "with a filter, say so plainly — there is no way to invent a new widget type yet. "
            "Five widget types currently accept an optional filter (any other widget_type must "
            "omit filter entirely — an unrecognised key on a non-filterable widget is silently "
            "ignored, not an error, so don't guess one where none applies):\n"
            "- top_risks, risk_register_table: filter={risk_type: 'threat'|'opportunity'} "
            "and/or (risk_register_table only) {category: '<exact category text, e.g. from "
            "get_project_snapshot — never guessed>'}\n"
            "- cost_elements_table: filter={element_group: '<exact group text, never guessed>'}\n"
            "- resource_assignments_table: filter={resource_type: 'labour'|'equipment'|"
            "'material'|'subcontractor'|'cost'|'crew'}\n"
            "- open_items_by_owner: filter={item_type: 'issue'|'change'|'decision'}"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "A short, descriptive layout name — shown in the layout picker."},
                "widgets": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "widget_type": {
                                "type": "string",
                                "enum": [
                                    "kpi_strip", "schedule_performance", "risk_overview", "milestone_timeline",
                                    "risk_exposure", "top_risks", "float_distribution", "activities_by_category",
                                    "baseline_variance_table", "milestones_table", "critical_activities_table",
                                    "risks_by_category", "risks_by_owner", "threats_vs_opportunities",
                                    "response_strategy_breakdown", "risk_register_table", "cost_breakdown_by_group",
                                    "cost_breakdown_by_owner", "budget_utilisation", "bac_vs_eac_by_group",
                                    "cost_elements_table", "issues_by_status", "issues_ageing_table",
                                    "open_items_by_owner", "decisions_pending_table", "changes_by_ccb_decision",
                                    "resource_budget_by_type", "resource_budget_by_discipline",
                                    "resource_budget_by_company", "resource_assignments_table",
                                    "top_resources_by_budget", "dcma_score", "clash_summary", "clash_detail_table",
                                    "eac_forecast_comparison", "earned_value_summary_table",
                                    "near_critical_watch_list", "activity_status", "project_info",
                                    "camera_view_gallery", "fourd_video_gallery", "lookahead_planner",
                                    "mitigation_actions_table", "risk_ageing_table", "project_narrative",
                                ],
                            },
                            "filter": {
                                "type": "object",
                                "additionalProperties": {"type": "string"},
                                "description": "Only for the 5 filterable widget types listed above — omit entirely otherwise.",
                            },
                        },
                        "required": ["widget_type"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["name", "widgets"],
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
    # propose_link_elements (2026-09-01, per Maro: "can poe assign elements
    # to an activity" — a real gap: unlike RecordLink/propose_link_records,
    # ModelElementLink's own element_ref is an opaque IFC GlobalId or mesh
    # filename (checked directly, model_element_link.py's own schema) —
    # nothing a user would ever type in chat, and nothing Poe could resolve
    # from a name the way find_records resolves an Activity/Risk/ICD title.
    # The only real source of truth for "which elements" is the live 4D
    # viewport's own current selection, so this tool's `elements` array must
    # come verbatim from a prior get_selected_elements call (that client
    # tool's own header explains why) — never invented, never guessed from
    # an element's visible name in the model.
    {
        "name": "propose_link_elements",
        "description": (
            "Draft assigning the 3D elements CURRENTLY SELECTED in the 4D viewport to an "
            "activity, for human review — nothing is saved until explicitly approved. You must "
            "call get_selected_elements first and pass its own `elements` array through here "
            "verbatim — there is no other way to identify which elements, since an element's "
            "real id (IFC GlobalId or mesh filename) isn't something you can see or guess from "
            "chat alone. If get_selected_elements returns nothing selected, tell the user to "
            "select the elements in the 4D viewport first rather than proposing an empty link."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "activity_id": {"type": "string", "description": "Real activity UUID from get_project_snapshot or find_records."},
                "activity_name": {"type": "string", "description": "The activity's real task_name — for display in the review card only, not saved."},
                "elements": {
                    "type": "array",
                    "description": "Verbatim from get_selected_elements's own `elements` result — never invented.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_kind": {"type": "string", "enum": ["ifc", "mesh", "ifc_split"]},
                            "element_ref": {"type": "string"},
                            "element_label": {"type": "string"},
                        },
                        "required": ["source_kind", "element_ref", "element_label"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["activity_id", "elements"],
            "additionalProperties": False,
        },
    },
    # get_selected_elements (2026-09-01) — client tool: the backend never
    # executes this, it only stops the loop and hands the raw call to the
    # frontend, which resolves the CURRENT selectedObjectIds/
    # selectedExpressIds into real (source_kind, element_ref, element_label)
    # triples via collectionResolvers.ts's own resolveSelectionToMemberRefs
    # — the exact same resolver FourD.tsx's own "bulk link selected
    # elements to an activity" toolbar action already uses, not a new
    # resolution path. Read-only (no DB write, unlike propose_link_elements
    # right above) — reports live selection state, doesn't create anything.
    {
        "name": "get_selected_elements",
        "description": (
            "Read which 3D elements are currently selected in the 4D viewport, resolved to their "
            "real (source_kind, element_ref, element_label) identity. Call this before "
            "propose_link_elements whenever asked to assign/link elements to an activity — there "
            "is no way to identify specific elements from chat text alone; the user must select "
            "them in the viewport first. Only available while the BIM, Simulations & Reality Capture module is open."
        ),
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    # propose_clash_test (2026-09-01, per Maro: "perform a clash test and
    # show between all columns and L2 beams", then, once told the tool
    # gap, describing the real desired flow himself: "select the requested
    # elements, put them in their respective collections then run the
    # clash test on those collections then show with the clash color
    # toggled"). A clash test's own Group A/B (ClashTestBase's own
    # group_a_collection_id/group_b_collection_id, checked directly) are
    # real Collections, not an ad-hoc live selection — so this needs BOTH
    # groups' elements identified via get_selected_elements (once per
    # group; ask the user to select Group A, capture it, then select
    # Group B, capture that too) before it can even be drafted. On
    # approval the frontend creates both real Collections, creates the
    # real ClashTest referencing them, and actually runs it client-side
    # (clash geometry computation needs the live loaded model — this is
    # NOT a plain DB write like every other proposal tool) — see
    # aiFourDBridge.tsx's own execute_clash_test_proposal for the "why"
    # this one specific proposal's approval action runs through the
    # bridge instead of a plain REST call. Once this returns a real
    # clash_test_id and results, follow up with color_by_criteria(mode=
    # 'clash') to actually show them, per Maro's own "show with the clash
    # color toggled" — that tool already exists, no new one needed.
    {
        "name": "propose_clash_test",
        "description": (
            "Draft creating two Collections from two already-selected element groups, then "
            "creating and running a clash test between them, for human review — nothing is "
            "saved until explicitly approved. You must call get_selected_elements TWICE — once "
            "after asking the user to select Group A's elements in the 4D viewport, once after "
            "asking them to select Group B's — and pass each result through here verbatim as "
            "group_a_elements/group_b_elements. There is no other way to identify 'all columns' "
            "or similar groups; nothing lets you resolve that from an IFC type or name alone. "
            "Once approved, the tool_result reports real clash counts — follow up with "
            "color_by_criteria(mode='clash') to actually show them in the viewport, if asked to."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "group_a_name": {"type": "string", "description": "Short display name for Group A, e.g. 'Columns'."},
                "group_a_elements": {
                    "type": "array",
                    "description": "Verbatim from get_selected_elements — never invented.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_kind": {"type": "string", "enum": ["ifc", "mesh", "ifc_split"]},
                            "element_ref": {"type": "string"},
                            "element_label": {"type": "string"},
                        },
                        "required": ["source_kind", "element_ref", "element_label"],
                        "additionalProperties": False,
                    },
                },
                "group_b_name": {"type": "string", "description": "Short display name for Group B, e.g. 'Level 2 Beams'."},
                "group_b_elements": {
                    "type": "array",
                    "description": "Verbatim from a second get_selected_elements call — never invented.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_kind": {"type": "string", "enum": ["ifc", "mesh", "ifc_split"]},
                            "element_ref": {"type": "string"},
                            "element_label": {"type": "string"},
                        },
                        "required": ["source_kind", "element_ref", "element_label"],
                        "additionalProperties": False,
                    },
                },
                "test_name": {"type": "string", "description": "Optional — defaults to '<Group A> vs <Group B>'."},
                "tolerance_mm": {"type": "number", "description": "Optional clearance tolerance in mm — 0 for a hard clash test (the default)."},
            },
            "required": ["group_a_name", "group_a_elements", "group_b_name", "group_b_elements"],
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
            "4D viewport. Only available while the BIM, Simulations & Reality Capture module is open — if you don't have this "
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
            "viewport, hiding everything else. Only available while the BIM, Simulations & Reality Capture module is open — if "
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
            "criteria mode. Only available while the BIM, Simulations & Reality Capture module is open."
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
# these only mean anything while the BIM, Simulations & Reality Capture module is open.
CLIENT_TOOL_NAMES: frozenset[str] = frozenset({
    "highlight_elements", "isolate_elements", "color_by_criteria", "run_clash_detection", "get_selected_elements",
})

# Tools whose result is a structured proposal (no DB write) rather than a
# query result — the orchestrator stops the loop the same way it does for
# CLIENT_TOOL_NAMES, but returns these via pending_proposals instead of
# pending_client_tool_calls, since a human approving/rejecting a draft
# record is a fundamentally different frontend job than a viewport action.
PROPOSAL_TOOL_NAMES: frozenset[str] = frozenset({
    "propose_create_risks", "propose_create_activities", "propose_link_records",
    "propose_edit_relationships", "propose_link_elements", "propose_clash_test",
    "propose_create_resource_assignments", "propose_create_dashboard_layout",
})
