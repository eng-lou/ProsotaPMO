from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.user_defined_field import (
    UdfEntityType,
    UserDefinedFieldDefinitionCreate,
    UserDefinedFieldDefinitionResponse,
    UserDefinedFieldDefinitionUpdate,
    UserDefinedFieldValueResponse,
    UserDefinedFieldValuesBulkFetch,
    UserDefinedFieldValueUpdate,
)
from app.services import user_defined_field as svc

router = APIRouter(prefix="/user-defined-fields", tags=["user-defined-fields"])


@router.get("/definitions", response_model=list[UserDefinedFieldDefinitionResponse])
async def list_definitions(
    project_id: uuid.UUID,
    entity_type: UdfEntityType,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_definitions(db, project_id, entity_type)


@router.post("/definitions", response_model=UserDefinedFieldDefinitionResponse, status_code=201)
async def create_definition(
    data: UserDefinedFieldDefinitionCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_definition(db, data)


@router.patch("/definitions/{definition_id}", response_model=UserDefinedFieldDefinitionResponse)
async def update_definition(
    definition_id: uuid.UUID,
    data: UserDefinedFieldDefinitionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Rename and/or change data type. Changing data type clears every
    existing value stored under this field — see
    app/services/user_defined_field.py:update_definition."""
    return await svc.update_definition(db, definition_id, data)


@router.delete("/definitions/{definition_id}", status_code=204)
async def delete_definition(
    definition_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_definition(db, definition_id)
    return Response(status_code=204)


@router.post("/values/bulk-fetch", response_model=list[UserDefinedFieldValueResponse])
async def list_values(
    data: UserDefinedFieldValuesBulkFetch,
    db: AsyncSession = Depends(get_db),
) -> list:
    """Bulk fetch for a grid page — one call for every visible UDF column x
    every visible row."""
    return await svc.list_values_for_records(db, data.field_definition_ids, data.record_ids)


@router.put("/values/{field_definition_id}/{record_id}", response_model=UserDefinedFieldValueResponse)
async def set_value(
    field_definition_id: uuid.UUID,
    record_id: uuid.UUID,
    data: UserDefinedFieldValueUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.set_value(db, field_definition_id, record_id, data)
