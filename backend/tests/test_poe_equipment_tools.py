from app.ai.tools import CLIENT_TOOL_NAMES, TOOLS
from app.schemas.equipment_rig import Definition


def test_equipment_tools_are_viewer_local_and_match_save_schema():
    tools = {t['name']: t for t in TOOLS}
    assert {'inspect_equipment', 'draft_equipment_rig'} <= CLIENT_TOOL_NAMES
    schema = tools['draft_equipment_rig']['input_schema']['properties']['definition']
    assert schema['additionalProperties'] is False
    assert schema['properties']['joints']['items']['properties']['response']['maxItems'] == 100
    assert '$ref' not in str(schema)
    Definition.model_validate({'schema_version': 1, 'controls': [], 'joints': [], 'followers': []})
