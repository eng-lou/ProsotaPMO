# Prosota — Learning Log (Plain English)

The story of what happened, session by session — decisions made, why, and
what was learned along the way. Written for learning purposes, so the
reasoning behind the code is still readable long after the code itself has
moved on. Companion to `docs/COMMANDS_GLOSSARY.md` (the tools used) and
`PROJECT_STATE.md`/`ARCHITECTURE.md` (the technical reference).

This file didn't exist before today even though it's been referenced as a
companion doc — starting it now rather than trying to reconstruct every
past session from git history.

---

## 2026-07-10 — 4D module: AO/camera/video, then a Blender detour and back

**What got built:** finished the batch of 4D viewer features Maro asked
for in one go — ambient occlusion (a lighting effect that shades corners
and crevices realistically, using a small add-on library called N8AO),
still-image capture (a "Capture" button that saves exactly what's on
screen as a PNG), saved camera viewpoints (bookmark an angle, click to
jump back — like Blender's own numbered views), and video export (a
"Export Video" button that records an 8-second .webm of the schedule
playing out from start to finish).

**A real bug got fixed along the way**: keyframe-based animations were
"locking the model in place" — editing something by hand and having it
snap right back. Root cause: the code was re-applying every keyframe's
position every single frame, permanently overwriting any manual tweak.
Fixed by only re-applying when the timeline's actual date changes,
matching how Blender's own animation system behaves (keyframes are only
re-evaluated when the current frame changes, not continuously).

**Video export took a detour.** The original research pointed at an npm
package called `r3f-video-recorder` as the way to record video straight
out of the 3D view. When it actually came time to install it, it turned
out not to exist on the npm registry at all — a lesson that "the research
said X" isn't the same as "X exists," and needs checking before being
relied on. The eventual fix used something already built into every
modern browser instead: `canvas.captureStream()` turns the 3D viewport
into a live video feed, and `MediaRecorder` (also built-in) encodes that
feed straight to a downloadable file — no new package needed at all.

**The bigger detour: a Blender pivot, tried and reverted the same day.**
Partway through, Maro floated a much bigger idea: instead of hand-building
a 3D/animation engine inside the browser, why not build a Blender addon
and let Blender's own mature 3D/camera/animation/rendering tools do that
work instead? This actually matched the product's own stated plan for the
4D module ("not a separate animation/graphics engine") — the browser
build had drifted into exactly the kind of scope the plan warned against.

A separate repo (`Prosota-Blender`) got built out fairly far in one
sitting: a fully offline scheduling engine (no server, no login — just a
small database file sitting next to the Blender project), a panel for
adding/editing activities and linking them together, a Gantt chart drawn
right in the 3D view, and a way to assign resources to tasks. Several real
bugs got caught by actually testing each piece in a real Blender session
before moving on — most notably, an early attempt to build Blender's
"workspace" layout (like adding a new tab such as "Layout" or "Animation")
turned out to be something Blender's scripting API flatly doesn't allow
from inside another action — it only works when triggered directly by a
person clicking something. That's not a bug to work around; it's a hard
boundary of the tool.

After trying it hands-on, the verdict was that Blender's own 2D interface
(the panels and lists used for things like the activity list) is built for
tweaking a 3D model's settings, not for a polished scheduling grid — and no
amount of extra work closes that gap. Since the scheduling/resourcing
screens are the commercially important part of the product, and Blender
also means asking every user to install a separate application, the
decision was to go back to the browser version and make that work well,
rather than split effort across two products.

**What this means for next time**: the `Prosota-Blender` repo still
exists on GitHub but isn't being actively developed. The lesson that
carries forward either way: Blender's real strengths (3D viewport,
camera tools, native animation, rendering) are still exactly what a
"linked 3D schedule" feature needs — the open question, if this ever comes
back up, is whether there's a middle path (browser for building the
schedule, an optional Blender export for the polished 3D/animation side)
rather than an all-or-nothing choice.

**Back in the browser, a real animation bug turned up almost immediately**:
Maro linked one IFC object to two different activities — a "fall down"
profile on the first, a "go back up" profile on a second, later activity —
and only the second animation ever played; the first was silently ignored.
The cause: the code that resolves "which activity/profile animates this
object" only ever kept *one* answer per object, so linking a second
activity to the same object just overwrote the first one's animation
instead of adding to it. Fixed by keeping every link an object has and,
at any given moment in the timeline, picking whichever linked activity is
chronologically current — so the object now falls during the first
activity, holds that fallen position afterward, then rises during the
second. A useful general lesson: whenever "the same thing can be linked to
more than one thing," check whether the code actually expected that, or
quietly assumed one-to-one and will just clobber itself the moment it
isn't.

**Then a genuinely new feature: Collections**, Blender-style — create and
nest named groups, freely add IFC sub-elements or whole 3D objects to
them regardless of where they sit in the model's own import hierarchy
(Maro's example: gather every door on a building, scattered across many
different branches of the hierarchy, into one "Doors" group), then
select/hide/isolate by group. Planned properly first (a written plan,
reviewed against the actual code before writing any of it) since it
touches a lot of the viewport's existing selection/visibility machinery.
Built in six small stages, each checked before moving to the next: the
database tables, a working list/tree panel with no connection to the 3D
view yet, "add whatever's currently selected to a group," hiding one
element without hiding its whole model (something the app couldn't do at
all before), select/hide/isolate for a whole group (including nested
sub-groups), and finally two fast ways to build a big selection in the
first place — click an element *type* (e.g. "every door") or click a
building *storey* to select everything on it.

Two mistakes worth remembering because they're easy to make again:
- A brand new file imported another file "the normal way" instead of the
  lazy/on-demand way the rest of that area already uses for something
  large and rarely needed (the IFC-reading library) — it worked, `tsc`
  found nothing wrong, but the app's downloaded size roughly doubled
  because that large library got bundled into the very first thing every
  visitor downloads instead of loading only when someone actually opens
  an IFC file. Type-checking a file is not the same as checking what it
  costs to load — that only showed up in the build's own size report.
- Some retry/rename/delete logic that repeats itself down a tree of
  nested groups was accidentally hard-wired to always act on the *topmost*
  group instead of whichever one was actually clicked, the moment there
  was more than one level of nesting. Caught by reading it back over
  before it shipped, not by a user report — worth the extra look whenever
  a UI component recurses into copies of itself.

