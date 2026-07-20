from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

GeneratedItemType = Literal["issue", "change", "decision"]


# "Generate ICD" (2026-07-20, per Maro) — the fifth stage of the schedule ->
# resources -> cost -> risk -> ICD pipeline. Same "frontend computes the
# catalog, backend validates/persists" split every other *_bulk_generate
# endpoint follows — but unlike risk_bulk_generate.py's one-shot
# dedupe-by-title-and-freeze, this is a genuine *rescan*: re-running it after
# the schedule moves should refresh only the items whose own discipline
# actually shifted, not leave every item frozen at its first-generation
# state forever (Maro: "it doesn't have to change all items just onces
# impacted").
#
# Decisions and Issue/Change watch-flags are deliberately different shapes
# (2026-07-20, per Maro, after discussing why Issues/Changes have no real
# schedule trigger the way a Decision does): a Decision carries a real
# required_by ("confirm the facade system before that work starts"); an
# Issue/Change watch-flag has no real date — it's a discipline-level
# placeholder to review/populate if that discipline's risk actually
# materialises, or dismiss if not — never presented as a real occurred
# issue or requested change. See frontend/src/modules/icd/icdGeneration.ts's
# own header for the exact catalog.
class BulkIcdItemInput(BaseModel):
    item_type: GeneratedItemType
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    # Only ever set for a Decision — an Issue/Change watch-flag has no real
    # trigger date and always leaves this null.
    required_by: date | None = None
    # Activity ids this item gates/relates to — reconciled into real
    # record_links rows (source_type=item_type, target_type="activity",
    # link_type="impacts") on every generate/regenerate call, per Maro's own
    # framing that these module items should be genuinely interlinked
    # (traceable causal chains), not isolated rows — see
    # icd_bulk_generate.py's own docstring for the reconciliation rule.
    linked_activity_ids: list[uuid.UUID] = []


class IcdBulkGenerateRequest(BaseModel):
    project_id: uuid.UUID
    period_id: uuid.UUID
    items: list[BulkIcdItemInput] = []


class IcdBulkGenerateResponse(BaseModel):
    created_count: int
    updated_count: int
    item_ids: list[uuid.UUID]
