from fastapi import APIRouter, Depends

from app.ai.maritime import maritime_turn
from app.core.auth import require_ai_quota
from app.schemas.maritime import DeliveryScenario, MaritimePoeRequest
from app.services.maritime import delivery_results

router = APIRouter(prefix='/maritime', tags=['maritime'])


@router.post('/delivery/calculate')
def calculate(data: DeliveryScenario):
    # Public, bounded synthetic calculation. No DB, private project IDs or paid AI.
    return delivery_results(data)


@router.post('/poe')
async def poe(data: MaritimePoeRequest, _user=Depends(require_ai_quota)):
    return await maritime_turn(data)
