"""Read-only tools for the authenticated project's saved Maritime evidence."""
from uuid import UUID
from sqlalchemy import select
from fastapi.encoders import jsonable_encoder
from app.models.maritime_workspace import MaritimeWorkspace, MaritimeRun

TOOL = {
    'name': 'get_maritime_context',
    'description': 'Read this project’s saved Maritime assets, vessel calls, maintenance, exercises and scenarios, or a specific saved run with calculated results. Use before explaining terminal operations or safety outcomes. Source and assumptions are explicit. No scene control, live telemetry or mutation.',
    'input_schema': {'type': 'object', 'properties': {'run_id': {'type': 'string', 'description': 'Optional saved run UUID from a previous context result.'}}, 'additionalProperties': False},
}


async def get_context(db, project_id, run_id=None):
    row = await db.get(MaritimeWorkspace, project_id)
    if not row:
        return {'status':'no_saved_maritime_plan','message':'No Maritime working plan is saved in this project.'}
    if run_id:
        try:
            id = UUID(run_id)
        except (ValueError, TypeError):
            return {'error':'Invalid run identifier'}
        run = await db.get(MaritimeRun, id)
        if not run or run.project_id != project_id:
            return {'error':'Run not found in this project'}
        result = dict(run.results)
        inputs = dict(run.inputs)
        if 'asset' in inputs:
            inputs['asset'] = {k:v for k,v in inputs['asset'].items() if k != 'elements'} | {'linked_elements':len(inputs['asset'].get('elements',[]))}
        if 'plan' in inputs:
            inputs['plan'] = {**inputs['plan'], 'assets': [
                {k:v for k,v in a.items() if k != 'elements'} | {'linked_elements':len(a.get('elements',[]))}
                for a in inputs['plan'].get('assets',[])]}
        if run.kind == 'operations':
            result = {**result, **{key:{k:v for k,v in result[key].items() if k not in ('samples', 'replay')} for key in ('baseline','scenario')}}
        return jsonable_encoder({'run_id':run.id,'kind':run.kind,'name':run.name,'version':run.version,
                                  'created_at':run.created_at,'stale':run.version != row.version,
                                  'inputs':inputs,'results':result})
    runs=(await db.scalars(select(MaritimeRun).where(MaritimeRun.project_id==project_id).order_by(MaritimeRun.created_at.desc()).limit(20))).all()
    plan={**row.definition,'assets':[{k:v for k,v in a.items() if k != 'elements'}|{'linked_elements':len(a.get('elements',[]))} for a in row.definition.get('assets',[])]}
    return jsonable_encoder({'version':row.version,'working_plan':plan,
                             'runs':[{'id':r.id,'name':r.name,'kind':r.kind,'version':r.version,'created_at':r.created_at} for r in runs],
                             'limits':'Only saved inputs are available. Simulation is a bounded capacity model, not live telemetry. Planning asset associations do not automatically reschedule delivery work. Guided exercise actions are participant-recorded, not automatic spatial hazard detection.'})
