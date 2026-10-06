"""Carry P6 definitions that have no native editor through a PMXML round trip.

Native entities and their editable fields always come from the current model.
References in retained definitions are translated by entity type, never copied
as unqualified integers (P6 ObjectIds are scoped by entity type).
"""
from copy import deepcopy
from decimal import Decimal
import xml.etree.ElementTree as ET

CORE = {"Activity", "WBS", "Relationship", "ResourceAssignment"}
OFFSET = 20000000


def plain(xml):
    root = ET.fromstring(xml)
    for e in root.iter():
        e.tag = e.tag.split("}")[-1]
    return root


def enrich_pmxml(xml, data):
    if not data.source_project_xml:
        return xml
    root = plain(xml)
    source = plain(data.source_project_xml)
    shared = [plain(x) for x in data.source_shared_xml]
    maps = deepcopy(data.source_maps)
    for entity in shared:
        oid = entity.findtext("ObjectId")
        if oid and entity.tag not in maps:
            maps.setdefault(entity.tag, {})
    for entity in shared:
        oid = entity.findtext("ObjectId")
        if oid and entity.tag not in {"Calendar", "Resource", "UDFType"}:
            maps.setdefault(entity.tag, {})[oid] = OFFSET + int(oid)
    # Auxiliary project objects have their own identities too.
    for entity in source:
        oid = entity.findtext("ObjectId")
        if oid and entity.tag not in CORE:
            maps.setdefault(entity.tag, {})[oid] = OFFSET + int(oid)

    def remap(entity, context, local_maps=maps, own_type=None):
        entity = deepcopy(entity)
        own_type = own_type or entity.tag
        for parent in entity.iter():
            for field in list(parent):
                if not field.tag.endswith("ObjectId") or not field.text:
                    continue
                kind = field.tag[:-8]
                if field.tag == "ObjectId":
                    kind = own_type if parent is entity else parent.tag
                elif field.tag == "ParentObjectId":
                    kind = own_type
                elif field.tag == "TypeObjectId":
                    kind = "UDFType" if parent.tag == "UDF" else context + "CodeType"
                elif field.tag == "ValueObjectId":
                    kind = context + "Code"
                elif kind in {"PredecessorActivity", "SuccessorActivity"}:
                    kind = "Activity"
                elif kind in {"OriginalProject", "PredecessorProject", "SuccessorProject"}:
                    kind = "Project"
                elif kind in {"ActivityDefaultCalendar", "BaseCalendar"}:
                    kind = "Calendar"
                elif kind == "PrimaryResource":
                    kind = "Resource"
                mapped = local_maps.get(kind, {}).get(field.text)
                if mapped is not None:
                    field.text = str(mapped)
                else:
                    # External EPS references are deliberately absent from a
                    # portable export, as are references to deleted entities.
                    parent.remove(field)
        return entity

    project = root.find("Project")
    indexes = {kind: {e.findtext("ObjectId"): e for e in project.findall(kind)} for kind in CORE}
    authority = {
        "Project": {"Id", "Name", "GUID", "ObjectId", "DataDate", "PlannedStartDate", "ActivityDefaultCalendarObjectId", "CurrentBaselineProjectObjectId"},
        "WBS": {"Code", "Name", "GUID", "ObjectId", "ParentObjectId", "ProjectObjectId", "SequenceNumber"},
        "Activity": {"ObjectId", "ProjectObjectId", "CalendarObjectId", "WBSObjectId"},
        "ResourceAssignment": {"ObjectId", "ProjectObjectId", "ResourceObjectId", "ActivityObjectId", "WBSObjectId"},
    }

    def supplement(target, original, kind, scalar=False):
        restored = remap(original, kind)
        protected = authority.get(kind, set())
        for child in restored:
            if child.tag in CORE or child.tag in protected:
                continue
            existing = target.find(child.tag)
            if len(child):
                if child.tag == "UDF" and any(e.findtext("TypeObjectId") == child.findtext("TypeObjectId") for e in target.findall("UDF")):
                    continue
                target.append(child)
            elif child.tag.endswith("ObjectId") or scalar or (existing is None and kind not in {"Activity", "ResourceAssignment"}):
                if existing is not None:
                    target.remove(existing)
                target.append(child)

    # Settings, historical period actuals, steps, documents and coding remain
    # associated with the same live activities rather than being discarded.
    supplement(project, source, "Project", scalar=True)
    for kind in ("WBS", "Activity", "ResourceAssignment"):
        for original in source.findall(kind):
            mapped = maps.get(kind, {}).get(original.findtext("ObjectId"))
            target = indexes[kind].get(str(mapped))
            if target is not None:
                supplement(target, original, kind, scalar=(kind == "WBS"))

    # Preserve calendar conversion factors and the exact weekday/exception
    # representation when its native editable pattern remains unchanged.
    from app.services.p6_import_parse import _parse_calendar, _NS
    def calendar_pattern(element):
        e = deepcopy(element)
        for node in e.iter():
            node.tag = "{" + _NS + "}" + node.tag
        parsed = _parse_calendar(e, [])
        return (parsed.day_start, parsed.day_end, parsed.breaks, parsed.works,
                sorted((x.start_date, x.end_date, x.is_working, str(x.start_time), str(x.end_time)) for x in parsed.exceptions))
    for original in shared:
        if original.tag != "Calendar":
            continue
        mapped = maps.get("Calendar", {}).get(original.findtext("ObjectId"))
        current = next((e for e in root.findall("Calendar") if e.findtext("ObjectId") == str(mapped)), None)
        if current is not None and calendar_pattern(original) == calendar_pattern(current):
            restored = remap(original, "Calendar")
            restored.find("Name").text = current.findtext("Name")
            root.remove(current)
            root.insert(0, restored)

    # Preserve original currency, resource attributes and rate history.
    generated_resources = {e.findtext("ObjectId"): e for e in root.findall("Resource")}
    rates_by_resource = {}
    for e in shared:
        if e.tag == "ResourceRate":
            rates_by_resource.setdefault(e.findtext("ResourceObjectId"), []).append(e)
    for original in shared:
        if original.tag == "Resource":
            rid = str(maps["Resource"].get(original.findtext("ObjectId")))
            target = generated_resources.get(rid)
            if target is not None:
                restored = remap(original, "Resource")
                for child in restored:
                    if child.tag in {"ObjectId", "Id", "Name", "GUID", "CalendarObjectId", "ResourceType"}:
                        continue
                    existing = target.find(child.tag)
                    if existing is not None:
                        target.remove(existing)
                    target.append(child)
        elif original.tag == "UDFType":
            mapped = maps.get("UDFType", {}).get(original.findtext("ObjectId"))
            existing = next((e for e in root.findall("UDFType") if e.findtext("ObjectId") == str(mapped)), None)
            if existing is not None:
                restored = remap(original, "UDFType")
                restored.find("Title").text = existing.findtext("Title")
                root.remove(existing)
                root.insert(0, restored)
        elif original.tag in {"Currency", "DisplayCurrency"}:
            for existing in root.findall(original.tag):
                root.remove(existing)
            root.insert(0, remap(original, original.tag))
    for source_rid, rid in maps.get("Resource", {}).items():
        current = next((r for r in data.resources if r.id == rid), None)
        if source_rid not in rates_by_resource and current is not None and current.rate == 0:
            for existing in list(root.findall("ResourceRate")):
                if existing.findtext("ResourceObjectId") == str(rid):
                    root.remove(existing)
    for source_rid, history in rates_by_resource.items():
        rid = maps.get("Resource", {}).get(source_rid)
        current = next((r for r in data.resources if r.id == rid), None)
        # Retain historic rates only while the imported current rate is intact.
        if current is None or Decimal(history[-1].findtext("PricePerUnit") or 0).quantize(Decimal('.01')) != current.rate.quantize(Decimal('.01')):
            continue
        for existing in list(root.findall("ResourceRate")):
            if existing.findtext("ResourceObjectId") == str(rid):
                root.remove(existing)
        for original in history:
            root.insert(0, remap(original, "Resource"))

    # Baselines are immutable snapshots: preserve the complete original graph,
    # remapping its own activities/WBS independently of the live project.
    for index, baseline in enumerate(data.baselines, 1):
        if not baseline.get("raw_xml"):
            continue
        original = plain(baseline["raw_xml"])
        local = deepcopy(maps)
        offset = index * 10000000
        local["Project"] = {original.findtext("ObjectId"): offset + data.project_id}
        for kind in CORE | {e.tag for e in original if e.findtext("ObjectId")}:
            local[kind] = {e.findtext("ObjectId"): offset + int(e.findtext("ObjectId")) for e in original.findall(kind) if e.findtext("ObjectId")}
        restored = remap(original, "Project", local, own_type="Project")
        for e in restored.iter("OriginalProjectObjectId"):
            e.text = str(data.project_id)
        if restored.find("OriginalProjectObjectId") is None:
            ET.SubElement(restored, "OriginalProjectObjectId").text = str(data.project_id)
        # Code assignments need the containing entity's subject area.
        for kind in ("Activity", "WBS"):
            for old, new in zip(original.findall(kind), restored.findall(kind)):
                for c in list(new.findall("Code")):
                    if len(c): new.remove(c)
                for c in old.findall("Code"):
                    if len(c): new.append(remap(c, "Activity" if kind == "Activity" else "Project", local))
        for existing in list(root.findall("BaselineProject")):
            if existing.findtext("ObjectId") == str(offset + data.project_id):
                root.remove(existing)
        root.append(restored)

    # Restore namespace without ns0 prefixes; xsi attributes retain their URI.
    root.set("xmlns", "http://xmlns.oracle.com/Primavera/P6Professional/V24.12/API/BusinessObjects")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(root, encoding="unicode")
