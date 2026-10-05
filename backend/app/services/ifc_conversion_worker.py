"""Isolated IFC2X3 -> IFC4 conversion; never modifies a saved source."""
from pathlib import Path
import sys


def convert(source: Path, destination: Path) -> None:
    import ifcopenshell
    from ifcopenshell.util.schema import Migrator

    original = ifcopenshell.open(str(source))
    if original.schema == "IFC4":
        original.write(str(destination))
        return
    if original.schema != "IFC2X3":
        raise ValueError("Only IFC2X3 and IFC4 sources are supported")
    products = {p.GlobalId for p in original.by_type("IfcProduct")}
    represented = {p.GlobalId for p in original.by_type("IfcProduct") if p.Representation}
    converted = ifcopenshell.file(schema="IFC4")
    migrator = Migrator()
    migrator.preprocess(original, converted)
    for entity in original:
        migrator.migrate(entity, converted)
    if products != {p.GlobalId for p in converted.by_type("IfcProduct")}:
        raise ValueError("Conversion changed product identifiers")
    if represented != {p.GlobalId for p in converted.by_type("IfcProduct") if p.Representation}:
        raise ValueError("Conversion lost product representations")
    converted.write(str(destination))
    if ifcopenshell.open(str(destination)).schema != "IFC4":
        raise ValueError("Converted output is not IFC4")


if __name__ == "__main__":
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
