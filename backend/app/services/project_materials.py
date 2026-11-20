def apply_material_changes(current, seed, changes):
    # Seeding is first-writer-only. An empty new browser must not claim migration.
    if current is None and not seed and not changes:
        return None
    mapping = dict(current if current is not None else seed or {})
    for key, edit in changes.items():
        actual = mapping.get(key)
        if actual != edit["before"] and actual != edit["after"]:
            raise ValueError("Concurrent material edit")
    for key, edit in changes.items():
        if edit["after"] is None:
            mapping.pop(key, None)
        else:
            mapping[key] = edit["after"]
    return mapping
