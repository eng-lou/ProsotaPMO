from __future__ import annotations

import uuid
from decimal import Decimal

from httpx import AsyncClient

from app.models.period import Period
from app.models.project import Project


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create(client: AsyncClient, project: Project, period: Period, **kwargs) -> dict:
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id),
        "period_id": str(period.id),
        **kwargs,
    })
    assert resp.status_code == 201, resp.json()
    return resp.json()


# ---------------------------------------------------------------------------
# Fixed elements — standard CRUD
# ---------------------------------------------------------------------------

async def test_create_fixed_element(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period,
        description="Substructure",
        element_group="Structure",
        budget="500000.00",
        actuals="250000.00",
    )
    assert el["element_type"] == "fixed"
    assert el["rate"] is None
    assert float(el["budget"]) == 500000.00
    assert el["computed_budget"] is None  # fixed elements have no computed value
    assert float(el["forecast"]) == 500000.00  # no progress assessed yet — budget is the best available forecast


async def test_list_cost_elements_by_project(client: AsyncClient, project: Project, live_period: Period):
    for desc in ["Substructure", "Superstructure", "Envelope"]:
        await _create(client, project, live_period, description=desc, budget="100000.00")

    resp = await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})
    assert resp.status_code == 200
    assert len(resp.json()) == 3


async def test_get_cost_element(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period, description="MEP", budget="200000.00")
    resp = await client.get(f"/api/v1/cost-elements/{el['id']}")
    assert resp.status_code == 200
    assert resp.json()["description"] == "MEP"


async def test_get_cost_element_not_found(client: AsyncClient):
    resp = await client.get(f"/api/v1/cost-elements/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_update_cost_element(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period, description="FF&E", budget="80000.00")
    resp = await client.patch(f"/api/v1/cost-elements/{el['id']}", json={
        "budget": "90000.00",
    })
    assert resp.status_code == 200
    assert float(resp.json()["budget"]) == 90000.00
    assert float(resp.json()["forecast"]) == 90000.00  # forecast IS the computed EAC/budget fallback, not a separate input
    assert resp.json()["description"] == "FF&E"  # unchanged


async def test_forecast_is_eac_once_progress_assessed(client: AsyncClient, project: Project, live_period: Period):
    """forecast is not a separate manual field — it's the same concept as EAC."""
    el = await _create(client, project, live_period,
        description="Piling", budget="400000.00", actuals="160000.00", pct_complete=50,
    )
    assert float(el["eac"]) == 320000.00
    assert float(el["forecast"]) == 320000.00


async def test_delete_cost_element(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period, description="External works")
    resp = await client.delete(f"/api/v1/cost-elements/{el['id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/cost-elements/{el['id']}")).status_code == 404


# ---------------------------------------------------------------------------
# General-tab field gaps (owner, status, scope/variance notes, QS sign-off)
# ---------------------------------------------------------------------------

async def test_create_element_with_general_fields(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period,
        description="Piling (CFA 300/600mm dia.)",
        element_group="Substructure",
        budget="354451.00",
        cost_owner="M. Azra",
        status="approved",
        scope_note="267nr CFA piles to 8.5m. Includes rig mobilisation, integrity testing.",
        variance_commentary="Rate revised £450→£576/nr at tender. Quantity 218→267nr.",
        qs_signoff_name="M. Azra",
        qs_signoff_date="2025-05-21",
    )
    assert el["cost_owner"] == "M. Azra"
    assert el["status"] == "approved"
    assert el["scope_note"] == "267nr CFA piles to 8.5m. Includes rig mobilisation, integrity testing."
    assert el["variance_commentary"] == "Rate revised £450→£576/nr at tender. Quantity 218→267nr."
    assert el["qs_signoff_name"] == "M. Azra"
    assert el["qs_signoff_date"] == "2025-05-21"


async def test_invalid_status_rejected(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "description": "Bad status",
        "status": "over_budget",  # not a valid workflow status — that's a computed variance band, not stored
    })
    assert resp.status_code == 422


async def test_update_general_fields(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period, description="Lifts", budget="242085.00")
    resp = await client.patch(f"/api/v1/cost-elements/{el['id']}", json={
        "cost_owner": "M&E Lead", "status": "cr_pending",
    })
    assert resp.status_code == 200
    assert resp.json()["cost_owner"] == "M&E Lead"
    assert resp.json()["status"] == "cr_pending"


