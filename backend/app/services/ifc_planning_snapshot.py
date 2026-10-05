"""Read the explicit Prosota snapshot embedded in IFC2X3 or IFC4 exports."""
import json
from pathlib import Path
import sys


class SnapshotError(ValueError):
    """An expected, user-facing snapshot validation failure."""


def extract(path):
    import ifcopenshell
    import ifcopenshell.util.unit
    f = ifcopenshell.open(str(path))
    groups = {}
    for relation in f.by_type('IfcRelDefinesByProperties'):
        pset = relation.RelatingPropertyDefinition
        if not pset.is_a('IfcPropertySet') or not (pset.Name or '').startswith('Prosota_'):
            continue
        values = {p.Name: p.NominalValue.wrappedValue for p in pset.HasProperties
                  if p.is_a('IfcPropertySingleValue') and p.NominalValue is not None}
        groups.setdefault(pset.Name, []).append((relation.RelatedObjects, values))
    if len(groups.get('Prosota_Export', [])) != 1:
        raise SnapshotError('Select an IFC containing exactly one Prosota planning snapshot.')
    result = {name: [] for name in ('activities', 'relationships', 'resources', 'assignments', 'calendars', 'breaks', 'exceptions', 'costs', 'links')}
    task_ids = {}
    for objects, values in groups.get('Prosota_Activity', []):
        result['activities'].append(values)
        for obj in objects:
            task_ids[obj.id()] = values['id']
    for _, values in groups.get('Prosota_Calendar', []):
        result['breaks'].extend(json.loads(values.pop('breaks', '[]')))
        result['exceptions'].extend(json.loads(values.pop('exceptions', '[]')))
        result['calendars'].append(values)
    for _, values in groups.get('Prosota_ResourceCatalogue', []):
        result['resources'].extend(json.loads(values.get('resources', '[]')))
    for _, values in groups.get('Prosota_ResourceAssignment', []):
        result['assignments'].append(json.loads(values['assignment']))
    result['costs'] = [values for _, values in groups.get('Prosota_Cost', [])]
    for _, values in groups.get('Prosota_ModelLinks', []):
        result['links'].extend(json.loads(values.get('links', '[]')))
    kinds = {'FINISH_START': 'FS', 'START_START': 'SS', 'FINISH_FINISH': 'FF', 'START_FINISH': 'SF'}
    import re
    for rel in f.by_type('IfcRelSequence'):
        if rel.RelatingProcess.id() not in task_ids or rel.RelatedProcess.id() not in task_ids:
            continue
        if f.schema == 'IFC2X3':
            hours = float(rel.TimeLag) * ifcopenshell.util.unit.calculate_unit_scale(f, 'TIMEUNIT') / 3600
        else:
            value = rel.TimeLag.LagValue.wrappedValue if rel.TimeLag else 'PT0H'
            match = re.fullmatch(r'(-?)PT([0-9.]+)H', str(value))
            if not match:
                raise SnapshotError('This snapshot has an unsupported dependency lag.')
            hours = float(match[2]) * (-1 if match[1] else 1)
        result['relationships'].append(dict(predecessor_id=task_ids[rel.RelatingProcess.id()], successor_id=task_ids[rel.RelatedProcess.id()], relationship_type=kinds[rel.SequenceType], lag_hours=hours))
    if not result['activities']:
        raise SnapshotError('This IFC has no embedded Prosota activities.')
    result['warnings'] = ['Imports the saved planning snapshot. Baseline history, custom animation profiles and non-IFC links are not restored. Costs are restored as manual snapshot values.']
    return result


if __name__ == '__main__':
    try:
        Path(sys.argv[2]).write_text(json.dumps(extract(sys.argv[1])), encoding='utf-8')
    except SnapshotError as exc:
        Path(sys.argv[2]).with_suffix('.error.json').write_text(json.dumps({'kind': 'snapshot', 'message': str(exc)}), encoding='utf-8')
        sys.exit(1)
