# Shape operations

Open **Site Tools → Layout tools → Shape operations**.

For ground, draw a closed path (straight or curved), create **Closed shape / water**,
and give it a height/thickness. Position another closed solid where a cut is needed.
Choose the base and cutter, or select an object/IFC element in the viewport and use
**Use selected as base/cutter**.

- **Subtract** creates the base with a hole/cut.
- **Excavate** creates the remaining base and a separate red removed section.
- **Union** joins solids; **Intersection** retains their overlap.

Preview before **Create results**. Results are ordinary site assets with shared
transforms, Materials, activity/profile links and undo/redo. Input geometry is copied;
source IFC files and their element geometry are not rewritten. Inputs remain as
backups and can be hidden automatically; **Show All** reveals them. Results are
independent snapshots, not live parametric relationships to their inputs.

Terrain subdivision, raise/lower and simplify were removed at the user's request.
Previously created assets remain ordinary editable objects.

Operations require closed solids and have a 20,000 input-triangle
budget. Open/non-manifold inputs are rejected. Complex self-intersections and
excessive deformation can still make unsuitable solids; inspect the preview.
These operations create mesh geometry, not new IFC semantic relationships.
