"""Ten reversible site edits. Store recipes only for objects that changed."""
LIMIT = 10


def empty():
    return {"past": [], "future": []}


def summaries(history):
    return {side: [{"id": edit["id"], "label": edit["label"]} for edit in edits]
            for side, edits in (history or empty()).items()}


def record(history, command_id, label, before, after):
    if before == after:
        return history
    old = {item["id"]: item for item in before}
    new = {item["id"]: item for item in after}
    changed = {key for key in old.keys() | new.keys() if old.get(key) != new.get(key)}
    removed = [item["name"] for key, item in old.items() if key not in new]
    edit = {
        "id": str(command_id), "label": label or ("Remove " + ", ".join(removed)[:220] if removed else "Edit site objects"),
        "before": {key: old.get(key) for key in changed},
        "after": {key: new.get(key) for key in changed},
    }
    if list(old) != list(new):
        edit["before_order"] = list(old)
        edit["after_order"] = list(new)
    return {"past": [*(history or empty())["past"], edit][-LIMIT:], "future": []}


def replay(history, items, action_id, direction):
    source, target, expected, destination = (
        ("past", "future", "after", "before") if direction == "undo" else ("future", "past", "before", "after"))
    history = history or empty()
    if not history[source] or history[source][-1]["id"] != str(action_id):
        raise ValueError("The site history changed. Reload the site objects and try again.")
    edit = history[source][-1]
    by_id = {item["id"]: item for item in items}
    if any(by_id.get(key) != value for key, value in edit[expected].items()):
        raise ValueError("An affected object has changed since this edit. Reload the site objects.")
    if expected + "_order" in edit and list(by_id) != edit[expected + "_order"]:
        raise ValueError("The site object list has changed since this edit. Reload the site objects.")
    for key, value in edit[destination].items():
        if value is None:
            by_id.pop(key, None)
        else:
            by_id[key] = value
    order = edit.get(destination + "_order", by_id)
    return [by_id[key] for key in order], {source: history[source][:-1], target: [*history[target], edit]}
