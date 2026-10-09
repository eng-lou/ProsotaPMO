from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_db_user
from app.database import get_db
from app.models.equipment_rig import EquipmentRig
from app.schemas.equipment_rig import RigCreate, RigUpdate, RigResponse
from app.services.clash_access import owned_project

router = APIRouter(prefix='/equipment-rigs', tags=['equipment-rigs'])


@router.get('/', response_model=list[RigResponse])
async def list_rigs(project_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, project_id, user)
    return (await db.scalars(select(EquipmentRig).where(EquipmentRig.project_id == project_id))).all()


@router.post('/', response_model=RigResponse, status_code=201)
async def create_rig(data: RigCreate, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, data.project_id, user)
    row = EquipmentRig(project_id=data.project_id, model_ref=data.model_ref, name=data.name, definition=data.definition.model_dump(mode='json'))
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        raise HTTPException(409, 'This model already has an equipment rig')
    await db.commit()
    await db.refresh(row)
    return row


async def owned_rig(db, id, user):
    row = await db.scalar(select(EquipmentRig).where(EquipmentRig.id == id).with_for_update())
    if not row:
        raise HTTPException(404, 'Equipment rig not found')
    await owned_project(db, row.project_id, user)
    return row


@router.put('/{id}', response_model=RigResponse)
async def update_rig(id: UUID, data: RigUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned_rig(db, id, user)
    if row.version != data.version:
        raise HTTPException(409, 'Equipment rig changed in another tab. Reload before saving.')
    row.name, row.definition = data.name, data.definition.model_dump(mode='json')
    row.version += 1
    await db.commit()
    await db.refresh(row)
    return row


@router.delete('/{id}', status_code=204)
async def delete_rig(id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned_rig(db, id, user)
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)
