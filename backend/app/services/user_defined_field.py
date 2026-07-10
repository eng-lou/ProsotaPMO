from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.schemas.user_defined_field import (
    UserDefinedFieldDefinitionCreate,
    UserDefinedFieldDefinitionUpdate,
    UserDefinedFieldValueUpdate,
)


async def list_definitions(
    db: AsyncSession, project_id: uuid.UUID, entity_type: str
) -> list[UserDefinedFieldDefinition]:
    result = await db.execute(
        select(UserDefinedFieldDefinition).where(
            UserDefinedFieldDefinition.project_id == project_id,
            UserDefinedFieldDefinition.entity_type == entity_type,
        ).order_by(UserDefinedFieldDefinition.created_at)
    )
    return list(result.scalars().all())


async def create_definition(db: AsyncSession, data: UserDefinedFieldDefinitionCreate) -> UserDefinedFieldDefinition:
    definition = UserDefinedFieldDefinition(
        project_id=data.project_id, entity_type=data.entity_type, name=data.name, data_type=data.data_type,
    )
    db.add(definition)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=422,
            detail=f"A {data.entity_type} field named '{data.name}' already exists in this project.",
        ) from exc
    await db.refresh(definition)
    return definition


async def update_definition(
    db: AsyncSession, definition_id: uuid.UUID, data: UserDefinedFieldDefinitionUpdate
) -> UserDefinedFieldDefinition:
    """Rename and/or change the data type of an existing definition
    (2026-07-07, per Maro). Changing data_type clears every existing value
    under it first — a value stored under the old type's column (e.g.
    value_text) has no meaningful equivalent under a different one (e.g.
    value_date), so leaving them in place would just mean stale, wrong-column
    data nothing ever reads again. The frontend is expected to warn the user
    before sending a data_type change for a field that already has values
    (same "confirm, then proceed" discipline as other destructive actions in
    this app), but this is enforced here regardless of whether the frontend
    warned, since it's the only way the data stays consistent."""
    definition = await db.get(UserDefinedFieldDefinition, definition_id)
    if definition is None:
        raise HTTPException(status_code=404, detail="User defined field not found")
    entity_type = definition.entity_type  # captured before any commit/rollback expires the ORM object

    if data.name is not None:
        definition.name = data.name
    if data.data_type is not None and data.data_type != definition.data_type:
        await db.execute(sa_delete(UserDefinedFieldValue).where(UserDefinedFieldValue.field_definition_id == definition_id))
        definition.data_type = data.data_type

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=422,
            detail=f"A {entity_type} field named '{data.name}' already exists in this project.",
        ) from exc
    await db.refresh(definition)
    return definition


async def delete_definition(db: AsyncSession, definition_id: uuid.UUID) -> None:
    definition = await db.get(UserDefinedFieldDefinition, definition_id)
    if definition is None:
        raise HTTPException(status_code=404, detail="User defined field not found")
    await db.delete(definition)  # UserDefinedFieldValue rows cascade via the FK's ON DELETE CASCADE
    await db.commit()


async def list_values_for_records(
    db: AsyncSession, field_definition_ids: list[uuid.UUID], record_ids: list[uuid.UUID]
) -> list[UserDefinedFieldValue]:
    """Bulk fetch for a grid page — one query for every UDF column x every
    visible row, same "attach in bulk, not per-row" shape as
    app/services/activity.py:_attach_evm_fields."""
    if not field_definition_ids or not record_ids:
        return []
    result = await db.execute(
        select(UserDefinedFieldValue).where(
            UserDefinedFieldValue.field_definition_id.in_(field_definition_ids),
            UserDefinedFieldValue.record_id.in_(record_ids),
        )
    )
    return list(result.scalars().all())


async def set_value(
    db: AsyncSession, field_definition_id: uuid.UUID, record_id: uuid.UUID, data: UserDefinedFieldValueUpdate
) -> UserDefinedFieldValue:
    """Upserts one record's value under one definition. Validates that
    whichever of value_text/value_number/value_date/value_indicator is set
    (the schema itself already guarantees at most one is) actually matches
    the target definition's own data_type — e.g. a text value against a
    'cost' field is rejected here, not silently stored in the wrong column."""
    definition = await db.get(UserDefinedFieldDefinition, field_definition_id)
    if definition is None:
        raise HTTPException(status_code=404, detail="User defined field not found")

    expected_column = {
        "text": "value_text", "number": "value_number", "integer": "value_number", "cost": "value_number",
        "start_date": "value_date", "finish_date": "value_date", "indicator": "value_indicator",
    }[definition.data_type]
    provided = {
        "value_text": data.value_text, "value_number": data.value_number,
        "value_date": data.value_date, "value_indicator": data.value_indicator,
    }
    other_fields_set = [k for k, v in provided.items() if v is not None and k != expected_column]
    if other_fields_set:
        raise HTTPException(
            status_code=422,
            detail=f"'{definition.name}' is a {definition.data_type} field — expected {expected_column}, "
                   f"got {', '.join(other_fields_set)} instead.",
        )
    if definition.data_type == "integer" and data.value_number is not None and data.value_number % 1 != 0:
        raise HTTPException(status_code=422, detail=f"'{definition.name}' is an integer field — {data.value_number} isn't a whole number.")

    result = await db.execute(
        select(UserDefinedFieldValue).where(
            UserDefinedFieldValue.field_definition_id == field_definition_id,
            UserDefinedFieldValue.record_id == record_id,
        )
    )
    value = result.scalar_one_or_none()
    if value is None:
        value = UserDefinedFieldValue(field_definition_id=field_definition_id, record_id=record_id)
        db.add(value)
    value.value_text = data.value_text
    value.value_number = data.value_number
    value.value_date = data.value_date
    value.value_indicator = data.value_indicator

    await db.commit()
    await db.refresh(value)
    return value
