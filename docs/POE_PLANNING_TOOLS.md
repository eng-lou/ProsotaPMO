# Poe planning proposals

Poe can read project-scoped planning records through `get_planning_records` (100 per page), and propose batches through `propose_planning_changes`. Only the user's review-card action calls `/ai/planning-approval`; the agent loop never executes this tool as a write.

Supported operations:
- Create/edit resources, including daily rates, material unit rates and lump sums.
- Create/edit calendars, unpaid breaks and dated exceptions/holidays.
- Edit existing activities: codes, hierarchy, durations, calendar, constraints, progress and commentary.
- Edit selected live schedule dates and recalculate CPM.
- Create/edit independent cost allowances. Existing resource assignment tools create linked schedule costs automatically; never duplicate those as manual allowances.

The existing tools still create WBS/activity hierarchies and relationships, resource assignments, risks, ICD records, dashboards and model links. P6 XML export remains the existing app action; these tools do not claim to export, baseline, level resources or run quality checks automatically.

## Brief-to-schedule sequence

1. Attach only the customer brief in a fresh conversation. Keep the expert brief outside the conversation for independent assessment.
2. Ask Poe to inspect the project and propose calendars/start date, documenting assumptions.
3. Approve the desired changes, then breaks/holidays and resource library/rates. New IDs are returned after saving.
4. Approve the WBS, milestones and linked activities. Generated IDs are returned to Poe.
5. Approve resource assignments, and any necessary activity constraints/codes and independent cost allowances.
6. Review computed dates, float, resource demand and package totals in the application. Export through the native P6 XML action and verify in P6.

Review cards begin unselected and show every proposed input. Select all is available, followed by explicit Apply. Failed items are reported separately; successful IDs are returned. Do not retry an entire batch after an ambiguous network failure: read saved records first to avoid duplicate creates.

## Boundaries

The server checks project ownership and record/reference scope for the new approval route. Input fields are restricted to a fixed registry backed by existing Pydantic schemas/services. No arbitrary HTTP/SQL/code, deletion, lock overrides or sign-off fields are exposed. Rates for time-based resources must use `day`, because the existing costing formula multiplies working days by rate; hourly quotations must be explicitly converted. Crew utilisation is not headcount. Resource rate updates resynchronise linked live costs.

This does not grant universal control of every Prosota feature. Baseline capture, P6 export, resource levelling and advanced quality checks still use their existing application controls. Full customer-brief completion and P6 round-trip require a live acceptance test; unit tests do not establish planning correctness.

## Resource context and interrupted conversations

`get_resource_planning_context` supplies a paginated combined view of activities (50), resources (100), existing assignments (500), per-activity IFC link counts/example labels, and the saved IFC file count. It exposes saved schedule quantities, not a fresh geometry take-off. Manual/brief/P6 schedules do not need IFC categories for Poe to propose assignments. Unlinked IFC geometry is not inspected by this server tool.

Approval-result messages are saved before calling the AI provider; completed read-tool exchanges are checkpointed too. After a failed generation, Resume conversation continues from an available checkpoint without re-running the approval handler. Read existing assignments before proposing another batch. The deterministic Resources-tab shortcuts still use IFC categories; their empty-state message directs other schedules to Poe.

Provider 429 messages distinguish known billing/credit limits from temporary request/token limits and show numeric Retry-After guidance when supplied. There is no automatic billing retry or bypass of account limits.