# ---------------------------------------------------------------------------
# Percentage elements — core mechanic
# ---------------------------------------------------------------------------

async def test_percentage_element_computed_from_fixed_subtotal(
    client: AsyncClient, project: Project, live_period: Period
):
    """Prelims at 15% should compute against the live sum of fixed elements —
    forecast subtotal uses each fixed element's derived forecast (EAC once
    progress exists), not budget, so it must differ from the budget subtotal."""
    # Substructure: EV=200,000, CPI=200,000/160,000=1.25, EAC=400,000/1.25=320,000
    await _create(client, project, live_period, description="Substructure", budget="400000.00", actuals="160000.00", pct_complete=50)
    # Superstructure: EV=300,000, CPI=300,000/400,000=0.75, EAC=600,000/0.75=800,000
    await _create(client, project, live_period, description="Superstructure", budget="600000.00", actuals="400000.00", pct_complete=50)
    # Fixed subtotals: budget=1,000,000 | forecast(EAC)=1,120,000 | actuals=560,000

    prelims = await _create(client, project, live_period,
        description="Prelims",
        element_type="percentage",
        rate="0.15",  # 15%
    )
    assert prelims["element_type"] == "percentage"
    assert prelims["budget"] is None           # not stored
    assert float(prelims["computed_budget"]) == 150000.00    # 15% of 1,000,000
    assert float(prelims["computed_forecast"]) == 168000.00  # 15% of 1,120,000 (EAC subtotal, not budget)
    assert float(prelims["computed_actuals"]) == 84000.00     # 15% of 560,000


async def test_percentage_computed_value_updates_when_fixed_changes(
    client: AsyncClient, project: Project, live_period: Period
):
    """Computed value must reflect the current fixed subtotal, not a stored snapshot."""
    fixed = await _create(client, project, live_period, description="Works", budget="1000000.00")
    contingency = await _create(client, project, live_period,
        description="Construction Contingency",
        element_type="percentage",
        rate="0.04",  # 4%
    )
    assert float(contingency["computed_budget"]) == 40000.00  # 4% of 1,000,000

    # Update the fixed element budget
    await client.patch(f"/api/v1/cost-elements/{fixed['id']}", json={"budget": "2000000.00"})

    # Re-fetch the percentage element — computed value must have updated
    updated = (await client.get(f"/api/v1/cost-elements/{contingency['id']}")).json()
    assert float(updated["computed_budget"]) == 80000.00  # 4% of 2,000,000


async def test_multiple_percentage_elements_each_use_same_fixed_subtotal(
    client: AsyncClient, project: Project, live_period: Period
):
    """All on-costs apply to the same fixed subtotal, not to each other."""
    await _create(client, project, live_period, description="Base works", budget="1000000.00")

    on_costs = [
        ("Prelims", "0.15"),
        ("Construction Contingency", "0.04"),
        ("Design Contingency", "0.02"),
        ("OH&P", "0.056"),
        ("Insurance", "0.013"),
    ]
    results = {}
    for desc, rate in on_costs:
        el = await _create(client, project, live_period, description=desc, element_type="percentage", rate=rate)
        results[desc] = float(el["computed_budget"])

    assert results["Prelims"] == 150000.00
    assert results["Construction Contingency"] == 40000.00
    assert results["Design Contingency"] == 20000.00
    assert results["OH&P"] == 56000.00
    assert results["Insurance"] == 13000.00


async def test_list_includes_computed_values_for_percentage_elements(
    client: AsyncClient, project: Project, live_period: Period
):
    """List endpoint must return computed values, not nulls, for percentage elements."""
    await _create(client, project, live_period, description="Works", budget="500000.00")
    await _create(client, project, live_period, description="Prelims", element_type="percentage", rate="0.15")

    elements = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    pct = next(e for e in elements if e["element_type"] == "percentage")
    assert float(pct["computed_budget"]) == 75000.00  # 15% of 500,000


# ---------------------------------------------------------------------------
# NRM1 cascade — Overhead -> Design Fees -> Contingency (Risk-Derived) -> Inflation
# ---------------------------------------------------------------------------

