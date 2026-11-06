"""Isolated IFC revision analysis. No database or storage credentials in this process."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
import sys

import ifcopenshell
import ifcopenshell.geom
from ifcopenshell.util import element, placement, unit


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k != 'id'}
    if isinstance(value, (tuple, list)): return [clean(v) for v in value]
    if isinstance(value, float): return round(value, 6) if math.isfinite(value) else None
    return value


def graph_hash(entity, cache=None, stack=None):
    cache = {} if cache is None else cache
    stack = set() if stack is None else stack
    def walk(v):
        if isinstance(v, ifcopenshell.entity_instance):
            if v.id() and v.id() in cache: return cache[v.id()]
            if v.id() and v.id() in stack: return v.is_a()
            active = stack | {v.id()}
            attrs = {v.attribute_name(i): graph_value(x, active) for i, x in enumerate(v)
                     if v.attribute_name(i) not in ('OwnerHistory', 'GlobalId')}
            result = digest([v.is_a(), attrs])
            if v.id(): cache[v.id()] = result
            return result
        return graph_value(v, stack)
    def graph_value(v, active):
        if isinstance(v, ifcopenshell.entity_instance): return graph_hash(v, cache, active)
        if isinstance(v, (tuple, list)): return [graph_value(x, active) for x in v]
        return clean(v)
    return walk(entity)


def products(model):
    rows = {}
    for p in model.by_type('IfcElement'):
        if not p.GlobalId or p.GlobalId in rows: raise ValueError('Missing or duplicate element GlobalIds. Correct the export before synchronising.')
        rows[p.GlobalId] = p
    return rows


def area_of(p, model):
    quantities = element.get_psets(p, qtos_only=True)
    scale = unit.calculate_unit_scale(model, 'AREAUNIT')
    for name in ('NetArea', 'GrossArea', 'NetSideArea', 'GrossSideArea', 'Area'):
        for group, values in quantities.items():
            value = values.get(name)
            if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
                definition = model.by_id(values['id']) if values.get('id') else None
                q = next((q for q in getattr(definition, 'Quantities', ()) if q.Name == name and q.is_a('IfcQuantityArea')), None)
                if q and q.Unit:
                    value = unit.convert(value, getattr(q.Unit, 'Prefix', None), q.Unit.Name, None, 'SQUARE_METRE')
                    return {'m2': round(value, 6), 'basis': f'{group}.{name}'}
                return {'m2': round(value * scale, 6), 'basis': f'{group}.{name}'}
    return None


def snapshot(p, model, cache=None):
    container = element.get_container(p)
    t = element.get_type(p)
    material = element.get_material(p)
    props = clean(element.get_psets(p))
    matrix = placement.get_local_placement(p.ObjectPlacement).tolist() if p.ObjectPlacement else None
    styles = [graph_hash(s, cache) for item in model.traverse(p.Representation) for s in getattr(item, 'StyledByItem', ())] if p.Representation else []
    return {'guid': p.GlobalId, 'name': p.Name or '', 'type': p.is_a(), 'area': area_of(p, model),
            'properties': props,
            'hashes': {'identity': digest([p.is_a(), p.Name, p.Description, getattr(p, 'Tag', None), getattr(p, 'PredefinedType', None), getattr(p, 'ObjectType', None)]),
                       'geometry': graph_hash(p.Representation, cache),
                       'appearance': digest(sorted(styles)),
                       'placement': digest(clean(matrix)), 'properties': digest(props),
                       'type': graph_hash(t, cache), 'material': graph_hash(material, cache),
                       'container': digest([container.GlobalId, graph_hash(container, cache)]) if container else digest(None),
                       'openings': digest(sorted((r.RelatedOpeningElement.GlobalId, graph_hash(r.RelatedOpeningElement, cache)) for r in getattr(p, 'HasOpenings', ()))),
                       'assembly': digest([sorted(r.RelatingObject.GlobalId for r in getattr(p, 'Decomposes', ())), sorted(x.GlobalId for r in getattr(p, 'IsDecomposedBy', ()) for x in r.RelatedObjects)]),
                       'associations': digest(sorted(digest([r.is_a(), [graph_hash(v, cache) for i, v in enumerate(r) if r.attribute_name(i) not in ('GlobalId', 'OwnerHistory', 'RelatedObjects')]]) for r in getattr(p, 'HasAssociations', ()) if not r.is_a('IfcRelAssociatesMaterial')))}}


def validate_pair(old, new):
    if old.schema != new.schema: raise ValueError('Use the same IFC schema for both revisions. Convert the revised export first.')
    if abs(unit.calculate_unit_scale(old)-unit.calculate_unit_scale(new)) > 1e-12:
        raise ValueError('The revised model changes length units. Export it using the original units before synchronising.')
    # Changes of site/map reference cannot safely be applied element by element.
    for name in ('IfcMapConversion', 'IfcProjectedCRS'):
        try: a, b = old.by_type(name), new.by_type(name)
        except RuntimeError: continue
        if sorted(graph_hash(x) for x in a) != sorted(graph_hash(x) for x in b):
            raise ValueError('The coordinate reference changed. Align the revisions before synchronising.')


def compare(old, new):
    validate_pair(old, new)
    before, after = products(old), products(new)
    if before and after and not before.keys() & after.keys():
        raise ValueError('No element GlobalIds match. This may be a different model or regenerated identifiers; automatic revision matching is unsafe.')
    old_cache, new_cache = {}, {}
    changes, unchanged = [], 0
    for guid in sorted(before.keys() | after.keys()):
        a = snapshot(before[guid], old, old_cache) if guid in before else None
        b = snapshot(after[guid], new, new_cache) if guid in after else None
        fields = [k for k in a['hashes'] if a['hashes'][k] != b['hashes'][k]] if a and b else []
        if a and b and not fields:
            unchanged += 1
            continue
        changes.append({'guid': guid, 'kind': 'added' if not a else 'removed' if not b else 'modified',
                        'fields': fields, 'before': a, 'after': b})
    return {'changes': changes, 'unchanged': unchanged, 'old_count': len(before), 'new_count': len(after)}


def merge(old, new, decisions):
    """Keep the baseline, replacing only approved products and their direct associations."""
    report = compare(old, new)
    changes = {c['guid']: c for c in report['changes']}
    if set(decisions) != set(changes): raise ValueError('Every changed element needs an explicit decision.')
    for guid, d in decisions.items():
        if d['action'] not in ('accept', 'reject'): raise ValueError('Invalid decision')
        if d['action'] == 'reject' and not d.get('rationale', '').strip(): raise ValueError('Rejected changes need a rationale.')
    original, incoming = products(old), products(new)
    accepted = {g for g, d in decisions.items() if d['action'] == 'accept'}
    if len(accepted) == len(changes): return new
    if not accepted: return old
    expected_snapshots = {g: snapshot(p, old) for g, p in original.items()}
    for g in accepted:
        if g in incoming: expected_snapshots[g] = snapshot(incoming[g], new)
        else: expected_snapshots.pop(g, None)
    # Selective merging cannot safely reconstruct a changed spatial/assembly graph.
    for cls in ('IfcRelAggregates', 'IfcRelNests'):
        def topology(model):
            return sorted((r.RelatingObject.GlobalId, sorted(x.GlobalId for x in r.RelatedObjects)) for r in model.by_type(cls))
        if topology(old) != topology(new):
            raise ValueError('This revision changes an assembly or spatial hierarchy. Accept the whole revision, or request an export with unchanged hierarchy for selective review.')
    # Opening/void and assembly changes must be reviewed consistently as a group.
    for model in (old, new):
        for kind, left, right in [('IfcRelVoidsElement', 'RelatingBuildingElement', 'RelatedOpeningElement'),
                                  ('IfcRelFillsElement', 'RelatingOpeningElement', 'RelatedBuildingElement')]:
            for rel in model.by_type(kind):
                ids = {getattr(rel, left).GlobalId, getattr(rel, right).GlobalId} & changes.keys()
                if ids & accepted and ids - accepted:
                    raise ValueError('Connected opening/filling changes need the same decision. Review the host, opening and filling together.')
    copied = {}
    def clone(value):
        if isinstance(value, (list, tuple)): return tuple(clone(v) for v in value)
        if not isinstance(value, ifcopenshell.entity_instance): return value
        if not value.id(): return old.create_entity(value.is_a(), *[clone(v) for v in value])
        if value.id() in copied: return copied[value.id()]
        if value.is_a('IfcRepresentationContext'):
            matching = next((c for c in old.by_type(value.is_a()) if graph_hash(c) == graph_hash(value)), None)
            if matching: return matching
            raise ValueError('The representation context changed. Accept the whole revision to retain its coordinate and representation setup.')
        if value.is_a('IfcProduct'):
            if value.GlobalId in original: return original[value.GlobalId]
            try: return old.by_guid(value.GlobalId)
            except RuntimeError: pass
        obj = old.create_entity(value.is_a())
        copied[value.id()] = obj
        for i, v in enumerate(value):
            # Fresh identifiers for copied shared definitions prevent duplicate roots.
            obj[i] = ifcopenshell.guid.new() if value.attribute_name(i) == 'GlobalId' and not value.is_a('IfcProduct') else clone(v)
        for style in getattr(value, 'StyledByItem', ()): clone(style)
        if value.is_a('IfcMaterial'):
            for representation in getattr(value, 'HasRepresentation', ()): clone(representation)
        return obj
    for guid in accepted:
        if guid not in incoming: continue
        src = incoming[guid]
        previous = original.get(guid)
        dst = old.create_entity(src.is_a(), GlobalId=guid)
        copied[src.id()] = dst
        if previous:
            element.replace_element(previous, dst)
            old.remove(previous)
        original[guid] = dst
    for guid in accepted:
        if guid not in incoming:
            from ifcopenshell.api.root import remove_product
            remove_product(old, product=original[guid])
            del original[guid]
            continue
        src, dst = incoming[guid], original[guid]
        for i, value in enumerate(src): dst[i] = clone(value)
        # Detach only this element from shared property/type/material/container relationships.
        inverses = list(old.get_inverse(dst))
        association_types = ('IfcRelDefinesByProperties', 'IfcRelDefinesByType', 'IfcRelAssociates', 'IfcRelContainedInSpatialStructure')
        for rel in inverses:
            if not any(rel.is_a(t) for t in association_types): continue
            attr = 'RelatedElements' if rel.is_a('IfcRelContainedInSpatialStructure') else 'RelatedObjects'
            remaining = tuple(v for v in getattr(rel, attr) if v != dst)
            if remaining: setattr(rel, attr, remaining)
            else: old.remove(rel)
        for rel in new.get_inverse(src):
            if not any(rel.is_a(t) for t in association_types): continue
            attr = 'RelatedElements' if rel.is_a('IfcRelContainedInSpatialStructure') else 'RelatedObjects'
            if src not in getattr(rel, attr): continue
            new_rel = old.create_entity(rel.is_a())
            for i, v in enumerate(rel):
                name = rel.attribute_name(i)
                new_rel[i] = (dst,) if name == attr else ifcopenshell.guid.new() if name == 'GlobalId' else clone(v)
    # Recreate host/opening relationships touching accepted elements.
    for kind, left, right in [('IfcRelVoidsElement', 'RelatingBuildingElement', 'RelatedOpeningElement'),
                              ('IfcRelFillsElement', 'RelatingOpeningElement', 'RelatedBuildingElement')]:
        for rel in list(old.by_type(kind)):
            if {getattr(rel, left).GlobalId, getattr(rel, right).GlobalId} & accepted: old.remove(rel)
        for rel in new.by_type(kind):
            if {getattr(rel, left).GlobalId, getattr(rel, right).GlobalId} & accepted: clone(rel)
    # Validate the approved/rejected identities after serialisation, before committing any data.
    expected = set(products(old))
    reopened = ifcopenshell.file.from_string(old.to_string())
    if set(products(reopened)) != expected: raise ValueError('Merged IFC identity validation failed')
    for g, p in products(reopened).items():
        if snapshot(p, reopened)['hashes'] != expected_snapshots[g]['hashes']:
            raise ValueError('These changes share IFC definitions that cannot be merged independently. Review the related elements together or accept the whole revision.')
    return old


def preview(model, guid):
    try: p = model.by_guid(guid)
    except RuntimeError: return None
    if not getattr(p, 'Representation', None): return None
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    shape = ifcopenshell.geom.create_shape(settings, p)
    vertices, faces = list(shape.geometry.verts), list(shape.geometry.faces)
    if len(faces) > 600000: raise ValueError('This element is too detailed for the report preview. Inspect it in the main viewport.')
    return {'vertices': vertices, 'faces': faces}


def run(source, output):
    request = json.loads(Path(source).read_text(encoding='utf-8'))
    a, b = ifcopenshell.open(request['before']), ifcopenshell.open(request['after'])
    mode = request['mode']
    if mode == 'identities': result = {'guids': list(products(a))}
    elif mode == 'quantities': result = {'elements': {g: area_of(p, a) for g, p in products(a).items()}}
    elif mode == 'compare': result = compare(a, b)
    elif mode == 'preview': result = {'before': preview(a, request['guid']), 'after': preview(b, request['guid'])}
    elif mode == 'merge':
        merge(a, b, request['decisions']).write(request['merged'])
        result = {'merged': True}
    else: raise ValueError('Unknown revision operation')
    Path(output).write_text(json.dumps(result), encoding='utf-8')


if __name__ == '__main__':
    try: run(sys.argv[1], sys.argv[2])
    except ValueError as exc:
        Path(sys.argv[2]).with_suffix('.error.json').write_text(json.dumps({'kind': 'snapshot', 'message': str(exc)}), encoding='utf-8')
        sys.exit(1)