**"Select by Storey" got built twice.** The first version put a small
button directly on each storey's own row inside the existing spatial-
structure tree — technically it worked, but a tiny grey text link buried
inside a tree that starts collapsed is a genuinely bad way to expose a
feature: Maro couldn't find it, and even after fixing *why* it was hidden
(the tree wasn't expanding far enough down by default), it still didn't
read as a real, clickable control. Rebuilt as a plain list of properly-
styled buttons instead, sitting on its own, not nested in anything —
matching the "Select by Type" list that already worked and that nobody
had complained about. The lesson: when a first attempt at a UI affordance
gets "I don't see it" / "not working" twice in a row, the fix usually
isn't a smaller tweak to the same idea — it's worth stepping back and
copying whatever similar thing in the app is already known to work,
rather than iterating on the same buried approach a third time.

**Then a real bug, found by actually reading the code, not guessing**:
"when i isolate then box select, it doesnt work." Box-select decides
whether an object falls inside the dragged rectangle by checking one
point — the center of that object's bounding box. That bounding-box
calculation didn't know or care whether individual pieces of the object
were currently hidden (which is exactly what "isolate one small part of a
large model" does) — so once most of a big model was hidden by isolating
one small piece, the "center point" being tested was still the center of
the *entire original object*, often far outside whatever tiny bit was
actually still visible on screen. A box drawn around what you can
actually see could never contain a center point sitting somewhere
invisible. Fixed by only measuring the parts that are actually visible
right now. Verified with a small standalone script using the real 3D
library before shipping it, not just by reasoning about it on paper —
confirmed the old math really did land far from the visible content, and
the fix landed exactly on it.

**Then the big one**: "when i refresh all my hard work is gone regarding
4d, are you playing with me???" This deserved a real, evidence-based
answer, not reassurance. Checked every piece of 4D state one by one
against the actual code, and found something genuinely serious: moving,
rotating, or resizing an imported model or one of its individual parts —
via the drag handles or the numeric fields — had never been saved
anywhere, this entire session. Not a bug that crept in; it was simply
never built, alongside a dozen other things that *were* correctly saved.
Every bit of careful manual positioning (lining up separate imported
models against each other, especially) vanished the instant the page
reloaded, because nothing ever told it to remember.

While chasing that, a second, related discovery: the same building model
had been re-imported five separate times over one day, each time
uploading a fresh ~15MB copy, because reloading the page wasn't reliably
bringing the model back — so the natural thing to do was just import it
again. Reading the code alone wouldn't have shown this; querying the real
database directly did, and it made the actual scale of the problem
obvious in a way no amount of code-reading would have (five copies, one
name, spread across twelve hours — a pattern, not a fluke). Cleaned up
the four stale copies, then fixed *why* it kept happening: re-importing a
file with the same name now replaces whatever was there before instead
of quietly piling up another copy next to it.

Both fixes shipped the same way as everything else this session — a real
database table for the positioning data, endpoints to save and reload it,
and it actually loads back into place the next time the model opens. The
lesson underneath all of this: when someone says "my work is gone,"
checking the code that's *supposed* to save something isn't enough —
checking the actual data (what's really sitting in the database, right
now) is what turns "I think this should work" into "here's exactly what
went wrong and why."

## 2026-07-11 — Chasing "the model itself never saved," and the real culprit was login, not upload

The fixes above turned out not to be the end of it: "refreshing still
loses it," then a screenshot proving something worse — an imported,
manually-positioned model gone entirely after refresh, not just its
position. Directly querying the database (the same technique that found
the duplicate imports the day before) showed zero rows anywhere for that
model: the upload had never reached the server at all. But testing the
upload itself — the server-side code that receives a file, and the full
real HTTP request path a browser would actually send, both with a file the
same size as the real one — worked perfectly every time. A dead end,
seemingly: the piece that was failing couldn't be reproduced by anything
available in this environment (no access to the browser doing the actual
uploading).

Two things got fixed instead of stalling on that dead end. First, a real
and immediately useful bug: the upload function caught its own failures
but only printed them to a developer console nobody was looking at —
completely invisible in the actual app. Fixed so a failed save now shows
up as a real on-screen message, with whatever specific reason the server
gave.

Second, and more important: re-reading how login actually works turned up
a second, independent explanation that fits the symptoms exactly. Staying
logged in to a modern web app depends on periodically fetching a fresh
short-lived login token behind the scenes, without interrupting anyone.
This app was doing that the "old" way — a hidden, invisible mini
login-check loaded from the login provider's own website, running inside
this app's page. Browsers have spent the last few years deliberately
breaking exactly that trick (Safari led the way; Chrome and Firefox have
been following) as an anti-tracking measure, because it's indistinguishable
from the same technique used to secretly follow people across sites. When
it fails, this app already had a deliberate design decision (from an
earlier fix, 2026-07-05) to let the request go out anyway rather than
freeze the app — the server correctly refuses it, and until the first fix
above, that refusal vanished into the same invisible developer console.
That earlier, smaller bug ("I don't see my other projects") was very
likely the exact same underlying cause showing up somewhere lower-stakes
first.

The proper fix is the modern replacement for that whole mechanism: a
longer-lived "refresh token," stored so it survives a page reload, that
gets renewed with a normal, direct request straight to the login
provider — no hidden iframe, nothing for a browser's tracking protection
to ever block. This is the login provider's own recommended standard
setup for exactly this kind of app, not a workaround. It does mean the
login token now lives in a slightly more exposed spot in the browser
(`localStorage` instead of memory-only) — a real, deliberate trade-off,
made because silently losing people's work is the worse of the two risks
here. One thing this fix can't do by itself: it depends on a setting
("Refresh Token Rotation") on the login provider's own dashboard being
switched on for this app, which is configuration outside this codebase —
worth a quick check if logins ever start behaving oddly after this.

The broader lesson: when every direct test of "the thing that's supposed
to be failing" keeps succeeding, that's real evidence the failure is
somewhere else entirely — worth stepping back to what surrounds the
suspected feature (here, "how does this browser tab prove who's logged in,
minutes or hours after the login page closed?") rather than re-testing the
same component a third and fourth way.

## 2026-07-11 — Selecting "just the columns on this floor" needed two features wired together, not one

A working "select every element on this storey" button already existed —
but Maro's actual ask, side-by-side screenshots of Blender/Bonsai's own IFC
panel against this app's, was narrower: pick a level, *then* pick one
element type within it (the columns, say), then isolate just those. Bonsai
does this with two connected pieces — a "Spatial Decomposition" list of
storeys (each with its own height) that sets an active scope, and a
Class > Type > Occurrence count list that recalculates against whatever's
currently in scope. This app had the storey list and the type-count list
as two separate, unconnected features: the type counts were always
computed over the *whole model*, with no way to narrow them to one floor
first.

The fix wasn't new selection logic — Isolate already snapshots "whatever's
currently selected" regardless of how that selection was built, so once
the type list could hand back the right expressIDs, the existing Select →
Isolate flow worked unchanged. The actual gap was a missing grouping step:
walking a storey's already-fetched leaf elements and tallying them by
type client-side (`groupExpressIdsByType`), the same per-element type
lookup the codebase already had for one element at a time, just run over
a set instead of one id. Picking a storey now recomputes that grouping and
swaps what the type list shows and what clicking a type row selects;
clearing the scope goes back to the original whole-model counts unchanged.

One piece deliberately left undone: Bonsai's storey list shows real
heights ("-38' - 8 219/32""), feet-inches converted from the model's own
declared units. This app shows each storey's raw Elevation number as
stored in the file, unconverted — reading which unit a real IFC file
declares (`IfcUnitAssignment`) wasn't something that could be verified
against an actual sample file in this environment (none was available
locally, and this project has a standing rule — learned the hard way with
web-ifc's own vertex-data shape — that a web-ifc property shape doesn't
get trusted from docs alone, only from testing it against a real file). A
wrong unit label would be worse than an unlabelled raw number.

## 2026-07-11 (later same day) — A real sample file turned up a second, unrelated bug the first round never caught

Maro supplied the actual file from the Bonsai screenshots
(`2018_Hospital_Structural.ifc`) with "do your checks" — the missing piece
from the entry above. Loading it through a plain Node script (web-ifc has a
`web-ifc-api-node.js` build made exactly for this, no browser needed) found
something the whole storey feature had been silently broken by: the code
was checking a tree node's type against `'IFCBUILDINGSTOREY'` (all caps),
but web-ifc's own `getSpatialStructure` actually returns `'IfcBuildingStorey'`
(PascalCase) for every real file — only the tree's own *root* node comes
back all-caps (`'IFCPROJECT'`), an inconsistency inside web-ifc itself, not
a formatting choice either side of this codebase made. That one string
mismatch meant "Select by Storey" — and everything about to be built on top
of it — had matched zero storeys against every real file, always. No
smoke test the previous round had reason to write would have caught it,
because none of them touched a real spatial tree; this is exactly why the
project's own rule is to verify a web-ifc shape against a real file, not
just get the code compiling against a synthetic one.

With the fix in and the real file loaded, the type-by-storey breakdown
came back an exact match against Bonsai's own numbers for the same file —
129 columns, 594 slabs, 28 walls, 4 railings, 3 grids on Level 1, 249
columns model-wide — real, independent confirmation the new scoping logic
was doing the right thing, not just "compiles and looks plausible."

That same real file also settled the elevation-unit question the previous
entry had to leave open: its `IFCPROJECT.UnitsInContext` declares
`LENGTHUNIT` as an `IfcConversionBasedUnit` named "FOOT" with a
`ConversionFactor` of 0.3048 — confirming the raw Elevation numbers really
were the project's own feet, not an arbitrary scale. Storey heights now
render as real feet-inches, and — per Maro's follow-up ask, "add a unit
conversion toggle for people who prefer metric" — with an Auto/ft/m
override so a metric-preferring viewer isn't stuck with whatever unit the
file's own author happened to use, or vice versa.

## 2026-07-11 (same day) — Rewiring one preference across two panels that don't know about each other, and a selection highlight that was technically working

Two follow-ups after the units fix landed. First, "rewire units" — the same
Auto/ft/m toggle needed to reach TransformPanel's Location X/Y/Z fields
too, not just IfcDataPanel's read-only storey list. That surfaced a second,
smaller mislabelling bug on the way: those fields have always shown a
hardcoded "m" suffix, but for an IFC import the actual numbers sitting in
`object.position` are in the file's own native unit (feet, for this file) —
web-ifc doesn't normalize geometry to metres on load, same as the Elevation
attribute. The fields were quietly showing feet labelled as metres the
entire time. Fixing this meant lifting the unit preference out of
IfcDataPanel (which had been the only owner) up into FourD.tsx, since
TransformPanel lives under an entirely separate panel (PropertiesPanel)
that IfcDataPanel has no connection to — two independent
localStorage-backed copies of the same preference would only agree after a
full remount, not live. One IFC-model-loading detail made the Location
fields safe to convert with no extra care needed: keyframing (which stores
whatever number a field displays at the moment it's keyed) is already
disabled entirely for IFC selections — only plain mesh imports support it,
and mesh imports have no declared IFC unit to convert *from* in the first
place — so the two features provably never overlap, and no stored
keyframe data could ever end up unit-inconsistent from this change.

Second: "you can barely tell i've selected 7 elements" — selection was
implemented as a pure *additive* emissive glow (a colour added on top of
whatever the surface already renders), at an intensity (0.35–0.5) that
mostly washes out against a bright, near-white shaded model, and is nearly
invisible on thin elements like IfcGrid lines that have almost no screen
area to glow from regardless of intensity. The fix wasn't just turning the
glow up (though intensity did roughly double) — it also blends the
surface's actual base colour toward the selection tint (a 0.5–0.6 lerp), so
a selected element's own colour visibly shifts, not just an added glow on
top of it. The combination reads as a real highlight even on something
small or thin, the way "selected" looks unmistakable in Blender/Bonsai's
own orange outline.

## 2026-07-11 (still same day) — Stronger highlight, still invisible: two different "selected" meanings were sharing one colour

The intensity fix above turned out to only be half the bug. Maro selected
"Level 3" then "IfcSlab" (3 elements, via the new storey-scoped Select by
Type) and reported: the *object* looked highlighted, but not the 3 actual
elements — with a screenshot of a working single-element pick right next
to it for comparison (strong blue-lavender tint, clearly visible) proving
the highlight mechanism itself wasn't broken.

Checked the real IDs against the real file first, in case this was another
expressID-mismatch bug like the storey one earlier today — it wasn't:
`LoadAllGeometry`'s own flatMesh.expressID values matched the spatial
tree's leaf IDs exactly for all 3 slabs, confirmed via the same Node
script. The actual bug was a colour-tier collision: the viewport's
highlight logic had `isExpressAlsoSelected` (one of several *specifically*
picked elements) and `isObjectSelected` (this mesh's whole model merely
*contains* a selection somewhere) mapped to the exact same amber
treatment. Picking specific elements always also marks their owning object
selected (both select handlers call setSelectedObjectIds), so on a real
multi-select those two conditions are true *together* — every other mesh
in the same building got the identical amber wash as the 3 actually-picked
slabs, so the 3 slabs never stood out from the few hundred other elements
sharing that same object. Split into three real tiers instead of two:
every *specifically* selected element (primary or not) now gets the same
strong blue as a single pick; only a mesh that's selected purely by
belonging to a selected object (no specific pick) gets a much fainter
amber, so it reads as background context rather than competing with the
actual selection.

## 2026-07-11 (still same day) — A texture applied to a concrete slab, and got a flat grey square back

Maro applied a concrete image as a material's Base Color on some slabs and
got back plain flat grey — asked whether it was a render-mode setting or
something to actually fix. It wasn't render mode: `ifcModel.ts`'s own
geometry loader builds a `position` and a `normal` buffer attribute per
vertex from web-ifc's interleaved vertex data, and never a `uv` one — IFC
geometry has *no* texture-coordinate data to carry in the first place
(unlike GLTF/OBJ/FBX, which bring their own UVs from whatever authored
them). Without a `uv` attribute, three.js's `MeshStandardMaterial` has
nothing to sample a `map` texture against, so it silently drops back to a
flat, single colour — this is true of *every* IFC import, not something
that varies by file or setting.

Fixed with box-projected UVs generated once at import time: per vertex,
pick whichever axis that vertex's own normal points most toward, then use
the vertex's *local* position's other two components as U/V — the standard
technique for CAD/BREP geometry with no native UV unwrap, and exactly
right (no seams) for the flat, axis-aligned faces most structural BIM
elements are made of. Verified against the real hospital file before
trusting it: pulled one real Level 3 slab's actual geometry through the
same Node script used earlier today, and its UV range came out identical
to its real X/Y footprint (332.59 × 289.40, matching its own position
range to two decimals) — not degenerate, not flipped, genuinely tracking
the element's real size. A second, smaller bug rode along: uploaded
textures never had `wrapS`/`wrapT` set to `RepeatWrapping`, so even a
GLTF/OBJ/FBX import with its own real UVs would stretch one texture image
across an entire surface as a single non-tiling smear rather than
repeating it — fixed the same pass. A live "Tile Size" field was added to
the Material/Texture panel (real model units, respecting the Auto/ft/m
toggle from earlier today) so the actual visual tiling density is a choice
made in the UI, not a guess baked into the geometry.

One thing worth remembering for next time this comes up: a *curved* face
(this file has some curved curtain-wall panels) can show a visible seam
where the box-projection's dominant axis flips between neighbouring
triangles — true triplanar blending in a custom shader would avoid that,
but wasn't built here since it hadn't actually been reported as a problem
yet. Also, this only takes effect on a *fresh* import — a model already
loaded in a running browser tab was built with the old geometry (no UVs),
so seeing this fix requires re-importing the file, not just refreshing
(though a hard refresh does re-parse the raw IFC bytes from scratch via
the same restore-on-reload path, so that alone is enough too).

## 2026-07-11 (still same day) — Rounding out the material panel: AO, Displacement, Tile Rotation, Clear Materials

Four quick follow-ups once the flat-texture bug above was actually fixed
and materials started looking real. All were additive to the same
override/original-fallback machinery each of the original 4 slots already
used (customTextures.ts/elementBaseline.ts/Viewport3D.tsx), not new
mechanisms of their own:

- **AO + Displacement maps** joined Base Color/Metallic/Roughness/Normal as
  two more upload slots. The one real risk checked before wiring them in:
  aoMap has historically needed its own separate "uv2" coordinate set in
  many engines, which this app's geometry doesn't have — confirmed directly
  in the installed three.js's own source (`WebGLPrograms.js`'s
  `getChannel()`) that a texture's `channel` property defaults to 0, and
  channel 0 means the ordinary `uv` set, not a second one — so both new
  maps sample the exact same UVs the box-projection fix above already
  populates, no extra geometry work needed. Displacement genuinely has a
  real limitation worth remembering: it moves existing vertices along their
  normal, and most IFC/BREP geometry is only a handful of vertices per flat
  face (a plain box/plane) with nothing to subdivide — it'll work, just
  with very coarse results on typical structural elements, unlike
  finely-subdivided game-asset geometry it's more commonly used on.
  Extending this preset config also meant touching the *backend* schema
  (`app/schemas/material_preset.py`) and its SQLAlchemy model default dict
  — a safe, non-migration change since the whole config is one opaque
  JSONB blob, confirmed by re-running the existing preset test suite
  (6 passed) after the change, not just assumed safe from the JSONB
  storage detail alone.
- **Tile Rotation** — spins a tile in place, mutating `texture.rotation`
  directly (same live-object-mutation pattern Tile Size already
  established, and TransformPanel.tsx before that). One correctness detail
  that would have been easy to miss: three.js rotates a texture around its
  own (0,0) corner by default, which reads as the whole tile sliding off
  the surface rather than spinning — fixed by setting `texture.center` to
  (0.5, 0.5) once at load time, so "rotate" actually means what it sounds
  like.
- **Clear Materials** — one button wiping every slot at once back to each
  mesh's captured original, instead of six separate ✕ clicks. Deliberately
  removes the whole per-object/element entry from `customTextures` state
  rather than looping the existing per-slot clear (which would leave a
  now-empty, still-present override object sitting in state) — "no
  override at all" and "an override object with every slot individually
  cleared" should be the exact same state, not two different
  representations of the same thing.

## 2026-07-11 (still same day) — Making Displacement actually work, without letting it lag the platform

Displacement mapping moves *existing* vertices along their normal — real
IFC/BREP geometry is typically a handful of vertices per flat face (a plain
box or plane), so there was almost nothing for it to visibly move. Maro
asked for subdivision to fix that, explicitly flagging the real risk up
front: "mindful that it may lag our platform if abused." That framing
shaped the whole design more than the subdivision math itself did.

The subdivision itself is uniform *midpoint* splitting (each triangle -> 4,
by adding a vertex at each edge's exact midpoint), not Loop/Catmull-Clark
smoothing — a midpoint of two points already on a flat plane is still on
that plane, so this adds vertex density without rounding or reshaping
anything, which is exactly right for architectural elements that are
supposed to stay flat and axis-aligned. Correctness first: verified the
clamping math against three real slabs from the hospital file before
trusting it — a 524-triangle slab requesting subdivision level 3 correctly
clamped down to level 2 (8,384 triangles, under the cap) instead of
exploding to level 3's actual 33,536.

Two separate caps, not one, because the abuse risk itself has two separate
shapes:

1. **Per-mesh** — one element with subdivision cranked up shouldn't be able
   to generate an unbounded number of triangles on its own. Enforced
   *inside* the subdivision function itself, not just by whatever range the
   UI slider allows — so it can't be bypassed by anything that calls the
   function directly.
2. **Scene-wide, per render pass** — the real "abused" scenario in this
   app specifically isn't one careless slider drag, it's Apply to Linked
   (built weeks earlier, for an unrelated reason): one click can apply a
   displacement+subdivision choice to *every* element sharing a material at
   once — hundreds of columns simultaneously, in this app's own real test
   file. A single mesh's own cap doesn't protect against that; a running
   scene-wide triangle budget, decremented as each subdivided mesh is
   encountered during the viewport's render-update pass, does — once
   exhausted, any further element that would want subdivision falls back to
   its own original geometry instead (displacement still applies, just
   coarser), so the *total* stays bounded regardless of how many elements
   happen to share one heavily-subdivided material.

One correctness detail that would have caused a real, if slow, memory leak:
once a mesh's `geometry` can be swapped to a generated subdivided copy and
back, "just dispose whatever `mesh.geometry` happens to be right now" on
unload is no longer safe — it frees whichever one is currently showing and
silently leaks the other (the original, if subdivision was active at that
moment; the subdivided copy, if it wasn't). Fixed by disposing every
geometry a mesh might be holding onto (current + captured original +
cached subdivided), not just the live one — and Apply Transform, which
bakes a transform permanently into a mesh's geometry, needed the same
"what counts as the *original* geometry just changed" treatment already
established for position/rotation/scale baselines: the freshly-baked
geometry becomes the new original from that point on, and any stale cached
subdivision from before the bake gets dropped rather than silently reused
against geometry that no longer exists.

## 2026-07-11 (still same day) — Six render modes, and everything that quietly assumed there'd only ever be one

Maro compared this app's render options against Synchro's own dropdown
(Wireframe/Hidden Line/Flat Shaded/Gouraud Shaded/Phong Shaded/Iray) and
Blender's Cycles/Eevee/V-Ray, asking for something more advanced than the
existing binary shaded/wireframe toggle. Worth being upfront about scope
before touching any code: Cycles/V-Ray/Iray are *path tracers* — a
fundamentally different technique (simulating individual light rays over
many accumulated frames) from what three.js's WebGL renderer does
(rasterization, the same family Eevee and every other Synchro mode belongs
to). Real-time path tracing exists in a browser via WebGPU, but it's far
too slow for interactively navigating a model this size — genuinely out of
scope, not a "maybe later" hedge.

The other five modes turned out to be real, not approximations: three.js
ships actual `MeshLambertMaterial` (Gouraud — pure per-vertex diffuse, no
specular at all) and `MeshPhongMaterial` (Phong — per-pixel specular via a
single shininess value) classes, distinct lighting models from this app's
default PBR (`MeshStandardMaterial`), not just different slider values on
the same material. Hidden Line reuses the existing black-line "Edges"
overlay (built for a completely different feature originally) forced on
underneath a flat, neutral, unlit occluder fill — the classic CAD technical-
drawing look, deliberately not showing each element's real colour, just a
subtle tint of whichever selection colour would otherwise be showing so a
selection stays identifiable even in monochrome-line mode.

The actual work was almost entirely elsewhere, though: every other feature
built into this material system over the last several sessions — texture
overrides, per-element override cloning (so editing one slab's material
can't leak onto a sibling sharing the same GLTF material instance), the
selection-tint tiers, AO/Displacement, subdivision — was written assuming
`child.material` was *always* the one real `MeshStandardMaterial`, because
until today it always had been. The moment a render mode needs to swap
`child.material` to a Lambert/Phong/unlit stand-in for display, every one
of those systems needed one place to keep meaning "the real underlying
material" regardless of what's actually rendered this frame — solved by
anchoring it once per mesh (`userData.standardMaterial`, captured the very
first time the material effect ever runs for that mesh, before any render-
mode swap could have touched `child.material` yet) and rerouting the
existing override/clone/tint logic to read and write *that*, only
resolving the final on-screen material as the very last step.

Two real regressions this uncovered on its own, in code this session never
otherwise touched: the "everCustomized → needsUpdate" flag never fired for
a pure render-mode change on an element with no texture overrides at all —
`flatShading` is a shader-compile-time parameter (confirmed directly in
three.js's own `WebGLPrograms.js`, not assumed), so Flat Shaded wouldn't
actually take visual effect on an untouched element without an explicit
recompile trigger. And separately, the 4D timeline/animation-profile
system's own `collectStandardMaterials` — built for date-based colour/
opacity playback, nothing to do with render modes at all — read
`child.material` directly and filtered to `instanceof MeshStandardMaterial`;
once a render mode could swap that reference to a different class, that
filter would have started silently finding nothing to animate on any
element with Gouraud/Phong/Hidden Line active, breaking 4D playback colour
in a way that would have looked like an unrelated bug in a completely
different feature. Both catches came from grepping for every other place
in the module that reads `.material` directly, not from testing render
modes in isolation — the real risk in a change like this was never the six
render modes themselves, it was everything built earlier that quietly
depended on there only ever being one kind of material.

Disposal needed the same "don't just free whatever's currently showing"
treatment already given to subdivided geometry — a mesh's real PBR material
can now be one thing while a cached Gouraud/Phong/Hidden-Line stand-in
sits unused in its `userData` (e.g. the user tried Gouraud, then Phong —
both stay cached simultaneously, only one ever displayed at once), so
unload now disposes every material a mesh might be holding onto
(current display + the real standard material + every cached variant),
deduplicated, not just the live one.

## 2026-07-11 (still same day) — Phong dropped same-day, and "real-time path tracer" turned into something buildable

Two quick follow-ups closed out the render-mode work. First, Maro tried the
new dropdown and asked to drop Phong Shaded, keeping Wireframe/Hidden Line/
Flat/Gouraud/Rendered(PBR) — removed the code path entirely rather than
just hiding it from the UI (a `getRenderModeVariant(source, 'gouraud' |
'phong')` collapsed to a single-purpose `getGouraudVariant(source)`, one
fewer cached variant key to track through the disposal/caching machinery
added just hours earlier) — dead, unreachable branches aren't worth
carrying once a feature's actually been used and trimmed back.

Second, and more interesting: "ok real time path tracer, i just wont move
around so it gives me a good preview." Checked what that would actually
require before writing anything — `three-gpu-pathtracer`'s own
`peerDependencies` want three.js ≥0.180; this app is pinned to 0.169, 11
minors behind, with a lot of direct three.js internals usage elsewhere in
this same module (custom BufferGeometry building, material property
access) that a jump that size could plausibly break. Laid out the real
cost (version bump + regression risk + WebGPU + 3 new dependencies) before
touching anything, and asked whether to de-risk the upgrade first, do it
all at once, or take a lower-risk alternative that stays inside the
existing raster pipeline. Maro picked the alternative.

What that turned into: "real-time path tracer, but I won't move the camera"
is actually a well-known, much cheaper trick — boost the existing raster
pipeline's own quality knobs only while the camera is genuinely idle, since
none of them are affordable to run at full strength during live orbiting.
Tracks OrbitControls' own real 'start'/'end' interaction events (not
polling for "no mouse movement"), and while idle: supersamples via R3F's
own `dpr` prop (clamped to [1,2] normally, [1,3] idle), doubles N8AO's
`aoSamples`/`denoiseSamples` (16→64, 8→32 — verified as real, tunable knobs
by reading N8AOPostPass's own source rather than guessing what
`@react-three/postprocessing`'s wrapper exposes), and doubles the shadow
map resolution. Not real path tracing — no global illumination, accurate
reflections, or soft shadows from actual light transport, still the same
underlying look — but a genuine, honestly-scoped improvement to how clean
that look is, built with zero new dependencies and no version bump.

The "also include these options when I want to capture" half of the ask
turned Capture from "always instant" into "always high quality" —
mid-interaction Capture clicks now force the same boosted settings on,
wait a few *real* animation frames (a React state update isn't synchronous
with what next actually gets drawn to the canvas — the naive version would
have screenshotted the *pre-boost* frame) before reading pixels back, then
revert. An idle Capture click already sees boostQuality=true and skips the
wait entirely, so nothing about the common case (frame the shot, pause,
then click Capture) got slower.

## 2026-07-11 (still same day) — "Go automode": HDR-in-capture, real render settings, and a dpr bug the new work surfaced

Maro said "welldone, go automode and implement the others also" — the
remaining pieces from the earlier render-modes planning pass — plus a
specific new ask: an option to show the HDR background specifically when
capturing/exporting, independent of whatever the live viewport happens to
be showing.

**Render/Capture Settings**: a new popover (gear icon, next to Capture/
Export Video) with Show HDR Background, Resolution (1×/2×/4×), and — for
Export Video — Duration and Frame Rate, persisted the same
load/save-to-localStorage way as ViewerSettings but kept as its own
separate settings object (`renderCaptureSettings.ts`) since these describe
what an *output* should look like, not the live working view. HDR
background specifically needed a real override mechanism, not just reading
the live setting: `captureBackgroundOverride` forces `<Environment>`'s own
`background` prop to whatever the popover says right before a capture/
export, independent of the live `environmentBackground` toggle, then
reverts — same "force a state, wait a few real frames, then revert"
pattern the idle-quality boost from earlier today already established for
video export used it continuously for the whole recording, not just a
few frames, since it keeps redrawing for several seconds rather than
reading back one frame.

**A real dpr bug, caught while building Resolution, not looked for on its
own**: wiring an explicit resolution multiplier meant re-deriving exactly
how the earlier idle-quality boost's own supersampling worked — and
`@react-three/fiber`'s own source (`calculateDpr`) showed `dpr={[min, max]}`
*clamps* `window.devicePixelRatio` into that range, it does not multiply
it. On a standard 1× desktop monitor (the common case on Windows,
devicePixelRatio === 1), `[1,3]` and `[1,2]` both clamp to exactly 1 —
identical results. The earlier "supersampling boost while idle" had been a
silent no-op the entire time on that hardware, only ever doing anything on
an already-HiDPI display already reporting >2. Fixed by computing a real
multiplier (`window.devicePixelRatio * dprMultiplier`, capped at 4) instead
of a clamp range — this is exactly the kind of thing that never surfaces
from code review or typechecking, only from actually tracing through what
a number *means* before building a second feature on the same foundation.

**Camera Views + FOV — deliberately not built**: the original plan (from
several sessions ago, before this one) included extending saved Camera
Views with field of view. Read the backend model's own docstring before
touching it: `CameraView`'s own model file already documents, from an
earlier session, that FOV was *deliberately* excluded — "a saved view just
repositions the existing camera, it doesn't change the lens," FOV treated
as one global viewer-wide setting rather than a per-viewpoint property.
That's a reasoned decision already made, not a gap this session happened
to notice — skipped it rather than silently reversing someone else's
(this same assistant's, in an earlier session) documented reasoning without
being asked to.

**Fly Mode**: drei's `FlyControls` (free 6-DOF: drag-to-look + WASD/R-F
movement, no orbit pivot) swapped in for OrbitControls via conditional
rendering, toggled from the toolbar — "navigate from inside the camera"
the way Blender's own Fly Navigation works, as opposed to this app's
existing orbit-around-a-target model. The two control schemes don't share
meaningful state (OrbitControls has a `target` point to orbit; FlyControls
has none), so rather than trying to force one ref to serve both, Save
View/Frame Selected (which read the orbit target) are just disabled with a
clear reason while flying — both already no-op safely via their own
existing null checks either way, the disable is purely about not leaving a
button that silently does nothing with no explanation.

**Real-time path tracing — checked and explicitly descoped, not silently
skipped**: before touching anything, confirmed `three-gpu-pathtracer`
requires three.js ≥0.180 against this app's pinned 0.169 (11 minors
behind), a real regression risk given how much of this codebase reaches
directly into three.js internals already. Laid out the actual cost (version
bump + WebGPU + 3 new dependencies) and asked before proceeding; Maro chose
the lower-risk path (boost the existing raster pipeline while idle) instead
of the version-bump/new-pipeline route. Recorded as its own thing, not
folded into "done," since it's a materially different feature (no real
global illumination/accurate reflections) that could still be revisited
later with the real cost now already known rather than needing
re-discovery.

## 2026-07-11 (still same day) — Paths / "Follow Path": a migration that never
## created its own tables, then a whole feature's frontend built from a
## backend-only checkpoint

Picked back up mid-feature: an earlier pass this same day had built the full
backend for Blender's "Follow Path" (per Maro: "in blender you can add a
curve, edit it and set a path from point a to be... i can then place an
object to follow that path") — `Path`/`PathFollower` models, schemas,
services, routes, wired into `main.py`, plus `ElementKeyframe` extended with
a `path_progress` field and a `camera` source_kind — but stopped there, with
zero frontend and an unrun migration.

**The migration itself was broken before touching any frontend code.**
Named `add_paths_and_path_followers_tables`, but its `upgrade()` never
actually created either table — autogenerate had instead picked up an
unrelated `postgresql_nulls_not_distinct` metadata drift on eight completely
different tables (cost/ICD/risk unique constraints) and the real
`create_table` calls never made it into the file at all. Running it as-is
would have left every new endpoint 500ing against tables that don't exist,
while the migration history claimed they'd been created. Caught by actually
reading the generated file before running `alembic upgrade`, not by running
it and seeing what broke — deleted it, regenerated fresh, and manually
stripped the same unrelated constraint-drop noise back out of the new one
(left a comment explaining why, so it doesn't look like an oversight next
time autogenerate is run against this schema). A concrete instance of a
standing project habit paying off: verify a generated artifact does what its
own name says before trusting it.

**Then the actual frontend**, built to match this app's own established
conventions rather than inventing new ones: `paths.ts`/`pathFollowers.ts`
(plain CRUD clients, same shape as `sectionBoxes.ts`), `pathCurve.ts` (a thin
wrapper over three.js's own `CatmullRomCurve3` — Blender's Follow Path is
conceptually exactly this: a smooth spline walked by arc-length parameter,
`closed` mapping straight onto the curve's own cyclic flag), `PathGizmo.tsx`
(the curve line + draggable control-point handles, plus a click-to-place
mode for adding new points), and `PathsPanel.tsx` (a new dockable panel
alongside Sections/Camera Views/Collections). Two real scope questions came
up that weren't obvious from the code alone, asked rather than guessed:
click-to-place vs. a numeric point list (Maro picked click-to-place, closer
to how Blender's own curve-draw feels), and whether camera-path-following
should ship this pass (deferred — object-following only, camera binding
left for later, since it would've meant a third camera-control mode
alongside OrbitControls/Fly Mode this session never touched).

**Click-to-place needed to "win" over the viewport's existing, already-
complex click handling without touching it.** Rather than threading an
add-point-mode check through `ModelObjects`' selection/box-select/isolate
logic, `PathAddPointCatcher` attaches a *native* `pointerdown` listener on
the canvas element in the capture phase and calls `stopPropagation()` —
capture-phase listeners run before React Three Fiber's own bubble-phase
event system gets a chance to fire any per-mesh handler, so add-point mode
needed zero changes to any existing selection code to take priority while
it's active.

**Follow Path reuses `ElementKeyframe`'s date-keyed machinery for
`path_progress`, exactly as the backend was designed to** — a "Mode C"
resolution pass added alongside the existing Mode A (schedule-driven) and
Mode B (manual keyframe) passes in `TimelinePlayback`, mesh-kind targets
only (same v1 scope Mode B itself already has, for the same reason: no
stable per-sub-element identity for an IFC selection yet). Deliberately
*not* folded into `ResolvedTimelineTarget`'s own `keyframeTracks` shape — a
path-bound object's position is computed directly from the curve at whatever
`path_progress` says, not offset from a captured base position, so it's a
structurally different kind of target, resolved and applied as its own
parallel pass. `TransformPanel`'s Location fields lock read-only the moment
an object has a live `PathFollower` binding (with a one-line explanation why
in the UI) rather than staying editable-but-silently-overwritten every
frame — the same lesson from this same day's earlier keyframe-locking bug,
applied preemptively this time instead of needing a bug report first.

**Verification**: 19 new backend tests (paths CRUD, follower upsert-not-
duplicate semantics, cascade-delete, the new `path_progress`/`camera`
keyframe fields) all pass; the full existing suite stayed green (593 passed,
one pre-existing `test_create_activity` flake that passes standalone —
unrelated to anything touched here, not chased further). Frontend
`tsc --noEmit` and a real production `vite build` both came back clean. What
this pass could *not* verify: the actual in-browser interaction (click a
point, drag a handle, watch an object follow) — this app's real Auth0 login
has no dev bypass, and this environment has no headless-browser driver
available, so both dev servers were started and left running (backend on
:8000, frontend on :5173) for a manual check instead of a claimed-but-
unverified "done." A real gap worth closing before the next 3D-viewport
feature needs the same kind of check: this project has no scripted way to
get a logged-in browser session for automated smoke-testing yet.

## 2026-07-12 — Follow Path's frontend actually got exercised, and it took
## four separate bugs before it truly worked

The previous entry's own worry ("no scripted way to get a logged-in browser
session") played out exactly as flagged: manual testing turned up four real
bugs in the Follow Path frontend, none of which typecheck/build/the
existing test suite could have caught, each only visible by actually
watching an object try to move.

**Bug 1 — the object never sat on the curve at all**, landing near the
model's own centre instead. Path points are captured in *world* space
(`PathAddPointCatcher`'s own raycast `hit.point`), but every imported
object sits inside its own up-axis-correction `<group>` (`Viewport3D`'s
per-object wrapper reconciling a file's authored up-axis against the live
viewer setting) — `object.position` is *local* to that group, not world
space. `applyPathFollow` was copying the raw world-space curve point
straight into `object.position`, silently wrong the moment that group's
correction rotation wasn't identity (i.e. the moment source and display
axes actually differed — which is exactly when Maro was testing, "Z up
(Blender)"). Mode A/B never needed this conversion because they only ever
offset from an object's own already-local `basePosition`; Mode C was the
first feature to inject a value from outside the object's own space at
all. Fixed with a `toLocalPoint` helper (`object.parent.worldToLocal`) —
`lookAt` didn't need the same treatment, three.js's own implementation
already converts its target through the parent's world matrix internally.

**Bug 2 — Play did nothing at all, not even the clock.** `scheduleRange`/
`keyframeRange`/`timelineRange` in FourD.tsx were plain per-render function
calls, handing back a brand-new `Date`-bearing object on *every* render
regardless of whether activities or keyframes had actually changed.
TimelineWindow's own Play button runs a `requestAnimationFrame` loop that
depends on `scheduleStart`/`scheduleEnd` *by identity* to keep accumulating
real elapsed time across frames (`lastTimeRef`) — a fresh identity on any
unrelated re-render tore that effect down and rebuilt it, resetting
`lastTimeRef` to null before a meaningful delta could ever accumulate. Play
looked completely frozen; a manual scrub worked fine since it's
self-contained local state inside TimelineWindow, untouched by this.
Wrapped in `useMemo` keyed on the real inputs.

**Bug 3 — the same identity-churn bug, one level further downstream.**
`resolvedPaths` (a `.map()` over `paths`, applying an in-progress drag
preview) had the identical problem: a fresh array every render, feeding
into `Viewport3D`'s own `paths` prop — a dependency of `TimelinePlayback`'s
own path-resolution effect. Selecting a scene object makes the whole
module re-render on literally every animation frame already (`onTick` ->
`setTransformTick`, so TransformPanel's Location fields stay live during
Mode A/B playback), so this was tearing that effect down and rebuilding it
60x/sec while anything was selected. Also wrapped in `useMemo`.

**Bug 4 — the real one, once the clock actually ran: the object still
didn't move during Play, only "snapped" to the right spot the instant
Pause was hit.** Traced by re-deriving the exact per-frame ordering rather
than guessing further: Mode B's own per-object keyframe-track loop builds
a `tracks` map from *every* `ElementKeyframe` row matching that object,
with no filter on `field` — including `path_progress`, which is Mode C's
own reserved field (consumed separately, into `progressTrack`, a few lines
below). A path-bound object with a `path_progress` keyframe therefore
*also* qualified as a Mode B target, with `keyframeTracks = { path_progress:
[...] }` and no `pos_x`/`pos_y`/`pos_z` entries at all.
`applyKeyframedTransform` resets any axis with no matching track back to
`target.basePosition` — so, every single frame where the date had changed,
Mode C would correctly set the object's position from the curve, and Mode
B would run right after (same `useFrame` callback, same tick) and stomp it
straight back to its pre-bind position. Continuous Play changes the date on
literally every frame, so the stomp fired every frame, and the object never
visibly moved. Stepping or dragging only *looked* fine because the stomp
and Mode C's own next unconditional correction happen within about one
frame of each other — imperceptible as a single action, but the moment the
date kept changing every frame (Play), the stomp won every time. Fixed by
excluding `field === 'path_progress'` from Mode B's track-building loop.

All four were only findable by actually watching motion happen, or not
happen, in a running browser — exactly the gap the previous entry named.
None of them would have shown up in `tsc --noEmit`, `vite build`, or the
593+19 backend tests, which is the whole reason this project's own habit is
"verified increments, confirmed by the person actually looking at it" over
trusting a green build.

**Also added, same session, per Maro: "the keyframes on the timeline need
to be movable, editable, deletable"** — the diamond markers on
TimelineWindow's own scrubber were click-to-jump only, with no way to
reschedule or remove one without first navigating to its exact date. Now
draggable (native pointer events on the marker itself, since it isn't a
real range control — same clientX-to-date math the slider already uses,
just against the marker track's own bounding rect) with a live preview
while dragging, and right-click to delete. Both act on *every* field keyed
on that exact day at once, not one field at a time — matching Blender's own
dopesheet summary-row convention for a per-object track where several
channels share a frame, and matching what "a keyframe" visually means on
this scrubber (one diamond can represent several `ElementKeyframe` rows
underneath). There's no PATCH route for this table, so "move" is
implemented client-side as create-at-the-new-date-then-delete-the-old,
reusing the same insert-or-overwrite-at-this-exact-date semantics the POST
route already has — deliberately not adding a new backend endpoint for what
two existing calls already cover. Not yet manually verified in-browser
(written and shipped for Maro to check on waking, same "server left running
for a real check" situation as the rest of this feature) — `tsc --noEmit`
and `vite build` both clean.

## 2026-07-12 — Placemark/Footnote/Comment: reusing two existing tables
## instead of building a third animation system

Maro sent a Navisworks screenshot (Comment/Footnote/Placemark toolbar) and
asked for the same, with two ways to animate a Placemark/Footnote: manual
keyframes, or "you use the profiles to pop a placemark" — and, shown the
actual Animation Profile editor (Trigger/Transform/Opacity/Colour/
Interpolation), confirmed it should just work with that existing system,
not a simplified version. Planned properly first (EnterPlanMode) given the
size — a new spatial entity, tied into both animation modes, plus a
separately-scoped review-comment flow — rather than guessing at scope
mid-build.

**The key design decision, and the one that kept this from becoming its
own parallel animation system**: `ModelElementLink` and `ElementKeyframe`
are already polymorphic on `source_kind` (`"ifc"`/`"mesh"`, plus `"camera"`
from Follow Path). Adding `"annotation"` as a third value — element_ref is
the Annotation row's own id — meant a Placemark/Footnote could link to an
Activity + AnimationProfile, or get manual position/`visible` keyframes,
using the *exact* existing tables, existing endpoints, existing frontend
CRUD, and existing pure functions (`computeAppliedAnimationStateAt`,
`interpolateKeyframeTrack`). Zero new animation math. This is the same
pattern `path_progress`/`source_kind="camera"` already established for
Follow Path — extend the two tables that already carry Mode A/B data
rather than inventing a fourth data model each time a new thing needs to
move on a timeline.

**Comment is deliberately a separate, much simpler table** — attached to a
CameraView, no 3D position, not animated, since a real review comment
belongs to "the shot," not a point in space. Splitting it out kept the
whole animation-integration effort scoped to just Annotation (Placemark +
Footnote), which actually needed it.

**Resolution architecture — a real lesson carried forward from tonight's
own four-bug Follow Path debugging session, applied preemptively this
time**: rather than folding a fourth mode into `TimelinePlayback`'s already
large central resolver (which every one of tonight's earlier bugs lived
inside), each `AnnotationMarker` resolves its *own* Mode A/B state in its
*own* `useFrame`, reading the same already-memoized `activities`/
`modelElementLinks`/`animationProfiles`/`elementKeyframes` props
`TimelinePlayback` already receives. A marker is an Html overlay + a plain
unwrapped mesh, not a `THREE.Object3D` with a `MeshStandardMaterial` for
that resolver's own machinery to touch anyway — decentralizing it wasn't
just safer, it was the more natural fit. Everything inside that `useFrame`
mutates refs directly (position, material opacity, a DOM node's own
`style.opacity`/`display` for the Html label, the leader line's buffer
geometry) rather than React state, deliberately avoiding the exact render-
churn bug class (`resolvedPaths`, `timelineRange`) tonight's earlier
session spent hours tracking down.

**Two real gaps caught by TypeScript, not by guessing** — widening
`ModelElementLink.source_kind` naively (a shared `SourceKind` type used
everywhere, including Collections member-ref resolution and the
mesh/IFC-only Activity-linking UI) broke type-checking in three unrelated
files, because those call sites correctly assume only real geometry can
appear there. Fixed by introducing a second, wider
`ModelElementLinkSourceKind` type just for the one place that actually
needs `"annotation"`, leaving every existing consumer's stricter assumption
intact — and by explicitly filtering `source_kind !== 'annotation'` out of
`resolveActivityLinksToIsolationTargets` (Isolate has nothing to resolve an
annotation link to; letting it through silently would've been a real,
if minor, runtime wrong-behaviour bug the type system happened to catch
first).

**A near-circular-import**, caught before it became a build error:
`AnnotationMarker.tsx` needed `pickActiveLink`/`ResolvedTimelineLink` (the
"which of several links is chronologically active" logic), which lived
inside `Viewport3D.tsx` — but `Viewport3D.tsx` needs to import
`AnnotationMarker.tsx` to render it. Moved both to `timelinePlayback.ts`
(the existing home for this exact class of pure animation-math function)
rather than duplicating the logic or fighting the circular reference.

**Scope decisions made and written down, not silently assumed**: icon is a
small fixed emoji-glyph set, not custom-uploaded images; a Footnote's
leader target is mesh-kind only in v1 (same "no stable per-sub-element
identity yet" reasoning every other IFC-adjacent feature this session has
already landed on for keyframing/Follow Path); dragging a marker persists
its own base `position_x/y/z` even when Mode B keyframes exist for it,
same "editing the base value doesn't fight the animated display until you
understand the precedence" behaviour TransformPanel's own fields already
have for meshes.

Backend: 14 new tests (`test_annotations.py`, `test_comments.py` —
CRUD, cascade-delete on project/camera-view removal, the new `visible`
keyframe field, `source_kind="annotation"` accepted by both polymorphic
tables), full suite 621 passing (607 + 14, no regressions). Migration
verified before running (habit paying off again — this one's
`create_table` calls were actually present this time, unlike the Follow
Path migration two entries up). Frontend `tsc --noEmit` and `vite build`
both clean. Not yet manually verified in-browser — same standing gap this
project has (no Auth0 dev bypass, no headless browser here) — dev servers
left running for Maro to check on waking: place a Placemark, drag it, key
its visibility, link one to an Activity's existing profile and confirm
Play actually animates it using that profile's own settings.

## 2026-07-12 (later same day) — Two real bugs found by actually clicking
## it, then a redo once a fuller reference photo showed the first pass
## "wasn't nice"

The very first thing tried after waking up threw 404s on the new
`/api/v1/annotations/`/`/api/v1/comments/` routes. Turned out to be a real
process-management bug, not a code bug: an earlier session's backend
restart had killed the reloader parent but not the worker it had spawned
via Python's own `multiprocessing.spawn_main` — Windows `taskkill /F` on a
parent doesn't touch orphaned children by default (needed `/T` for the
whole tree). That orphan had been serving every request since the *previous
night*, quietly running yesterday's code the whole time this session's own
`main.py` changes were being made — a second attempted restart made the
exact same mistake before `Get-CimInstance Win32_Process -Filter
"ProcessId=..." | Select CommandLine` on the still-listening PID finally
showed the `parent_pid=` giveaway. Fixed by actually killing every
`python.exe` process before relaunching, not just the one PID that seemed
like "the server."

**A second, much smaller bug**: a brand-new Comment started with
`text: ""`, and the row's non-editing display was just `{comment.text}` —
a genuinely empty, invisible `<span>` with nothing on the page to
double-click. Fixed two ways: a placeholder ("click to add a note") for
the empty state, and defaulting a fresh comment straight into edit mode so
there's nothing to discover in the first place.

**Then the bigger correction.** Maro sent a second, much fuller Navisworks
screenshot (the actual 3D View Properties → 3D Notations panel, live
viewport, full property grid) and said the first pass "is not nice."
Comparing against it surfaced three real gaps, confirmed via follow-up
questions rather than guessed at:

1. Comment had been modeled as a review note attached to a saved Camera
   View, no 3D position — because the *first* screenshot was just a
   toolbar dropdown with no shape information to go on. The fuller
   reference showed Comment listed in the same "3D Notations" list as
   Footnote/Placemark, same property grid, same everything — a spatial
   marker, not a viewpoint-scoped note. Wrong shape, not a styling
   miss — worth calling out because it's exactly the risk of building
   from a single toolbar icon's dropdown with no further reference: the
   *names* were right, the *shape* was a guess.
2. The note text itself was a tiny icon plus a hover-only badge — the
   reference's own "Area:"/"Length:" boxes are permanently visible,
   styled callout boxes connected to their point by a real leader line.
3. No style controls at all beyond a single colour swatch, against a
   reference with a full Design/Colors/Behavior property grid (background/
   border/text colour, font size, thick border, distance-based hide).

Given Comment needed to become a spatial `kind` anyway, the whole
CameraView-attached `Comment` model/table/panel from earlier that day got
deleted outright rather than migrated — same-session, unshipped work, nine
files gone in one pass (`comment.py` model/schema/service/api,
`comments.ts`, `CommentsPanel.tsx`, `test_comments.py`, plus every bit of
`FourD.tsx` wiring: state, handlers, panel registration, toolbar button,
localStorage keys, the `activeCameraViewId` tracking added specifically
for it). `Annotation` absorbed `kind="comment"` and eight new columns
(`has_background`, `background_color` — renamed from the old single
`color`, keeping existing values via `UPDATE ... SET background_color =
color` in the same migration rather than silently discarding them —
`border_color`, `thick_border`, `text_color`, `font_size`,
`hide_closer_than`, `hide_farther_than`), all added with real
`server_default`s since the table already had a live row from the first
pass's own testing — a bare `NOT NULL ADD COLUMN` against existing data
fails outright, not something autogenerate writes on its own.

**Rendering redo**: Placemark is now a real Google-Maps-style balloon pin
(the classic `border-radius: 50% 50% 50% 0; rotate(-45deg)` CSS trick,
inner content counter-rotated so the icon reads upright) instead of a
plain hover badge. Footnote/Comment render as an always-visible callout
box using every one of the new style fields, floating a fixed world-unit
height above its own anchor point on a real 3D "stem" line — plus, when
bound to a mesh element, a *second* leader line straight to that element's
live position, so it keeps pointing at a moving/animated target rather
than a fixed spot. Distance culling (`hide_closer_than`/
`hide_farther_than`) is one more per-frame check ANDed into the same
`shown` boolean the existing Mode A/B visibility resolution already
computes — same ref-mutation, no-React-state architecture as everything
else in this marker, carried forward deliberately rather than becoming a
third source of the render-churn bug class chased down earlier this
session.

Backend: extended `test_annotations.py` (comment kind, every new style/
behaviour field, a font-size-out-of-range rejection case), `test_comments.py`
deleted along with the feature it tested. Frontend `tsc --noEmit` and
`vite build` both clean. Not yet manually re-verified in-browser — same
standing gap, and this time worth checking specifically: does the callout
box actually read clearly against the model, does a bound leader line keep
tracking a moving element, does distance culling visibly kick in when
zooming past the configured bounds.

## 2026-07-12 (later still) — "So what's the difference" turned into real
## Comment/Footnote differentiation, then two more rounds of the profile-
## vs-path fight, then a proper multi-track dope sheet

**Comment vs Footnote had no real difference** — Maro noticed both
rendered identically apart from the label, a fair catch: the redo earlier
today had unified them down to the same box style with no distinguishing
default. Fixed with two independent things, both requested together: (1)
`status` ("open"|"resolved") added to Annotation, meaningful only for
kind="comment" — a Footnote is a permanent technical callout with nothing
to resolve, a Comment is a review note you close out, matching real
Navisworks semantics; resolved comments dim to 50% opacity and strike
through, folded into the *same* per-frame opacity write `useFrame` already
owns (a static CSS opacity would've just been overwritten every frame by
the Mode A/B-resolved value — same lesson about who owns what style
property, applied on sight this time rather than needing to be
rediscovered). (2) Kind-specific defaults: Footnote now defaults to 🚩,
Comment to 💬 (Placemark keeps 📍), plus Comment gets rounded speech-
bubble corners vs Footnote's sharp technical-callout ones — cosmetic, but
immediate and free.

**Then "the path animation doesnt work with the profiles"** — a real
regression from the very first Mode-A-vs-Mode-C fix a few entries up. That
fix only guarded Mode A's own transform block against a path-bound object.
Reported fixed, then immediately reported broken again ("profile + path
now both fight/glitch") — the *second* look found Mode B's
`applyKeyframedTransform` has the exact same flaw: it resets any axis with
no explicit keyframe back to `basePosition`, so a path-bound object that
also happened to carry an unrelated keyframe (rotation, or a leftover
position key from earlier testing) got stomped by *that* code path
instead, unaffected by the first patch. Two one-off exclusion checks in a
row, both incomplete, was the tell that this needed a structural fix
instead of a growing list of "and also skip this if path-bound" guards
sprinkled through every mode. Fixed by reordering instead: Follow Path
(Mode C) now applies dead last in the per-frame loop, after Mode A and
Mode B have both had their say — path position is unconditionally the
final word for a bound object every frame, full stop, with zero awareness
required in any other mode. Opacity/colour are a separate, untouched code
path, so a path-bound object linked to a profile still fades/recolours
correctly on top of following the curve.

**Then the actual feature ask**: "underneath the animation timeline...
actors with a sub line with keyframes on those, so the preset, and 3d path
and the transform ones" — the single scrubber's diamond markers only ever
showed the *current viewport selection's* keyframes, one pooled row for
all nine transform fields. Planned properly (confirmed: Location/Rotation/
Scale as three separate sub-lines not one pooled line; every mesh/IFC/
Annotation actor included, not just meshes; Preset stays read-only here —
dragging its bar would mean rescheduling the underlying Activity itself, a
genuinely different, schedule-editing feature). Built as a new
`AnimationActorsList.tsx`, project-wide rather than selection-scoped:
actor identity is `{sourceKind, elementRef}` unioned across
`modelElementLinks`/`elementKeyframes`/`pathFollowers` (memoized on those
three already-stable arrays — deliberately not a new instance of this
session's own render-churn bug class), each actor showing only the
sub-tracks it actually has data for (Preset bars from linked Activities'
own start/finish, 3D Path/Location/Rotation/Scale as day-grouped, drag-to-
move/right-click-to-delete markers). The editable sub-tracks reuse
TimelineWindow.tsx's own existing single-actor marker drag interaction
verbatim, generalized to whichever day-grouped list a given actor+field
resolves to instead of always the current selection, and call straight
through to the same `onMoveKeyframes`/`onDeleteKeyframes` in FourD.tsx —
already generic over any `ElementKeyframe[]`, so this needed zero backend
or handler changes, purely new UI plumbing over data every other panel in
this file already loads project-wide. IFC actors are shown but not
click-to-select (would need the same async GUID→expressID web-ifc lookup
Mode A's own resolution does, not worth it for a click handler yet — same
"IFC sub-element identity is v1-out-of-scope" line this session has drawn
several times already). `tsc --noEmit`/`vite build` clean; not yet
manually checked in-browser.

## 2026-07-12 (later still) — "Advanced 4D": baseline vs actual, brought
## into the 3D viewport itself

Maro asked for baselining/variance analysis in the 4D module. Turned out
the *scheduling* half already existed end-to-end — `ScheduleBaseline`
capture/assign, `Activity.bl_start`/`bl_finish`/`variance_days`, Gantt
ghost bars, Activity Table columns, all built and working — confirmed by
research before writing a line of code, so nothing there got rebuilt. What
was actually missing was bringing that comparison *into the viewport*:
colour-coding elements by variance, and a second, dockable, resizable 3D
pane showing the same model animated from the baseline's dates instead of
the live ones, side by side with the real one.

**The one real technical question, thought through before building**: a
`THREE.Object3D` can only belong to one scene graph, so the same imported
mesh/IFC hierarchy can't be mounted into two `<Canvas>`es. Cloning beats
re-importing (three.js already shares `.geometry`/`.material` by
reference on `Mesh.copy()` — no GPU buffers get duplicated, only the
lightweight scene-graph nodes) — but not via `Object3D.clone()` itself:
its own `copy()` does `JSON.parse(JSON.stringify(source.userData))`, and
by the time a mesh has been on screen for even a moment, `ModelObjects`
has already hung real, non-JSON-serializable object references off
`userData` (`standardMaterial`, `subdividedGeometry`, `edgesHelper`).
`sceneClone.ts`'s `cloneSceneHierarchy()` walks the tree by hand instead —
new Mesh/Group per node, geometry/material by reference, only the one
genuinely safe userData key (`expressID`, a plain number) — sidestepping
the risk rather than trying to sanitize three.js's own copy path.

Mode A (Activity+AnimationProfile) turned out to be the *only* animation
source that reads Activity dates at all — Mode B (manual keyframes) and
Mode C (Follow Path) aren't schedule-driven, so a baseline pane plays them
identically to the live pane automatically, no special-casing needed.
`TimelinePlayback` (Viewport3D.tsx) got exactly one new prop,
`dateField: 'live' | 'baseline'`, swapping which two Activity fields feed
Mode A's own resolution window — everything downstream
(`ResolvedTimelineLink`, `pickActiveLink`, `computeAppliedAnimationStateAt`)
stayed untouched, since it already just consumes whichever dates got
resolved in.

**A real bug caught before it shipped, not after**: the new
`BaselineViewportPane`'s own clone-cache `useMemo` initially listed
`importedObjects` itself as a dependency alongside a content-based
position/rotation/scale string. `FourD.tsx`'s own `viewportObjects` (what
feeds *both* the primary viewport and this new pane) has always been a
plain `.map()` recomputed fresh every render — fine for the primary
viewport's own cheap per-render re-map, but including that ever-fresh
array in this *specific* memo's dependency list would have made it
recompute — re-cloning the *entire* scene hierarchy — on literally every
render, since React reruns a memo the instant *any one* dependency's
identity changes, regardless of whether the content-string one actually
changed. Dropped the array from the dependency list entirely (the closure
already reads the current `importedObjects` when the memo *does* run; the
string alone is what should gate whether it runs at all) — caught by
re-reading the diff before calling this done, not by anyone actually
hitting the perf problem live.

**A genuine editing mistake, caught immediately by diffing against `git
HEAD` rather than trying to eyeball-fix a garbled multi-thousand-line JSX
tree**: reusing the single `<Viewport3D>` invocation in two different
structural positions (standalone, or as `SplitRow`'s first child) needs a
plain variable, since JSX can't parametrize "render this exact element in
either of two spots" without one — but the first attempt at extracting it
went wrong mid-edit and left the file with a duplicated, half-orphaned
copy of the whole prop block outside any return statement. Rather than
trying to manually patch the mess, `git diff --stat` (a suspiciously
large, pure-insertion diff) plus `git diff` itself (showing exactly which
hunk was the bad one, since every other change that same edit pass made
was correct and staged fine) made the actual damage obvious and let it get
surgically removed in one clean revert, then redone properly: the
`<Viewport3D>` JSX pulled out into a `const viewport3DElement = (...)`
*before* the component's own `return`, referenced by both the
`compareBaselineOpen` ternary's branches — one extraction, zero
duplicated prop lists. Worth remembering: when a multi-part in-place edit
goes visibly wrong, checking the diff against the last commit is a faster
and safer way back to a known-good state than trying to hand-repair
whatever's now on screen.

Backend: zero changes — this entire feature reads data (`bl_start`/
`bl_finish`/`variance_days`) the Scheduling module already fetches and
returns on every `Activity`. Frontend `tsc --noEmit`/`vite build` clean.
Not yet manually checked in-browser — same standing gap as always, and
this time specifically worth checking: does the split stay usable/
resizable, does toggling Variance Colours actually tint a baselined,
behind-schedule element red, and does the baseline pane's own animation
timing visibly diverge from the live pane wherever `start`/`finish` and
`bl_start`/`bl_finish` actually differ.

## 2026-07-12 (even later) — Clash Detective: Navisworks-style clash
## detection, built on machinery that already existed

Maro asked for clash detection "similar to Navisworks" off a screenshot of
its Clash Detective dialog. Researched first (3 parallel Explore agents)
rather than assuming a blank slate, and it paid off: two of the three real
pieces this needed already existed. Collections (`collection.py`/
`collection_member.py`, built 2026-07-11) are already exactly Navisworks'
"Selection Set" concept — a loose, GUID-based `(source_kind, element_ref)`
grouping that survives reloads — so a clash test's "3D Object 1"/"3D
Object 2" groups became `group_a_collection_id`/`group_b_collection_id`
pointing at two existing Collections, not a second selection system built
in parallel. And `ifcModel.ts`'s `loadIfcModel` already builds one real
`THREE.Mesh`/`BufferGeometry` per IFC element (tagged `userData.expressID`,
confirmed by reading the loader rather than assuming) — so per-element
geometry was already addressable; the one genuinely new piece was the
geometric intersection test itself, which didn't exist anywhere in this
codebase (every existing `Box3`/raycaster use is plane-clipping, camera
framing, or pointer-picking, never element-vs-element).

**The scope decision that kept this from becoming two features**: a clash
test's "Run" just reads whatever the viewport is showing *right now* — no
separate date-sweep engine. Mode A/B/C animation already drives every
mesh's `matrixWorld` for the current timeline position, so testing "current
state" is automatically 4D-aware for free: scrub to a date, hit Run, see
clashes at that moment — matching the screenshot's own "Dynamic Clash
Detection" framing without building a second engine that samples multiple
dates across a whole schedule (a materially bigger, separate feature,
deliberately deferred rather than half-built).

**Added `three-mesh-bvh`** (pinned to `0.8.0`, not whatever `npm install`
resolves by default — `0.7.8` came back flagged deprecated-for-this-
three-version at install time, worth reading install output instead of
just checking exit code 0) rather than hand-rolling triangle intersection.

**A real correctness bug caught during design, not after**: the natural-
seeming approach — build one `MeshBVH` per element's raw local geometry,
reuse it across every pair it's tested against, and pass three-mesh-bvh a
transform matrix per pair (its own supported API) — silently breaks the
moment an element's own local space carries a non-uniform-relative-to-world
scale (a Transform panel edit, an animated Mode B/C scale keyframe): a
`bvh.closestPointToGeometry` distance measured in that element's own local
units isn't the same number as a real-world distance once local and world
scale diverge, which would make "5mm clearance" quietly mean something
else per element. Avoided by baking each mesh into *world space* before
building its BVH (`sceneClash.ts`'s `buildWorldBVH`: clone geometry,
`applyMatrix4(matrixWorld)`, *then* build the tree) and comparing two
world-space geometries with an identity transform — simpler code, and
correct regardless of any element's own scale. Rebuilt fresh (cached only
for the lifetime of one `findClashes()` call, never across runs) rather
than cached long-term, which is also what makes re-running after scrubbing
the timeline automatically correct — a moved element just gets a different
world-space bake next run, no invalidation logic needed.

**A known, documented simplification, not an oversight**: distances/
tolerances assume scene units are already metres. `loadIfcModel` keeps
each element's geometry in that IFC file's own native unit with no
metre-normalization at import time (confirmed by reading the loader, not
guessed) — a project authored in feet would need a per-model correction
(`getLengthUnitToMetres`, already used by `TransformPanel.tsx`) this
doesn't do. Called out because no *other* geometry feature in this app
(box-select, camera framing, the section box) corrects for it either — the
same longstanding assumption, just newly load-bearing for a numeric
tolerance instead of a purely visual operation. Worth a real fix if a
mixed-unit project ever makes "5mm" mean something else in practice.

Backend: two new tables (`clash_tests`, `clash_results`, migration
`a65e5d591b8f`, the usual `postgresql_nulls_not_distinct` autogenerate
noise stripped). The one non-obvious piece of backend logic — bulk-
replacing a test's results on every "Run" without wiping the review status
of clashes that still exist — got its own dedicated test
(`test_replace_results_preserves_status_for_pairs_that_still_clash`) rather
than just trusting the diff-by-natural-key logic; all 7 new tests plus the
existing 619 pass. `tsc --noEmit`/`vite build` clean. Not yet manually
checked in-browser — worth checking specifically: create a test between
two Collections with a known real overlap, confirm Run actually finds it
and Approve survives a re-run, and confirm the viewport tint shows up
(Clash Colours toggle, off by default like Variance Colours).

## 2026-07-12 (later still) — Crane-style rigging: "Set Pivot" +
## pivot-based parenting, no bones/IK

Maro wanted mechanical animation (crane base -> jib -> trolley -> hook)
and shared three Blender reference approaches: pivot-based parenting (no
bones), bone/IK armatures, and formula-driven "drivers." Talked through
the tradeoffs before touching code: bones/IK are for organic/deformable
meshes (skinning, weight painting) and this app has no vertex-skinning
system at all — a crane's parts are rigid bodies, so real three.js
scene-graph parenting is the right analog, matching how Synchro/Navisworks
rig equipment too. Drivers (e.g. a hoist cable auto-stretching with hook
height) got scoped out as a genuine follow-up, not bundled in.

Two research agents found the good news early: Mode A/B already write
pure local-space `object.position/rotation/scale` every frame
(`Viewport3D.tsx`'s `TimelinePlayback`) — real three.js parent-child
nesting composes correctly under that with **zero changes** to existing
animation logic. The one real gap Maro caught before any code was written:
rotation/scale always pivots around an object's own local `(0,0,0)`,
wherever its source file happened to place that, and this app had no tool
to move that origin without moving the geometry — asked directly rather
than assumed, and the answer ("no, I need an in-app pivot tool too")
changed the shape of the whole pass, so it shipped as two parts.

**Part A — Set Pivot** (`elementPivot.ts`): Blender's own "Origin to 3D
Cursor." The one design choice worth recording: this is its own small,
fully isolated snapshot (`userData.prePivotGeometry`/
`prePivotChildPositions`/`prePivotPosition`), deliberately *not* reusing
`elementBaseline.ts`'s own `originalGeometry`/`baselineTransform` — those
already get repurposed by other features (baking, displacement
subdivision) to mean "state before *that* operation," not "the literal
as-imported file state," and pivot logic staying fully orthogonal avoided
any risk of the two fighting over what "original" means. Always
recomputes from that one lazily-captured snapshot rather than applying an
incremental delta per call, so setting the pivot twice (or clearing it)
never drifts. Reused `PathGizmo.tsx`'s `PathAddPointCatcher` verbatim a
third time (Paths, then Annotations, now this) for click-to-pick-a-point
— it already had zero Path-specific logic in it.

A real persistence gotcha caught before it shipped: `pivot_x/y/z` are
optional (`null` = no override) but `ElementTransform`'s save endpoint
always applies the *full* payload it's sent, with no partial-patch
semantics — if the frontend only sent pivot fields when the user was
specifically editing pivot, an ordinary gizmo drag (which also calls the
same save endpoint for position) would silently overwrite a previously-set
pivot back to null. Fixed by always carrying `object.userData.pivotPoint`
forward on *every* save regardless of what was actually being edited —
tested directly (`test_pivot_fields_round_trip_and_survive_unrelated_saves`)
rather than just trusting the frontend to always remember.

**Part B — Element Parenting** (`elementRigging.ts`, `element_parent.py`):
mesh-kind only, one parent per child, upsert-repoints exactly like
`PathFollower` — reused that table's own established shape rather than
`ModelElementLink`'s reject-with-409 one, since a child rigged to a new
parent should repoint, not error (same "drag a different curve onto the
constraint" reasoning). three.js's own `Object3D.add()` keeps a
reparented child's *local* transform as-is, which visually jumps it unless
that local transform happens to already be zero relative to the new
parent — `attachPreservingWorldTransform` computes the child's current
world matrix first, reparents, then decomposes
`parent.matrixWorld⁻¹ × childWorldMatrix` back into position/quaternion/
scale (Blender's own Ctrl+P "Keep Transform").

A rigged child is deliberately never mounted via its own `<primitive>` in
`ModelObjects`' flat mount loop — it just becomes a real three.js
descendant of its parent's already-mounted Object3D, the same pattern this
file already used for IFC sub-meshes (never individually JSX'd either).
Caught one real regression from that change before it shipped: the
whole-object hide/isolate `visible` flag was previously only ever applied
via that same `<primitive visible={...}>` JSX prop, so a rigged child
silently stopped responding to Hide/Isolate the moment it left the mount
loop — fixed by setting `object.visible` directly in the same effect that
does the reparenting, not just relying on the JSX prop that no longer
applies to it.

A second real gap, caught while writing `detachToSceneRoot` (clearing a
rig relationship): `attachPreservingWorldTransform`'s own "decompose
against the new parent's matrixWorld" trick needs a *live* Object3D to
target, but a plain top-level (unrigged) object isn't mounted directly —
it's wrapped in its own `<group rotation={axisCorrectionRotation(...)}>`,
a fresh React element created new every render, not a stable reference
this module could ever hold onto. Un-rigging can't reuse the attach
function at all for that reason; `detachToSceneRoot` instead recomputes
the same decompose against that wrapper's own rotation, derived from the
same pure `axisCorrectionRotation()` call the mount loop itself uses, not
a live reference to anything.

Explicitly out of scope, not solved: Follow Path (Mode C) and rig-
parenting don't combine on the same object — Mode C's `toLocalPoint`
deliberately re-derives local position from an absolute *world*-space
point every frame, which would fight a moving parent by design. Both
FourD.tsx's own bind handlers now block the combination in either
direction with a clear inline reason, rather than trying to resolve the
interaction this pass.

Backend: `element_transforms` gained three nullable columns
(`74d904d469cd`), new `element_parents` table (`67c8a435d12f`) with a
service-level cycle check (`_validate_no_cycle`, copied from
`collection.py`'s own — same walk-up-the-chain shape, unrelated domains
that happen to need the identical check) so two rigged parts can't
endlessly parent each other. 16 new tests (pivot round-trip, upsert-
repoints, self-parent rejected, cycle rejected) plus the existing suite —
all pass. `tsc --noEmit`/`vite build` clean. Not yet manually checked in-
browser — worth checking specifically: import two simple boxes, Set Pivot
on one to a corner and confirm it now rotates around that corner, rig the
second under the first and rotate the parent to confirm the child rides
along with no jump at bind time, then keyframe the child's own Location
and confirm it now moves relative to the (already-rotating) parent.

## 2026-07-13 — Four real bugs found via actual manual testing, in one
## session: pivot picking, duplicate filenames, the Scheduling Gantt
## chart, and a material-preset crash + storage ceiling

Maro actually tested the pivot/rigging feature above, and it surfaced two
real, independent bugs immediately:

**Pivot-picking hit the gizmo, not the model.** ("pick in viewport is very
bad") — TransformControls' own move/rotate/scale handles are real,
raycastable Object3Ds sitting right on top of whatever's selected, and the
pivot-pick catcher (`PathAddPointCatcher`, reused a third time) had no
reason to know to skip them, unlike its own curve/handle meshes which are
already tagged and excluded. Fixed by tagging the gizmo itself
`userData.isPathGizmo = true` via a ref callback on `<TransformControls>` —
reuses the exact existing exclusion check, benefits Paths/Annotations
placement too (same latent bug, just less likely to be hit there).

**Duplicate filenames broke Rigging silently.** ("you enabled all my
columns" — an unrelated theory that turned out to be the real filename
issue instead) — two files both literally named `Untitled.glb` (a common
default export name) are indistinguishable everywhere this app identifies
a mesh-kind element by name: Collections, Paths, links, and now Rigging.
The Rigging panel's own "which objects can be a parent" filter excludes
whatever's currently selected by name — with two identically-named
objects, that filtered out *both*, leaving nothing to pick and no
explanation why. Real fix, not a workaround: `ImportModelDialog.tsx` now
has an editable Name field, pre-filled from the file's own name — this *is*
the element's identity going forward (`uploadModel3DFile`'s `name` param
already existed on the backend for exactly this, just never had a text
input wired to it).

**The Scheduling Gantt chart "disappeared."** Two rounds — the first fix
(capping a *dragged* pane-width value) treated the wrong variable; the
real mechanism only showed up once Maro described the actual trigger
("you enabled all my columns"): the activity-table pane's width fell
through to `undefined` (no explicit width at all) whenever it had never
been manually dragged, so with `flex-shrink: 0` on that pane, it sized
itself to fit *every enabled column's* content — and its `flex-1` Gantt
sibling was the only side left to absorb the squeeze, down to nothing. Two
real fixes together: the pane always gets a real, capped pixel width now
(dragged or not, so Gantt space is structurally protected regardless of
column count), and `overflow-x` changed from `hidden` to `auto` so extra
columns scroll within the table pane instead of being silently clipped
with no way to reach them — matching Maro's own explicit fix request
verbatim ("the activity can be scrollable if there are excess columns").
Worth remembering: the first fix attempt was plausible-sounding but wrong
because it was reasoned from the *symptom* (chart squeezed) without yet
reading the actual layout code — the second, correct fix only came from
actually reading `Scheduling.tsx`'s own flex/overflow setup, not guessing
harder at the same symptom.

**A real crash, `variant.color.copy is not a function`, clicking a
material preset.** Root cause, confirmed by reading three.js's own
`Material.js` source directly, not assumed: `Material.prototype.copy()`
(called internally by `.clone()`) does `this.userData =
JSON.parse(JSON.stringify(source.userData))`. `Viewport3D.tsx` clones a
mesh's standard material whenever a texture override/preset first applies
to one specific element — and if that material's `userData` already held
a cached Gouraud/Hidden-Line render-mode variant (a real `THREE.Material`
instance, populated automatically the first time either mode is used),
the JSON round-trip silently turned it into a plain object that still
*looks* present but is missing its prototype methods. The exact same bug
class this app already caught once for `Object3D.clone()` (`sceneClone.ts`
's own header), just not this specific call site — fixed by explicitly
deleting the two cache keys off any cloned material
(`clearClonedRenderModeVariantCache`), so the variant getters correctly
detect "no cache yet" and rebuild a real one instead of trusting a
JSON-mangled copy.

**Material Presets couldn't store real textures at all.** The crash above
led straight into the actual blocker: saving a preset with a genuine 8K
texture failed with `total size of jsonb object elements exceeds the
maximum of 268435455 bytes` — Postgres's own hard 256MB-per-JSONB-element
ceiling, and the Base Color slot's base64 data alone was ~300MB. Presets
stored every texture slot as an inline base64 `data_uri` directly in a
JSONB `config` column — fine for small images, architecturally wrong for
real ones. Confirmed via direct query *before* touching anything that
three real presets already had genuine data saved this way (`conc` ~77MB
config, `concrete dirty` ~247MB, `Metal` ~128MB) — this had to be a data
migration, not just a schema change, or that real work gets silently
destroyed. Real fix: `MaterialPresetTexture`, one row per (preset, slot),
real files on local disk via the exact same `model3d_storage.py` helpers
`Model3DFile` already uses (reused directly, not reimplemented) — the
create/update API became multipart (mirrors `model3d_files.py`'s own
upload endpoint) with a `cleared_slots` field so renaming a preset with
several large textures doesn't require re-uploading any of them. The
migration itself decodes and extracts each existing preset's embedded
`data_uri` to a real file *before* dropping the `config` column, one
preset at a time (not the whole table in memory at once, given the
confirmed sizes) — verified directly afterward, not just assumed: all 9
extracted files exist on disk with byte-for-byte matching sizes against
their new DB rows, and all three original presets (`conc`/`concrete
dirty`/`Metal`) list correctly through the new service layer.

Also surfaced and fixed along the way: both `MaterialPresetPicker.tsx`'s
save-preset error handler and its own earlier sibling were silently
discarding the real error entirely (`catch { setError('Failed to save
preset') }`) — the exact same "was silently swallowed with nothing at
all" bug class this project has hit and fixed repeatedly this session
alone; without surfacing the real status/detail, the actual Postgres
ceiling above would never have been findable from the browser at all.

Backend: 11 new/rewritten material-preset tests (multipart upload/
download round-trip, `cleared_slots` clears without touching other slots,
an omitted slot stays untouched on update, delete cascades both DB rows
and disk files) — all pass, alongside the full existing suite. Frontend
`tsc --noEmit`/`vite build` clean throughout. Not yet re-tested live in
the browser for this specific round — worth checking: pivot-pick a point
on the actual model surface (not the gizmo) and confirm it lands correctly;
import two files with the same default name, give one a distinct name in
the dialog, and confirm Rigging can see both; toggle every Scheduling
column on and confirm the Gantt chart stays fully visible and the table
scrolls instead; re-save the "conc" preset with its original 8K texture
and confirm it now succeeds where it hard-failed before.

## 2026-07-13 — IFC Schedule Wizard: a first-draft schedule generated straight from a model

**What got built:** a wizard, launched from the 4D toolbar once an IFC
model is loaded, that scans a model's structural elements (columns, beams,
slabs, footings, foundation walls) and turns them into a real, editable,
resource-loaded schedule in one step — a WBS summary per storey, a work
activity per storey+category, FS sequencing within and between storeys,
crew resources with editable productivity rates, and every element already
linked to its activity (no separate manual linking step afterward).
Researched directly against a real file first (`2018_Hospital_Structural.ifc`)
rather than assumed from docs: Revit bakes real construction data straight
into each element's own `Name` attribute (`'W-Wide Flange:W21X50:...'`,
`'Floor:6" Concrete on 3" Metal Deck:...'`) — a cheap attribute read, not a
slow property-set walk, and `web-ifc` has no bulk per-element property API
at all to fall back on anyway. Confirmed with Maro up front: productivity
rates are **editable defaults**, not invented-silently and not
blank-by-default — the wizard proposes typical rates, reviewed/adjusted
before anything commits.

**No bulk-create existed anywhere in this app.** Every Activity/
ActivityRelationship/Resource/ResourceAssignment insert was one-row-at-a-
time, and both `create_activity` and `create_relationship` individually
trigger a full CPM recompute per call — a naive loop generating a few
hundred rows would've been both slow and structurally wrong (recomputing a
still-incomplete schedule hundreds of times over). New
`schedule_bulk_generate.py` persists a whole staged payload (temp
string-ids for cross-references, resolved to real client-generated UUIDs
as each row is built) in one transaction, with the CPM/hierarchy recompute
deferred to run exactly once at the very end — same "frontend computes the
domain math, backend just persists it" split Material Presets/Clash
Detective already established.

**Two real bugs, caught by the tests written for this, not guessed:**
1. A resourced activity's cost budget came back `0.00`. Cause:
   `compute_assignment_budget` prices a crew assignment off
   `activity.duration_days`, which only gets populated by the CPM pass —
   and the cost-sync loop was running *before* that pass, pricing
   everything off a still-null duration. Fix: moved cost-sync to run after
   the final hierarchy/CPM recompute, not before.
2. A deliberately-cyclic relationship payload correctly returned a 422,
   but the activities it should have rejected turned up persisted anyway.
   Cause: the cycle check (`would_create_cycle`) does its own DB query,
   which triggers SQLAlchemy's autoflush and pushes every earlier
   `db.add()` in the batch to the database — not committed, but no longer
   just sitting safely in memory either. An explicit `db.rollback()` on
   the exception path fixed the underlying leak but broke something
   subtler: this app's own test fixtures share *one* database session
   across a whole test (so `project`/`live_schedule_period` stay valid
   across multiple requests), and a rollback expires every ORM object in
   that shared session, not just the ones this request touched — a later
   fixture access in the same test then tried to silently refetch from the
   database outside of an async context and crashed. Real fix: validate
   *everything* (structure, temp-id references, and relationship cycles,
   the last via an in-memory graph check against relationships fetched
   once up front) **before a single `db.add()` happens**, so a rejected
   batch never touches the session at all — no autoflush, no rollback, no
   expired fixtures, and a cleaner story than "roll back cleanly" anyway
   ("never start" beats "start and undo").

**A dynamic-import convention nearly got broken.** `ifcModel.ts` (which
pulls in `web-ifc`, a large WASM-adjacent library) has always been kept
out of the main JS bundle by being dynamic-`import()`ed everywhere it's
used, never imported at the top of a file. The new
`ifcScheduleExtraction.ts` initially imported it statically for
convenience — `vite build` caught it immediately with a real warning
("dynamically imported ... but also statically imported ... will not move
module into another chunk"), and the main bundle nearly doubled in size
(6.87MB) as a result. Fixed by switching to a type-only import
(`import type`, erased at compile time) plus a dynamic `import('./ifcModel')`
inside the one async function that actually needs it — same idiom
`FourD.tsx`/`IfcDataPanel.tsx` already use. Worth remembering: `tsc
--noEmit` alone wouldn't have caught this at all (types were correct
either way) — only an actual production build surfaces bundle-splitting
regressions.

**Verified, not just written:** backend — 8 new tests plus the two fixes
above, full suite 647/647 passing (was 639 before this feature). Frontend
— `tsc --noEmit` and `vite build` both clean, and the bundle-splitting fix
confirmed by rebuilding and seeing `ifcModel.ts` back in its own separate
chunk. Extraction counts checked directly against the real reference file
via a raw STEP-format grep (not run in a browser, since none is available
here): 15 footings, 249 columns, 2011 beams, 612 slabs, 28 foundation
walls, 17 storeys — exactly matching what the wizard's own bulk per-type
queries would return. **Not yet tested live in an actual browser** — still
worth doing before relying on this: open the reference file, run the
wizard end to end, confirm the Rates & Crews step recomputes durations
live as a rate is edited, and confirm Generate produces a schedule in the
Scheduling module with correct WBS nesting and the new activities already
linked to their IFC elements with no extra manual step.