async def test_nrm1_on_costs_cascade_in_order(client: AsyncClient, project: Project, live_period: Period):
    """The four recognised on-costs must each apply to the running total left
    by every on-cost before it in NRM1's own sequence — not all four to the
    same raw fixed subtotal in parallel (2026-07-27, per Maro's QS review:
    same percentages, correct order)."""
    await _create(client, project, live_period, description="Works", budget="3213814.00")

    overhead = await _create(client, project, live_period, description="Overhead", element_type="percentage", rate="0.05")
    fees = await _create(client, project, live_period, description="Design Fees", element_type="percentage", rate="0.08")
    risk = await _create(client, project, live_period, description="Contingency (Risk-Derived)", element_type="percentage", rate="0.045293")
    inflation = await _create(client, project, live_period, description="Inflation", element_type="percentage", rate="0.03")

    # Overhead: 5% of Works (3,213,814) — first in the sequence, unaffected by the cascade
    assert float(overhead["computed_budget"]) == 160690.70
    # Design Fees: 8% of Works + Overhead (3,374,504.70)
    assert float(fees["computed_budget"]) == 269960.38
    # Risk: 4.5293% of Works + Overhead + Fees (3,644,465.08)
    assert float(risk["computed_budget"]) == 165068.76
    # Inflation: 3% of Works + Overhead + Fees + Risk (3,809,533.84), last in the sequence
    assert float(inflation["computed_budget"]) == 114286.02


async def test_unrecognised_percentage_line_keeps_parallel_behaviour(
    client: AsyncClient, project: Project, live_period: Period
):
    """A custom on-cost with no known NRM1 position (not one of the four
    recognised descriptions) has no defined place in the sequence, so it
    keeps computing off the raw fixed subtotal alone, same as before the
    cascade existed — it must not silently insert itself into the NRM1 order
    or shift what Overhead/Fees/Risk/Inflation compute against."""
    await _create(client, project, live_period, description="Works", budget="1000000.00")
    overhead = await _create(client, project, live_period, description="Overhead", element_type="percentage", rate="0.05")
    custom = await _create(client, project, live_period, description="Insurance", element_type="percentage", rate="0.02")

    assert float(custom["computed_budget"]) == 20000.00     # 2% of Works alone, not Works + Overhead
    assert float(overhead["computed_budget"]) == 50000.00    # unaffected by the unrecognised line existing


async def test_nrm1_cascade_consistent_between_list_and_get(
    client: AsyncClient, project: Project, live_period: Period
):
    """The single-element GET must compute the exact same cascaded value the
    list endpoint does for the same element — one cascade implementation,
    not two independently-derived numbers."""
    await _create(client, project, live_period, description="Works", budget="1000000.00")
    await _create(client, project, live_period, description="Overhead", element_type="percentage", rate="0.05")
    fees = await _create(client, project, live_period, description="Design Fees", element_type="percentage", rate="0.08")

    listed = (await client.get("/api/v1/cost-elements/", params={"project_id": str(project.id)})).json()
    listed_fees = next(e for e in listed if e["id"] == fees["id"])
    fetched = (await client.get(f"/api/v1/cost-elements/{fees['id']}")).json()

    assert float(listed_fees["computed_budget"]) == float(fetched["computed_budget"]) == 84000.00  # 8% of 1,050,000


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

async def test_percentage_element_requires_rate(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "description": "Bad percentage",
        "element_type": "percentage",
        # rate intentionally omitted
    })
    assert resp.status_code == 422


async def test_fixed_element_rejects_rate(client: AsyncClient, project: Project, live_period: Period):
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id),
        "period_id": str(live_period.id),
        "description": "Fixed with rate",
        "element_type": "fixed",
        "rate": "0.15",
    })
    assert resp.status_code == 422


async def test_negative_rate_accepted_for_credit_elements(client: AsyncClient, project: Project, live_period: Period):
    """A percentage element can represent a genuine credit/deduction (e.g. MCD) — rate
    must allow negative values, not just positive on-costs."""
    await _create(client, project, live_period, description="Base works", budget="1000000.00")
    mcd = await _create(client, project, live_period,
        description="MCD Credit", element_type="percentage", rate="-0.0196", status="credit",
    )
    assert float(mcd["rate"]) == -0.0196
    assert float(mcd["computed_budget"]) == -19600.00


# ---------------------------------------------------------------------------
# Real Earned Value Management (Rita Mulcahy Ch. 9)
# ---------------------------------------------------------------------------

