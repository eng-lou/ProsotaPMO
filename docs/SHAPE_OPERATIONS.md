# Shape operations and terrain editing

Open **Site Tools → Layout tools → Shape operations**.

For ground, draw a closed path (straight or curved), create **Closed shape / water**,
and give it a height/thickness. Position another closed solid where a cut is needed.
Choose the base and cutter, or select an object/IFC element in the viewport and use
**Use selected as base/cutter**.

- **Subtract** creates the base with a hole/cut.
- **Excavate** creates the remaining base and a separate red removed section.
- **Union** joins solids; **Intersection** retains their overlap.
- **Terrain** opens a single solid for subdivision and local raise/lower edits.

Preview before **Create results**. Results are ordinary site assets with shared
transforms, Materials, activity/profile links and undo/redo. Input geometry is copied;
source IFC files and their element geometry are not rewritten. Inputs remain as
backups and can be hidden automatically; **Show All** reveals them. Results are
independent snapshots, not live parametric relationships to their inputs.

## Bumps and dips

Choose Terrain, preview, then **Subdivide ×4** to add vertices without changing the
initial surface. Click the preview surface to choose a brush centre. Set radius,
height per push/pull and falloff, then **Raise area** or **Lower area**. The base
stays fixed; pulls through the base are rejected. Undo shape edit keeps ten local
preview steps. Create results saves a new solid; the main Undo reverses creation.

Simplify removes a chosen percentage of vertices. It supports a single untextured
material; keeping multiple material regions/UV seams during simplification is not
implemented. Preview the silhouette before saving.

Operations require closed solids and have a 20,000 input-triangle/subdivision
budget. Open/non-manifold inputs are rejected. Complex self-intersections and
excessive deformation can still make unsuitable solids; inspect the preview.
These operations create mesh geometry, not new IFC semantic relationships.