async def test_evm_computed_from_budget_actuals_and_pct_complete(
    client: AsyncClient, project: Project, live_period: Period
):
    """BAC=budget, AC=actuals, EV=BAC*pct_complete/100 — cost-side EVM only
    (CV=EV-AC, CPI=EV/AC, EAC=BAC/CPI, ETC=EAC-AC, VAC=BAC-EAC,
    TCPI=(BAC-EV)/(BAC-AC)). Schedule-side EVM (PV/EV/SV/SPI, Resources module
    Phase 3) stays null for a plain "manual" element with no linked activity to
    source a real time-phased planned value from — see test_cost_sync.py for the
    schedule-linked case where these actually populate."""
    el = await _create(client, project, live_period,
        description="Piling", budget="100000.00", actuals="80000.00", pct_complete=70,
    )
    assert float(el["cv"]) == -10000.00    # EV(70000) - AC(80000)
    assert el["sv"] is None
    assert el["spi"] is None
    assert float(el["cpi"]) == 0.875       # 70000 / 80000
    assert float(el["eac"]) == 114285.71   # BAC / CPI
    assert float(el["etc"]) == 34285.71    # EAC - AC
    assert float(el["vac"]) == -14285.71   # BAC - EAC
    assert float(el["tcpi"]) == 1.5        # (BAC-EV) / (BAC-AC)


async def test_evm_fields_null_without_pct_complete(client: AsyncClient, project: Project, live_period: Period):
    """No premature computation — EVM stays null until a real progress assessment exists."""
    el = await _create(client, project, live_period, description="Roofing", budget="50000.00", actuals="10000.00")
    assert el["cv"] is None
    assert el["cpi"] is None
    assert el["eac"] is None


async def test_bl_budget_null_and_bac_falls_back_to_live_budget_before_baseline(
    client: AsyncClient, project: Project, live_period: Period
):
    """2026-09-03, per Maro's domain correction: "the budget field in cost
    plan is a forecast... the baseline of the figures becomes the approved
    budget." Before any Cost Baseline has ever been assigned, bac falls back
    to the live budget — never a guessed/frozen number — and variance (which
    measures drift *since* an approval) stays null, since there's nothing
    approved yet to measure drift against."""
    el = await _create(client, project, live_period, description="Steelwork", budget="2150000.00")
    assert el["bl_budget"] is None
    assert float(el["bac"]) == 2150000.00
    assert el["variance"] is None

    resp = await client.patch(f"/api/v1/cost-elements/{el['id']}", json={"budget": "2290467.00"})
    assert resp.status_code == 200
    assert resp.json()["bl_budget"] is None
    assert float(resp.json()["bac"]) == 2290467.00  # still tracks the live, revised forecast
    assert resp.json()["variance"] is None


async def test_bl_budget_rejected_as_manual_input(client: AsyncClient, project: Project, live_period: Period):
    """bl_budget is server-managed, only ever set by assign_baseline — sending
    it directly should have no effect (same discipline as EAC/CPI)."""
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id), "period_id": str(live_period.id),
        "description": "Bad baseline", "budget": "100000.00", "bl_budget": "999999.00",
    })
    assert resp.status_code == 201
    assert resp.json()["bl_budget"] is None


async def test_assign_baseline_sets_bl_budget_and_variance(
    client: AsyncClient, project: Project, live_period: Period
):
    """Assigning a Cost Baseline is the only thing that ever sets bl_budget —
    the true BAC every EVM formula measures against from then on, with
    variance now showing real drift between the live (post-baseline-revised)
    budget and the approved figure. Percentage elements get bl_budget too
    (unlike the old, retired rev_a_baseline mechanism, which had no baseline
    concept for them at all) — CostBaselineItem.bac already resolved their
    cascaded figure once at capture time, so assign just copies it straight
    across, same as a fixed element."""
    fixed = await _create(client, project, live_period, description="Steelwork", budget="2150000.00")
    prelims = await _create(client, project, live_period, description="Prelims", element_type="percentage", rate="0.10")
    assert float(prelims["bac"]) == 215000.00  # 10% of the live 2,150,000, pre-baseline fallback

    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Approved Budget", "baseline_date": "2026-09-03",
    })).json()
    assign_resp = await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")
    assert assign_resp.status_code == 200

    # Live budget keeps moving after assignment — bac/variance now correctly
    # diverge from it, reflecting the approved figure instead.
    resp = await client.patch(f"/api/v1/cost-elements/{fixed['id']}", json={"budget": "2290467.00"})
    updated = resp.json()
    assert float(updated["bl_budget"]) == 2150000.00
    assert float(updated["bac"]) == 2150000.00  # the approved figure, not the revised live budget
    assert float(updated["variance"]) == 140467.00  # live budget (2,290,467) - bac (2,150,000)

    prelims_resp = await client.get(f"/api/v1/cost-elements/{prelims['id']}")
    prelims_updated = prelims_resp.json()
    assert float(prelims_updated["bl_budget"]) == 215000.00
    assert float(prelims_updated["bac"]) == 215000.00  # frozen — doesn't follow Steelwork's live revision
    # computed_budget (the live cascade) DOES follow Steelwork's revision, so
    # variance now shows real drift here too.
    assert float(prelims_updated["computed_budget"]) == 229046.70
    assert float(prelims_updated["variance"]) == 14046.70


async def test_unassign_baseline_clears_bl_budget(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period, description="Steelwork", budget="2150000.00")
    baseline = (await client.post("/api/v1/cost-baselines/", json={
        "period_id": str(live_period.id), "name": "Approved Budget", "baseline_date": "2026-09-03",
    })).json()
    await client.post(f"/api/v1/cost-baselines/{baseline['id']}/assign")

    unassign_resp = await client.post(f"/api/v1/cost-baselines/{baseline['id']}/unassign")
    assert unassign_resp.status_code == 200

    resp = await client.get(f"/api/v1/cost-elements/{el['id']}")
    assert resp.json()["bl_budget"] is None
    assert float(resp.json()["bac"]) == 2150000.00  # falls back to live budget again
    assert resp.json()["variance"] is None


async def test_cost_per_m2_computed_from_project_gfa(client: AsyncClient, project: Project, live_period: Period):
    await client.patch(f"/api/v1/projects/{project.id}", json={"gfa_m2": "17500.00"})
    el = await _create(client, project, live_period, description="Piling", budget="354451.00")
    assert float(el["cost_per_m2"]) == round(354451.00 / 17500.00, 2)


async def test_cost_per_m2_null_when_project_gfa_not_set(client: AsyncClient, project: Project, live_period: Period):
    """GFA is optional — not every project has a meaningful floor area."""
    el = await _create(client, project, live_period, description="Piling", budget="354451.00")
    assert el["cost_per_m2"] is None


async def test_comparison_variance_computed_from_budget_and_comparison_cost(client: AsyncClient, project: Project, live_period: Period):
    # 2026-07-18, per Maro: "make that another field so it could be another
    # projects costs... then the variance separate from the budget vs
    # forecast variance to simply show the difference" — comparison_cost is
    # a plain, independent benchmark figure; comparison_variance is just
    # budget - comparison_cost, distinct from `variance` (budget vs
    # rev_a_baseline) and `vac` (bac vs eac).
    el = await _create(client, project, live_period, description="Structures", budget="100000.00", comparison_cost="90000.00")
    assert float(el["comparison_cost"]) == 90000.00
    assert float(el["comparison_variance"]) == 10000.00


async def test_comparison_variance_null_without_comparison_cost(client: AsyncClient, project: Project, live_period: Period):
    el = await _create(client, project, live_period, description="Structures", budget="100000.00")
    assert el["comparison_cost"] is None
    assert el["comparison_variance"] is None


async def test_comparison_cost_update_does_not_unlink_schedule_element(client: AsyncClient, project: Project, live_period: Period):
    # Only a direct budget edit unlinks a schedule-sourced element (per
    # cost_sync.py's own docstring) — comparison_cost is metadata, same as
    # status/cost_owner/commentary, and must not trip that same guard.
    el = await _create(client, project, live_period, description="Structures", budget="100000.00")
    resp = await client.patch(f"/api/v1/cost-elements/{el['id']}", json={"comparison_cost": "95000.00"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "manual"  # was already manual; unaffected either way
    assert float(resp.json()["comparison_variance"]) == 5000.00


async def test_create_rejects_frozen_period(client: AsyncClient, project: Project, frozen_period: Period):
    resp = await client.post("/api/v1/cost-elements/", json={
        "project_id": str(project.id),
        "period_id": str(frozen_period.id),
        "description": "Should be rejected",
    })
    assert resp.status_code == 422
