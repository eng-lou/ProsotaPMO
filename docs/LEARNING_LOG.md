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

**New session: scoped, then built, the first slice of the Controls
Dashboard — the module the app's `/dashboard` route had been a placeholder
for since the very first version of `App.tsx`.** Started with the
prototype (`prosota-pmo_7.html`'s dashboard view: Overview / Baseline
Comparison / AI Suggestions tabs) and the product vision doc, and wrote
`CONTROLS_DASHBOARD_MODULE_PLAN.md` in the private docs repo comparing
what the prototype specified against what the app can actually support
today. The most useful finding wasn't about the Overview tab at all — it
was that the *Baseline Comparison* tab's Risk/Cost/ICD columns can't
really be built yet, because only Scheduling has a real "freeze a
snapshot, compare against it later" mechanism (`schedule_baseline.py`);
Risk and ICD have no baseline fields whatsoever, and Cost's only
baseline-shaped field (`rev_a_baseline`) is a single one-off reference
number, not a repeatable snapshot. Flagged that honestly as its own
future phase rather than quietly faking it, and Maro picked the sensible
split: build the Overview tab now (Phase 1a, real data, no AI), leave
Baseline Comparison for later once that snapshot gap is actually closed.

Two design questions came up while scoping Phase 1a, and both got
resolved by checking what the app already does rather than inventing
something new. First: how should "Schedule Performance" bucket activities
into On-Time/At-Risk/Delayed? Maro's answer added real scope beyond a
simple three-way split — he wanted the ability to toggle "critical path
only" and to scope the whole view down to one of the named sub-projects
the Sub-Project Float feature already supports. That turned out to fit
the existing data exactly: `is_critical`/`sub_is_critical` and
`total_float_hours`/`sub_total_float_hours` already exist side by side on
every `Activity` specifically for this master-vs-scoped-branch
distinction, and `activity.py`'s own `_subtree_ids` helper (already used
by the DCMA quality-check subproject scoping) does the branch-filtering —
no new backend concept needed, just wiring up what was already there.

Second, harder one: how should "Risk Overview" turn each risk's
probability/impact into a High/Medium/Low count? Asked the obvious
PMBOK-thirds question first, and Maro pushed back with a screenshot of
the Risk module's own "Criteria & Thresholds" screen — "we have this dont
we?" He was right to ask, though the real answer was more precise than
the screenshot: that screen holds the project-*editable* 5-level
probability/impact bands, but the actual banding already drawn on screen
for every individual risk lives in `HeatMatrix.tsx`'s own
`bandOf`/`cellColor` functions, which use a fixed even-fifths split (not
the editable criteria table) and colour a risk's position on a 5x5 grid
into a 5-tier palette. Mirrored that exact formula server-side
(`floor(value*5)` per axis, severity = the two bands added together,
collapsed from 5 colour tiers into 3 counts) so the new dashboard panel
can never silently disagree with what the Risk module already shows for
the same risk.

Built Phase 1a itself: a new read-only `GET /api/v1/dashboard/overview`
endpoint aggregating Activity/Risk/CostElement/IcdItem — no new database
tables at all, since every figure it needs already exists somewhere.
Schedule SPI reuses Cost Plan's own `rollup_evm_from_totals` (summing
PV/EV across schedule-linked cost elements) rather than a second,
independently-invented formula — same "leave it blank rather than show a
fake number" rule as everywhere else once no schedule-linked elements
exist yet. New `frontend/src/modules/dashboard/Dashboard.tsx` fills in
the `/dashboard` placeholder: KPI strip, Schedule Performance bars (with
the critical-only toggle and sub-project dropdown), Milestone Timeline,
Top 5 Risks (click-through to the Risk Register), Risk Overview, and a
Risk Exposure bar chart using `recharts` — a dependency that was already
installed but had never actually been used anywhere in the app until
now.

8 new backend tests (bucketing logic, the sub-project scoping switch, the
critical-only toggle, the risk-banding boundaries, KPI counts), full
suite 715/715 passing (previously 707) — every existing test still green,
nothing broken by the new code. Frontend `tsc --noEmit` clean. Not yet
tried in an actual browser (no browser available in this environment) —
that's the one thing still needed before this gets committed, per the
usual rule of not saving work until Maro's actually seen it work.

**Same session, continued: "carry on with next phases" — Phase 1b
(Baseline Comparison) built end to end, plus a "Generate ICD" feature
requested along the way, both landed after several real rounds of
feedback.** Phase 1b needed Risk/Cost/ICD to each gain a "freeze a
snapshot, compare later" capability the way Scheduling already has via
`ScheduleBaseline`. Talked the actual design through with Maro rather
than picking one myself: each module keeps its own independent baseline
(new `RiskBaseline`/`CostBaseline`/`IcdBaseline` tables, each mirroring
`ScheduleBaseline`'s own shape exactly — this app has never used a
generic JSON-blob snapshot anywhere, and these don't start that), *plus*
a new `BaselineSet` that ties one of each together under a shared name
("Contract Baseline") so the Dashboard can compare "everything as it
stood at X" in one pick — supporting both a one-click "capture all four
now" action and manually linking an already-existing standalone baseline
into a set afterward, per Maro's own two real workflows. New
`GET /api/v1/dashboard/baseline-comparison` computes real deltas across
all four modules — Cost's BAC/CPI/EAC recomputed at both the snapshot's
own resolved bac/ac/pct_complete and today's, through the exact same
`rollup_evm_from_totals` formula every other EVM figure in this app
already goes through, never a second one.

Maro asked for "generate icd in that module as well," extending the same
schedule -> resources -> cost -> risk pipeline `riskGeneration.ts` already
established. Real domain question worth getting right rather than
copy-pasting the risk generator: an Issue is a problem that's already
happened, a Change is a modification actually requested — there's nothing
legitimate to pre-populate for either, unlike a Risk (uncertain future
event) or a Decision (something you can genuinely see coming — "confirm
the facade system" tied to a long-lead package). Shipped Decisions-only
first; Maro then explicitly asked for Issue/Change placeholders too, and
a second short discussion landed on the right shape for those — a
discipline-level "watch-flag" with no real trigger date (unlike a
Decision's real `required_by`), clearly labelled as a generated
placeholder to review or dismiss, never presented as something that
actually happened. Also built this as a genuine *rescan*, not
`risk_bulk_generate.py`'s one-shot dedupe-and-freeze: re-running it after
the schedule moves only refreshes the items whose own discipline actually
shifted (per Maro: "it doesn't have to change all items just onces
impacted"), and every generated item gets real `record_links` edges to
the activities it gates — laying real groundwork for the cross-module
causal tracing in the Baseline Analysis prototype (an Issue driving a
Risk, driving schedule slip, driving a Change, pending a Decision)
without building the AI narrative itself, which stays a deliberately
deferred later phase.

Four rounds of real, specific feedback after the first working version,
each one a genuine fix rather than a matter of taste:
1. **Milestone Timeline "single line is stupid."** With only two
   milestones, a track that only spans between the milestones themselves
   reduces to a bare line. Fixed by adding real evenly-spaced calendar
   tick marks (a genuine time scale) below the axis, independent of how
   many milestones exist, with milestones themselves above it.
2. **Delta colours were backwards for cost and risk.** A literal
   "positive is green" rule is wrong wherever growth is bad news — a
   growing budget or a worsening risk rating are never good, even though
   a rising SPI/CPI is. Added a `higherIsBetter` flag per metric instead
   of one universal rule, and fixed the call sites that had it backwards
   (BAC, EAC, risk rating).
3. **Schedule SPI, added to the Baseline Comparison's Schedule tab.**
   Genuinely harder than it sounds: SPI is a cost-side figure (PV/EV), not
   a pure schedule one, so computing it "at baseline time" needed
   cross-referencing the *sibling* `CostBaseline`'s own snapshot bac/pct_
   complete against the *sibling* `ScheduleBaseline`'s own snapshot
   start/finish — two different modules' baselines, matched by
   `linked_activity_id`, run through the exact same `_schedule_evm`
   formula Cost Plan's live SPI already uses. None on either side when the
   underlying schedule-linked cost data isn't there, never a guessed
   number.
4. **"I don't need to see 0 variances" — then "but an added/removed item
   should still show."** First pass filtered every comparison table down
   to only rows that actually moved, which accidentally hid *added* items
   too (a null baseline reads as "no delta" if you're not careful). Real
   second bug hiding underneath: the Cost/ICD summary *totals* themselves
   had been quietly under-counting all along, only ever summing items
   that existed at baseline time — an added cost element's BAC or an added
   issue's open status never rolled into "current" at all. Fixed both:
   every comparison function now also surfaces live records with no
   baseline snapshot (shown as "(new) £20,000" rather than a blank), and
   the aggregate totals sum over every live record, not just previously-
   snapshotted ones.

742 backend tests passing throughout (up from 715), full suite re-run
clean after every round, `tsc --noEmit` clean throughout. Committed this
time — Maro tried it in the browser across several rounds and said "good
enough, carry on" each time, satisfying the usual don't-commit-until-
verified rule. The commit also swept in a batch of older, already-
finished-but-uncommitted work from earlier in the session (the 4D Measure
tool, BOQ delete-all/print, Risk/Cost bulk generation, section box
rotation) — asked Maro explicitly whether to keep that separate or bundle
it in, since none of it had been touched or re-verified in this
continuation; he chose one combined commit.

---

## 2026-07-20 — Controls Dashboard becomes a real widget library; Camera Views learn to remember more than the camera

**Part 1: from six fixed panels to a PowerBI-style canvas.** The Controls
Dashboard's Overview tab used to be six hard-coded panels in a fixed
layout. Maro wanted it to become a free canvas instead — add, remove,
resize, and drag widgets anywhere, save named layouts, like PowerBI. The
backend reused the exact "named saved layout, one active per project"
pattern the 4D module's own dock layout already had (`DashboardLayout`
mirrors `DockLayout`). The frontend grid went through three real
iterations before landing: first the `react-grid-layout` npm package, then
a patched version of it, both of which turned out to have a width-tracking
bug that never resolved to a real number — rather than keep chasing an
opaque bug in a brand-new major version of someone else's library with no
way to watch it run live, the library was dropped entirely in favour of a
small, fully self-written grid (own pixel math, own drag/resize via
mousedown/mousemove/mouseup, same pattern the 4D module's own split-pane
resizing already used). Confirmed working in the browser before anything
else got built on top of it.

**Part 2: a reference-driven gap analysis, then ~45 new widgets in a day.**
Once the canvas itself was solid, the question became "what widgets should
actually live in it?" Maro shared screenshots of two real commercial
tools — a Primavera-style EVM/resourcing dashboard and a BEXEL Manager 5D
BIM report suite — and the ask was to cross-check everything in them
against what Prosota could already do. That produced a genuinely useful
split: some things were **quick wins** (a DCMA 14-point quality score and a
Clash Detective summary were both real, fully-built, fully-tested backend
modules that had simply never been surfaced on a dashboard before — pure
reuse, zero new logic), some were **real but bounded gaps** (a resource's
true "actual" cost needs a new join; a Camera View gallery needed a
thumbnail feature that didn't exist yet), and some were **genuinely
blocked** (a live, PowerBI-style resource-histogram-by-week needs
real values captured repeatedly over time, which is a "needs real usage,"
not a "write more code," problem — same root issue as the S-curve gap from
the baseline-comparison work). Sorting the reference material into "just
reuse this," "build this, it's bounded," and "this needs a decision or
more historical data first" turned an overwhelming wishlist into eight
concrete, shippable batches — Schedule, Risk, Cost, Resources,
Issues/Changes/Decisions, then a "quick wins" batch, then Camera
Views/4D Video, then a final round of Look-Ahead Planner/Mitigation
Actions/Risk Ageing/a templated "AI narrative." Every batch followed the
same shape: one shared backend fetch per module (schedule_activities,
risks, cost_elements, ...) that many small frontend widgets all read from
client-side, rather than one bespoke query per widget — and every batch
got the same verification pass (new backend tests, full suite, `tsc`,
build) before moving to the next.

One nice discovery along the way: an "AI Narrative" widget in the
reference material — sentences like "Mechanical: 2% complete, behind plan"
— turned out to just be templated string formatting over numbers already
being computed anyway, not a real model call at all. That's a genuinely
different, much cheaper thing than the real "AI Insight Generator" already
planned for later (which does need a real LLM), and it shipped the same
day as one of the cheap quick wins.

**Part 3: Camera Views learn to remember the whole scene, not just the
angle.** The existing Camera View feature (save an orbit angle, click to
jump back) only ever stored position/target. Maro's ask: isolate just the
columns, click a clash result (which already selects and red-tints the
pair), add an annotation, save the view — then after resetting everything
to "show all," clicking that saved view should bring back the isolation
exactly, not just the camera angle. Investigation showed the isolation/
hidden-element machinery, the clash-selection behaviour, and a snapshot
mechanism (the existing "Capture" button) already existed — this was
"capture and restore more of what's already there," not inventing a new
interaction. A saved view now also stores which elements were isolated,
which IFC model that isolation belonged to, whether clash colouring was
on, and a PNG thumbnail. The thumbnail turned into its own small lesson:
the plan started out mirroring `Model3DFile`'s disk-storage pattern (built
for multi-hundred-MB IFC files), but a closer look at the existing
codebase found `ProjectLetterhead.logo_data_url` — a small image already
stored as a base64 string directly in a database column, because a logo
(like a thumbnail) is nowhere near IFC-file scale. Following that existing
precedent instead cut out an entire storage subsystem and two new API
endpoints that would have been unnecessary complexity.

The same reasoning extended to 4D video: Export Video already recorded a
timeline animation to a downloadable `.webm`, but never stored it
anywhere — so "pick one of the videos we've captured" needed a small new
`FourDVideo` table (this time genuinely disk-stored, since a video really
is large enough to justify it) alongside the existing local download,
which was left completely unchanged.

One real, subtle bug surfaced by Maro along the way, unrelated to any of
the above: after a while, the 4D module would show four copies of the same
single IFC file. A direct database check ruled out duplicate rows in one
query — only one row existed. So the duplication was happening entirely in
memory, on the frontend. The actual cause: React's Strict Mode
(deliberately enabled in this app specifically to catch bugs like this
one) runs every effect twice in development to catch missing cleanup, and
the effect that restores saved IFC files on page load only set a
`cancelled` flag in its cleanup — checked *between* files in its loop, not
*during* one file's own slow parse. A file already mid-load when Strict
Mode's synthetic cleanup fired finished anyway, and the second (real)
invocation restored everything again from scratch, doubling it up. Fixed
with the standard pattern for exactly this situation: a ref (not state)
set synchronously before the very first `await`, so any further
invocation for the same project becomes a guaranteed no-op no matter how
many times React happens to fire the effect — while still correctly
re-running if the user genuinely switches to a different project and back.

Two smaller test-authoring lessons repeated themselves this session,
worth remembering: (1) a computed field manually set via a test helper
must actually be the right *type* (`Decimal`, not a string that merely
looks like one) — a string slipped through silently until a genuinely new
code path (the DCMA quality check) tried to do real arithmetic on it; (2)
manually setting a schedule-computed field (like `start`) has to happen
*after* any API call that triggers a real CPM recompute (like creating a
relationship), never before — otherwise the recompute silently overwrites
the very value the test just set.

By the end of the day: roughly 45 new dashboard widgets across every
module, a fully rewritten Camera View feature that captures real scene
context instead of just a camera angle, a new video-persistence feature,
and two real bugs (one pre-existing, one from earlier in the same
session) fixed along the way. Full backend suite green throughout, `tsc`
and the production build clean after every batch, and every 4D-touching
change confirmed by Maro directly in the browser before moving on.

---

## 2026-07-20 (continued) — Prosota reaches v1; a full optimization pass

With the Controls Dashboard and Camera Views/4D Video work done, Maro
called this v1 and asked for a proper speed-and-scale pass: review the
code, find the waste, make it built to scale. Rather than guess at what
"probably needs optimizing," this ran as a real audit first — two
background research passes (one over backend query patterns, one over
frontend bundle size and runtime behaviour) plus a first-hand look at the
dashboard code from earlier in the session — and only started changing
anything once there was a concrete, evidence-backed list to work from.
That list turned into a plan, reviewed and approved before any of it was
touched, then executed in priority order.

**The single biggest, safest finding: this database had no indexes at
all.** Not "some missing" — a search for every column marked as
indexed across every table came back with zero results, out of 103
foreign-key columns. Postgres never indexes a foreign key automatically
(unlike some databases), so every single query filtering by "which
project" or "which period" — which is nearly every query this app ever
runs — was scanning the whole table. Adding an index doesn't change what
a query returns, only how fast it runs, which made this the rare kind of
fix that's both the highest-impact and the lowest-risk available: a
small script added the missing column everywhere it was needed (skipping
columns that already had a unique constraint, which already implies an
index), one migration, one clean run of the full test suite.

**A confirmed regression, not a new suggestion.** The 4D viewport had a
real, deliberate performance fix built earlier in the project's life: a
check that skips an expensive per-mesh pass (texture, shading, colour)
unless the actual 3D scene really changed, built specifically because a
model with over 5,000 elements was struggling. That check works by
comparing object references — "is this literally the same object as last
time, or a new one?" — and the object it was checking had quietly started
being rebuilt from scratch on every single render of the page, for
reasons completely unrelated to the 3D scene itself (typing in a field,
opening a side panel). The check always saw "a new object," always
assumed something real had changed, and the expensive pass ran constantly
without anyone asking it to. The fix was one line — wrapping that object
in React's `useMemo`, which only rebuilds it when its real inputs
change — but finding it required actually reading what the earlier fix's
own comments said it depended on, not just profiling for something slow.

**The 4D module was loading for everyone, whether they used it or not.**
The 4D viewer — a genuinely heavy piece of software (a full 3D engine plus
IFC file parsing) — was built into the very first thing every user's
browser downloaded, and it started fetching its own data (saved camera
views, clash tests, measurements, and about twenty other things) the
moment a project was selected, regardless of whether that user ever
opened the 4D tab at all. Fixed in two parts: the whole module now only
loads its code the first time someone actually navigates to it (a
one-line change using a standard React technique, `lazy` loading), and
its own data only starts fetching from that same first visit onward too.
Confirmed with a real production build: the main bundle almost everyone
downloads dropped by about 200KB (compressed), and the 4D module's own
~700KB became something only paid for by people who actually use it.

**A dashboard dragging a widget around was recalculating every other
widget's numbers, dozens of times a second.** Moving or resizing one
widget on the Controls Dashboard was updating on every single pixel of
mouse movement with no throttling, and every other widget on the board
was recalculating its own data (sorting lists, filtering tables) on every
one of those updates, even though nothing about their own data had
changed. Fixed with two standard, well-known techniques: capping the
update to once per screen refresh (a browser API called
`requestAnimationFrame`, already used elsewhere for smooth animation) and
wrapping the widgets in React's `memo`, which skips re-running a
component's own work when nothing it actually depends on has changed.

**A handful of real "doing the same thing over and over when once would
do" bugs**, the kind that are invisible with a handful of test rows but
add up fast at real scale: generating a schedule from an IFC file, a
batch of cost/risk/issue items, or importing a P6 file was numbering each
new item one at a time — a database round-trip *per item* just to work
out its reference number — instead of working out the whole batch's
numbers in one go and then just counting up locally. Deleting a whole
branch of a schedule was cleaning up its linked costs one activity at a
time instead of once for the whole branch. And a dashboard widget
computing schedule quality (DCMA's 14-point check) was independently
re-fetching the entire schedule from the database, even though the
dashboard had already fetched that exact same data moments earlier for
its own use — now it reuses what's already there.

Every one of these changes was checked against the existing test suite
(769 backend tests, unchanged pass count throughout — these were all
"do the same thing, just not wastefully" changes, not new behaviour) plus
`tsc` and a real production build after each stage. The frontend changes
still need Maro's own hands-on check in the browser — dragging a
dashboard widget, opening the 4D module for the first time in a session —
since none of this can be seen from the code alone.

## 2026-07-21 — Chasing "still slow" on the 4D timeline to its real cause, then a Baseline Manager for the rest of the app

Picked back up on the 4D performance work from the previous session's
optimization pass. The batching fix that had just landed (every element's
geometry consolidated into one shared draw-call-efficient object, not
just repeated shapes) was the right fix for *orbiting/viewing* a big
model — but Maro reported "still slow" on the animation timeline itself,
and, fairly, pushed back: how do we actually know the fix is even running
against the model being tested, rather than some stale build or cached
state? That was a good question to take seriously rather than wave away.
The answer turned out to be provable, not just arguable — a one-line
diagnostic added to the model loader that prints, per file, exactly how
many placements ended up batched vs not. Tested against the real 6-file
combined-discipline reference set, it confirmed 100% batching, zero stale
anything — real, hard evidence instead of reassurance.

**Which meant the remaining slowness had to be something else entirely,
and it was two somethings, both real.** First, the code that figures out
"which scheduled activity is currently controlling this element's
animation" was re-parsing the same date strings and re-sorting a small
array from scratch for every single linked element, every single frame
the clock moved — which, during actual playback, is every frame. At real
schedule scale (tens of thousands of linked elements) that's a genuinely
large amount of repeated, unnecessary work landing 60 times a second.
Fixed by parsing each date once, when the link is first set up, instead
of over and over during playback.

**The second one was the real story, though, and it was never in the 3D
code at all.** The "Animation Timeline" panel's own actor list — the
scrollable list of every animated object with its own sub-track, sitting
right underneath the 3D viewport — was rebuilding itself from scratch,
checking every element against every scheduled link one at a time,
*every single animation frame*, because nothing was stopping it from
re-rendering just because the clock ticked. That's a browser-choking
amount of repeated work happening on the exact same single thread that
also has to run the 3D engine — which is exactly why the symptom looked
like "the 3D view freezes on an empty scene, jumps to a fully-built one,
then jumps back to empty, with no motion in between": the browser wasn't
failing to animate, it was mostly frozen doing that list's own unrelated
math, only occasionally free to actually paint a frame. Once that list
was taught to only rebuild when its underlying data actually changes
(not every clock tick), and to do that rebuild efficiently instead of
checking every element against every link one at a time, playback went
from broken to smooth. Confirmed by Maro directly in the browser against
the real reference model — first genuinely "seamless" report of this
session's whole performance thread.

Also trimmed that same actor list down per Maro's own observation: it was
showing one row per individual schedule-linked model element — thousands
of them on a real project — even though those rows can never actually be
edited from there (that kind of link is deliberately read-only in this
view; editing it lives elsewhere) and the same information is already
available from the Activities/Gantt view. Removing that whole category of
row both matched how Maro actually wants to work and further shrank the
list's own cost, since it had been the overwhelming majority of what was
in it.

**Two more real, separate optimizations followed the same evidence-first
pattern.** A small piece of the actor list (the coloured bar showing a
linked Activity's own dates) was rebuilding its own lookup tables from
the *entire* project's activities and animation profiles every time any
single row of the list rendered — moved to build those lookups once for
the whole list instead. And a much bigger, unrelated finding: only the 4D
module had ever been set up to load its own code on-demand (from an
earlier session) — Scheduling, the Dashboard, Risk Register, Cost Plan,
and the ICD Tracker were all still being downloaded together, upfront, by
every single user on their very first visit, regardless of which one (if
any) they actually opened. Extending that same on-demand-loading pattern
to all five cut the very first, unavoidable download from about 3.1MB
down to about 460KB — before anyone's even chosen which part of the app
they want to work in.

**Then a smaller, product-shaped piece of work: Risk, Cost, and ICD each
got their own Baseline Manager**, the same "capture a named, dated
snapshot, see the history, delete an old one" tool Scheduling already
had. The backend side of this had actually already been built months
earlier, as part of the Controls Dashboard's own baseline-comparison
feature — Risk, Cost, and ICD baselines could already be captured and
compared, just only in bulk from the Dashboard, with no way to manage
them from inside their own modules. One new, shared component (rather
than three separate near-identical copies, since the three modules'
underlying data shapes turned out to be genuinely identical) closed that
gap simply, reusing real backend work that had been sitting unused.

**Finally, a real question about the actual authoring workflow: does this
app need Revit files directly, or does it need IFC?** It needs IFC —
there's no reader for Revit's own native file format here, nor a
realistic open one anywhere. The useful part of the answer was pinning
down the *right* export settings from Revit, checked directly against
what this app's own code actually reads rather than generic advice: plain
IFC (not the XML or zipped variants, which the parser used here can't
open at all), Revit's "Export base quantities" turned on (without it, the
app can only guess an element's area from its rough bounding box instead
of reading Revit's own real figures — confirmed as a real, present gap by
checking the actual reference files in this project, none of which had
it enabled), and "Keep Tessellated Geometry as Triangulation" turned on
(this one explains a whole category of red console warnings seen
throughout this session's own real-file testing — without it, the app has
to do its own triangle-conversion work on raw exported solid geometry,
and errors on some of it; Revit doing that conversion itself at export
time sidesteps the whole problem). Written directly into the code next to
the exact logic each setting affects, and into the Import button's own
on-hover help, so this doesn't stay something only remembered from a
chat.

## 2026-07-22 — A real Hotel model, a real cycle, and a real animation regression (with one real mistake along the way)

Picked back up 4D testing against a genuinely large real file this time
(Snowdon Towers Sample Structural.ifc, and separately a 159MB real Hotel
export) instead of small test models, which surfaced several real bugs
too rare to hit on anything smaller.

**Shadow/AO polish first.** A hard diagonal band across a flat wall face
("shouldn't be there at all," per Maro) turned out to be shadow acne — the
directional light's fixed `shadow-bias` had been tuned against a much
larger real building, so on a smaller model the same bias became too
small a fraction of the shadow camera's own depth precision. Switched to
`shadow-normalBias`, scaled to `modelRadius` the same way the frustum
already is, so it stays correct regardless of model scale. Separately,
N8AO's ambient-occlusion contact ring around close-set objects read as an
unrealistic hard halo at its old intensity (2) — dropped to 0.8, confirmed
live it now reads as a soft, physically-plausible occlusion instead.

**A real circular-dependency rejection on Generate Schedule**, the fourth
distinct shape this exact bug has taken (three earlier ones already
patched individually, per this file's own July 17 entries) — this time
from a storey with no structural category at all, whose handoff-chain
fallback anchor landed on an activity downstream of the same storey's own
facade activity, closing a loop back through the global "Structure
Complete" gate. Rather than patch a fifth shape, `scheduleGeneration.ts`
now guarantees the generator's *output* can never cycle at all: every
activity gets ranked by a real topological sort, ties (and any actual
cycle) broken by the generator's own deterministic default order, and only
edges consistent with that final ranking survive. A structural guarantee,
not another special case — confirmed against the real 159MB Hotel file,
which now generates successfully every time.

**A 1,570-day activity duration**, also on that real Hotel file, chased
through two wrong turns before the real answer: first assumed a missing
unit conversion on the real Qto data and "fixed" it by applying
`toMetres²` — which was backwards, and confirmed live to shrink a real
~95m² footing down to 0.0000955 m². Reverted, then found the actual cause
with a live diagnostic against the real file: elements literally named
"Floor:000-ASPHALT ROAD" and "Floor:000-GREEN AREA" — site/landscape work
modeled with Revit's Floor tool — export as plain IfcSlab, the same type a
real building floor slab uses, and were getting swept into "Slabs"
alongside genuine footings. Fixed at the actual source (a name-keyword
re-bucket into Site & Landscaping, same pattern already used for curtain
walls), plus a permanent outlier-quantity clamp as backstop so no future
export's naming quirk can produce another absurd duration, per Maro's own
explicit ask.

**The model silently failing to auto-restore on reload** — a real
StrictMode regression: a ref-guard added the day before (to stop React 18
dev-mode's double-invoke from restoring the same file twice) meant the
*surviving* invocation of the restore effect could never start at all,
since the ref was already claimed by the one StrictMode was about to
cancel. Every restore's real work belonged to the invocation that got
thrown away. Fixed by checking the ref's own live value at each step
instead of a plain per-invocation cancelled flag — survives the
StrictMode remount transparently, still correctly abandons stale work on
a real project switch.

**The most involved fix: clicking a schedule-linked element while
animated permanently stopped it following the schedule**, "even though i
click away," per Maro's own real repro. Root cause, confirmed via live
diagnostics rather than assumed: a click materializes that one element out
of the shared batched mesh into its own individual mesh, but the only
thing that ever decides what drives an element's schedule-based
visibility — a `resolve()` effect in TimelinePlayback — has no dependency
that fires on a mid-session materialization, so the newly-individual mesh
never gets an entry anywhere and nothing touches it again. **First fix
attempt was wrong and shipped anyway**: re-running that whole resolve()
effect on every click technically closed the gap but caused a real
regression Maro caught immediately — every click started hiding the rest
of the model, reading as an accidental Isolate. Reverted outright rather
than chase why. The real fix is surgical instead: a small, separate effect
that migrates *only* the one clicked element from the batch's
already-resolved animation data into its own proper individual entry — an
O(1) lookup, not a model-wide re-index — leaving the expensive full
resolve untouched. Verified correctly this time with real instrumentation
(not just code reading) against the actual failure case before shipping:
confirmed the fix work genuinely, then found the "still looks broken"
follow-up screenshots were themselves stale HMR state from a very long
single dev session, not a flaw in the fix — confirmed clean on a real hard
reload.

**Also shipped**: a "3D Elements" count + "Browse Elements" dropdown
column pair in Scheduling (per Maro's own ask), which surfaced a real,
separate bug on the way — `ModelElementLink.element_label` for
schedule-generated links had always stored the *activity's* name on every
linked element instead of the element's own name, contradicting that
field's own documented contract. Threaded a real per-element label
through the generation pipeline so the new Browse column actually shows
distinct, useful names. And a real 404 spam on every transform edit
(dragging/rotating an object), caused by a `model3d_file_id` whose row had
silently never made it to the database (a large upload abandoned by a
reload mid-transfer) — self-heals the same way an earlier Section Box fix
already proved out, and now surfaces a real, visible error instead of
silently losing the edit with nothing but a console log nobody would ever
see.

**The honest lesson of the night**: the animation-materialize regression
happened because a plausible-sounding fix went out without checking it
against a real animated model first, breaking the same discipline that
caught every one of the *other* bugs above (Snowdon/Hotel real-file
testing, live diagnostics before believing a hypothesis). Caught it fast
because Maro was testing live and said so immediately — but the fix
process that actually worked, every single time tonight, was: reproduce
for real, instrument for real, read the real evidence, *then* fix.

## 2026-07-22 (continued) — Two "still broken" reports that turned out to
be the dev server, not the code

Maro came back after the commit above with two fresh reports against the
same shipped fix: the click-detaches-from-animation bug "still" happening
("we never had this problem before"), and a separate one — Deselect All
leaving the blue selection tint stuck on elements. Both looked real on
first look: a screenshot of the detach bug, and a live repro (select an
element, nudge the timeline's date, Deselect All, tint still there).

Neither survived a genuinely clean test. The tell was in the browser
console: `[MIGRATE DIAG]`/`[FRAME DIAG]`/`[VIS DIAG]` log lines were still
firing — the exact diagnostic instrumentation confirmed removed from disk
before the last commit (`grep -n DIAG` on the real file: no matches). The
running Vite dev server had been up the entire session and was still
serving an old in-memory build from *before* that removal — a hard browser
reload doesn't help here, since Vite's own dev-server process, not just
the browser, was the thing holding stale state. Killed and restarted the
Vite process itself, hard-reloaded the tab, and confirmed via fresh
console output that the served code now matched disk exactly (no DIAG
lines, clean load).

Against that genuinely clean server, neither bug reproduced — not once,
across every shape tried: select-and-scrub-back while still selected,
select-then-Deselect-All-then-scrub, select-then-replace-selection,
select-all/deselect-all with a date change in between, and a full Play
run through several schedule transitions before jumping back. Used
Generate Schedule's "Scan Model" option against the Snowdon file to get a
real 1,370-element linked schedule for this, since the project had no
animated actors at all going in.

**The actual lesson, sharpened rather than new**: this session already
had one "stale HMR state looked like a bug" moment (the entry above) and
still got fooled by the same failure mode from one layer further down —
a long-lived dev *server* process, not just a long-lived browser tab, can
serve code that no longer matches disk. `grep`-ing the real file for the
suspect instrumentation, and seeing it still firing in the console, is
what actually exposed it — not the screenshot, not the repro that
"worked" once. Restarting the dev server (not just reloading the page)
needs to be step one whenever a fix that was shipped and verified earlier
in a long session starts "still" failing later in that same session.

**Correction, later the same day**: the entry above was wrong to close the
book on this as "neither bug reproduced." Maro came back with a much
sharper, angrier repro against the real "2018_Hospital_Structural.ifc"
project (not the Snowdon test file): select any schedule-linked element,
deselect it, scrub the timeline back to before its activity starts — it
stays fully visible forever. Live testing (after also fixing an
unrelated self-inflicted bug: temporary diagnostic code that shadowed the
global `window` inside Mode A's per-link loop, which has its own local
`const window = ...`, throwing `ReferenceError` on every call and
silently aborting `resolve()` — renamed to `globalThis` in the
instrumentation, not the app code) isolated the real, still-live root
cause: `ensureMaterialized`/`materializeAll` (`elementBatching.ts`) pull an
element out of the shared `THREE.BatchedMesh` into a plain
`THREE.Mesh`, which defaults to `.visible = true` — nothing about that
call path ever applies the element's actual schedule state. A single
click was already covered by an earlier fix (`selectedExpressId`'s own
surgical migration effect in `TimelinePlayback`), but **Select All**
(`handleSelectAllClick`'s own `materializeAll()` call, Viewport3D.tsx) had
no equivalent: it doesn't change any of `resolve()`'s own dependencies, so
none of the freshly-materialized meshes ever got a `ResolvedTimelineTarget`
at all, individually or in bulk — they simply stayed stuck at
`visible = true` for the rest of the session, immune to further date
scrubs. Confirmed via a clean fresh-load A/B test (empty, correct, before
Select All; the entire building fully visible, wrong, immediately after)
on the real Hospital file.

**The fix**: a new `materializeVersion` counter, bumped by
`handleSelectAllClick` after its `materializeAll()` call and added to
`resolve()`'s own dependency array — deliberately *not* the same shape as
the earlier `selectedExpressId` fix (that one was rejected as a `resolve()`
dependency because it fired, and re-derived the *entire* model, on every
single click). Select All is already a deliberate, expensive, occasional
bulk action, so triggering one full re-derive in response to it is
proportionate rather than a hot-path regression. Verified live, twice, on
the real Hospital project: Select-All-then-deselect-then-scrub-to-day-one
and single-click-then-deselect-then-scrub-to-day-one both now correctly
hide everything, and scrubbing forward again still correctly rebuilds.

**The actual lesson**: a live, angry, specific repro against real data
outranks an earlier "couldn't reproduce it" — the dev-server staleness
above was real and worth fixing, but it wasn't the *only* thing wrong, and
declaring the investigation closed after fixing just that one layer left
the real bug live for the rest of the day. Also: don't let temporary
debug instrumentation use bare `window` inside code that might have its
own local `const window` a few lines later in the same block scope — it
silently shadows and throws on every call, which can itself look
exactly like "the feature is completely broken" and burn significant time
chasing a phantom.

**Second correction, same day**: the `materializeVersion` fix above was
*also* incomplete — Maro came straight back with a screenshot proving it:
select an element, don't deselect, scrub back before its activity starts —
still stuck fully visible. The distinguishing detail this time was
"still selected," not "already deselected" (every earlier verification
pass, mine included, had deselected before scrubbing back, which happened
to dodge the actual bug). Root cause, finally confirmed live: while
anything stays selected, `TimelinePlayback`'s own `onTick` fires every
single animation frame (`if (activeObjectId) onTick()`), which calls
`FourD.tsx`'s `handleTransformChange` → `setTransformTick`, which gives
`ModelObjects` a fresh `objects` array reference on every frame too. That
makes its `heavyChanged` check true every frame, so its "full pass" — which
unconditionally writes `child.visible = baseVisible` (a schedule-blind
showFaces/isolate/hidden computation) — reruns every frame as well,
racing against `TimelinePlayback`'s own correct per-frame write
(`mesh.visible = baseVisible && opacity > epsilon`) a few hundred lines
below. Whichever one commits last before the browser paints wins, and in
practice `ModelObjects`' write consistently won for as long as the element
stayed selected — not a flicker, a persistently wrong static frame, which
is exactly what both screenshots showed.

This was the exact "competing writer" theory floated *very* early in this
whole investigation (before the dev-server detour, before the diagnostic-
`window`-shadowing detour, before the `materializeVersion` fix) and never
actually acted on — worth remembering next time a strong lead gets
shelved mid-session for a more immediately reproducible symptom: it can
still be the real answer once the decoy is cleared away.

**The fix**: `ModelObjects` now only owns the direct `.visible` write for
a mesh nothing else controls. `TimelinePlayback` marks
`object.userData.timelineControlled = true` on every mesh it wires into a
`ResolvedTimelineTarget` with a real Mode A link — both in `resolve()`'s
own per-link loop and in the click-triggered migration effect — and
`ModelObjects`' per-mesh pass now does
`if (!child.userData.timelineControlled) child.visible = baseVisible`
instead of writing it unconditionally. `child.userData.baseVisible` is
still written every time regardless (that's the exact signal
`TimelinePlayback` already reads and combines with the animation state),
so Isolate/Hide/showFaces still correctly affect a schedule-linked element
— just via the one writer that's supposed to own `.visible` for it, not a
second one racing it every frame. Verified live on the real Hospital
project against the *exact* repro from the screenshots: select a footing,
leave it selected, scrub back before its 28 Jul 2026 start — now correctly
disappears while still selected, and scrubbing forward again correctly
brings it back, still selected throughout.

**Third correction, same day**: reported "still bugged" a third time —
Maro's own suspicion ("maybe it's because you're clicking from the
viewport, I'm clicking the IFC panel") was exactly right, and pointed at
a *second, independent* instance of the identical race, in code the
second-correction fix never touched. IfcDataPanel.tsx's own storey/type
selection (`handleSelectExpressIds`, the plural bulk sibling of
`handleSelectExpressId`) never materializes anything — by design, per its
own header — so it never reaches the individual-mesh path the previous fix
covers. It hits `ModelObjects`' *batch* heavy-pass instead, which had the
exact same unconditional-write bug: `batch.mesh.setVisibleAt(instanceId,
visible)` (schedule-blind, same `showFaces && !isolatedOut && !isChildHidden`
shape as the individual-mesh `baseVisible`), reran every frame for the same
onTick/transformTick reason, and won the same race against
`TimelinePlayback`'s own batch fast path — which a comment already sitting
in that exact code block had *predicted was impossible* ("TimelinePlayback's
runs unconditionally every single animation frame... always wins moments
later"), the same wrong assumption that made the individual-mesh version
of this bug ship in the first place. Fixed the same way:
`getBatchedInstanceInfo`'s own instances get marked into a
`timelineControlledInstanceIds` Set on the shared BatchedMesh's userData
when Mode A resolves a link for them, and `ModelObjects`' batch pass skips
the direct `setVisibleAt` for any instance in that set (still updates
`batchBaseVisibleByInstanceId`, the composable signal
`TimelinePlayback`'s own batch loop already reads). Verified live via all
three known selection entry points on the real Hospital project — direct
viewport click, spatial-tree "Select All on This Storey", and Class > Type
> Occurrence row — scrubbing back to day one while still selected now
correctly hides everything through every one of them, not just the one
that happened to get tested first.

**The lesson, a third time**: when a user says "you're not seeing what
I'm seeing," take the specific mechanism they propose seriously and test
*that exact path*, not just "the bug" in the abstract — two fixes in a row
looked complete because verification kept reusing the same one entry
point (a direct viewport click) instead of covering every UI surface that
can trigger the same underlying state change. A race condition between two
unconditional writers doesn't necessarily live in one place — if the
pattern exists once from a design assumption ("the other write always
happens after mine"), grep for the same assumption elsewhere before
declaring the bug class closed.

**Fourth correction, same day — the real one**: Maro pushed back hard on
the third fix's own explanation ("then why is it still unfixed") with a
fresh screenshot of the *exact same* metal-deck slab still showing at day
one, still selected. This one didn't fit either of the first two race
theories — the element had been genuinely clicked (not panel-selected),
and deselecting was never the difference (confirmed: the "stays selected"
race was already fixed). Live instrumentation (`useFrame`'s own `state`
param exposed to `globalThis` for one-off scene inspection, since nothing
else in this codebase already exposes the live THREE.js scene to the
console) proved, conclusively, that both the schedule math *and* every
writer fixed so far were correct: the one individually-materialized mesh
for this element read `visible: false` the whole time, and the shared
batch had zero remaining instances for its expressID at all. The
checkered pattern on screen was neither of those — it was one *orphaned*
batch instance, still holding the geometry, that nothing was tracking
anymore by name but that a monkey-patched `BatchedMesh.prototype.setVisibleAt`
(logging every call plus a stack trace) caught red-handed: `false` from
`ensureMaterialized` (elementBatching.ts) at click time, immediately
followed by `true` from this file's own per-frame batch loop — still
running, on the *very next* `requestAnimationFrame` tick, because the
`useEffect` that removes a migrated element's `bvTarget` from
`batchVisibilityTargetsRef` hadn't committed yet. `ensureMaterialized`'s
own hide is synchronous, inside the click handler; React's effect that's
supposed to stop the batch loop from re-touching that instance is not —
it can lag by one or more animation frames, and R3F's own frame loop does
not wait for it. In that gap, the batch loop still finds the *old*
`bvTarget`, computes visibility off whatever date the click happened on
(here, a date the element was legitimately built by), and writes it
straight over `ensureMaterialized`'s already-correct hide. Because nothing
ever revisits an orphaned instance once resolve() and the migration effect
have both stopped tracking it, that one wrong write stuck forever, on a
schedule-correct, fully-fixed-per-every-earlier-theory element.

**The actual fix**: `ResolvedBatchVisibilityTarget` now carries a direct
reference to the batch's own `expressIdByInstanceId` reverse map —
`elementBatching.ts`'s `ensureMaterialized` already deletes an instance
from that map synchronously, in the exact same tick as the correct
`setVisibleAt(id, false)` call, with no async gap of its own. The batch
loop now checks `bv.expressIdByInstanceId.has(instanceId)` before writing
anything — an instance missing from that map has already been claimed by
an individual mesh, no matter how many stale frames this bvTarget survives
before the migration effect gets around to removing it. This closes the
race at its true source rather than patching around one more symptom of
it, and — unlike the `materializeVersion`/`timelineControlled` marker
fixes earlier the same day — needs no per-call-site cooperation: it
protects every current and future path that calls `ensureMaterialized`/
`materializeAll`, not just the ones already known about. Verified live,
repeatedly, on the real Hospital project against the *exact* screenshot
that broke the third fix: click the metal-deck slab, scrub back to before
its 24 Feb 2028 start while it stays selected — correctly disappears every
time now, and scrubbing forward correctly rebuilds it.

**The lesson, a fourth time**: "the math is right and I fixed the known
writer" is not the same as "I found the bug" — when a fix's own live
instrumentation proves the *application* state was correct the whole time
(opacity 0, `.visible = false`, on the one mesh being tracked) yet the
screen still disagrees, stop trusting reasoning about the code and go
straight to the actual render target: monkey-patch the suspect API,
capture a stack trace on the wrong call, and read who actually made it.
Three plausible-sounding theories, independently confirmed by clean
targeted tests, still weren't the real bug — a raw call-site trace found
it in one shot where source-reading had failed three times in a row.

## 2026-07-22 — Animation profiles move up to the Activity level, and a second bug hiding behind the first

Maro's ask: assign an Animation Profile to an *Activity*, not just to
individual model-element links, so setting one profile bulk-drives every
3D element linked to that activity — plus a "3D Profile" column in
Scheduling.tsx showing "Default" until it's overridden. The data model
side was mechanical (new nullable `animation_profile_id` FK on
`activities`, mirrored schema fields, a validation helper, a migration)
and the cascade was a one-line change in three places that already read a
link's own profile: `link.animation_profile_id ?? activity.animation_profile_id`,
falling through to the global default only if neither is set.

**Bug one, in the new dropdown itself**: the "3D Profile" cell's
`<select>` followed the same `onChange`-sets-state / `onBlur`-commits
pattern every other editable cell in that grid already used. For a native
`<select>`, picking an option can fire `change` then `blur` back-to-back
in the same event pass — and `onBlur`'s `commitEdit()` was closing over
the *previous* render's `editingValue` (still `''`), so it PATCHed a
null-reverting no-op that landed after the correct save. Confirmed with
`read_network_requests` (two PATCH 200s per click, final DB state always
null) and reproduced identically by dispatching `change`+`focusout` via
raw DOM events through `javascript_tool`, ruling out an automation
artifact. Fixed by committing straight from the change event's own
`e.target.value` and dropping the onBlur commit for this one field —
`onChange` is already the complete "user is done" signal for a dropdown.

**Bug two, invisible behind bug one**: after that fix, the save *still*
didn't stick on the very next live re-test. Instrumenting `fetch`/XHR
directly (see [[feedback_stale_dev_server]]) showed the PATCH request
body was correct and got a real `200`, but the JSON response body's key
list — 53 keys, `calendar_id` present, `animation_profile_id` absent —
proved the *backend* didn't know the field existed, despite the model,
schema, and migration all being right there on disk and a fresh
`python -c "from app.schemas.activity import ActivityResponse; ..."` in
the same venv confirming the field was in `model_fields`. The running
`uvicorn`/`run.py` process was a genuine Windows zombie: `netstat`/
`Get-NetTCPConnection` showed *two* processes both `LISTEN`ing on 8000,
and the stale one's PID was unkillable by `Stop-Process -Force` or
`taskkill /F` ("not found") and unqueryable by `Get-Process`/CIM, yet it
kept answering real HTTP requests with the old schema. Found by
enumerating processes by *command line* (`Get-CimInstance Win32_Process |
Where CommandLine -match 'run.py'`) instead of trusting a remembered PID,
which turned up the true duplicate; killing every match and re-verifying
`Get-NetTCPConnection -LocalPort 8000` was empty before the next restart
finally fixed it. Full data path re-verified after that: PATCH persists
→ survives a fresh reload → the 4D module's own `/activities` fetch for
that activity carries the right `animation_profile_id` — confirmed via
the same fetch/XHR instrumentation trick, not just eyeballing the grid.

**The lesson**: a "confirmed bug, confirmed fix, still doesn't work on
re-test" loop is a signal to stop re-reading the frontend diff and check
whether the *server* actually restarted — a fresh restart log message is
not proof; `curl .../openapi.json` and grep for the new field name is.
And when a process refuses to die via the normal tools, that's not a
reason to keep retrying the same kill — it's a sign there are two of them
and you're only killing one.

## 2026-07-22 (later same day) — "Pivot Rotation," and a save that only ever completes once you look away

Maro's ask, in his own words: "i want to be able to change pivot
rotation, right now although the car and road are adjacent, if i move
the car it will move at an angle" — turned out to mean the plain Move
gizmo, not a Follow Path binding (confirmed by asking first rather than
guessing, given path_follower.py's `orient_to_path` was an equally
plausible reading). The existing "Set Pivot" feature (elementPivot.ts,
2026-07-12) already redefines an object's rotation/scale *origin*
without moving its visible geometry — Pivot Rotation is the same idea
for *orientation*: redefine what an object's own local axes point in,
without visibly rotating it, so switching the Move gizmo to Local space
(a three.js capability that already existed but had never been wired
into this app's own UI) drags along that custom frame instead of either
raw world axes or the object's true visible rotation.

**The math**: geometry (or, for a Group, every child's position *and*
own quaternion) gets pre-rotated by the *inverse* of the pivot rotation
offset, while the object's own quaternion gains the offset on top —
`object.quaternion = Q0 * R`, geometry pre-rotated by `R⁻¹`, so the two
cancel out visually. Order matters: the existing position-pivot
compensation (`object.translateX/Y/Z`, which moves along whatever the
object's *current* local axes are) has to run *before* `R` gets folded
into the quaternion, or it would translate along the new, rotated axes
instead of the ones the geometry was actually recentered in — a subtle
one-line reordering bug that's easy to get backwards and only shows up
the moment someone sets both a pivot point *and* a pivot rotation on the
same object. Verified by algebra first, then live: setting a 90° pivot
rotation left two screenshots pixel-identical, while the Local-mode
gizmo's own arrows visibly swung round to the new frame — a good general
pattern for confirming a "should look unchanged" compensation actually
is, rather than trusting the derivation alone.

**Bug found along the way, #1**: testing this against the sample "Snowdon
Towers Sample Site.ifc" file, *no* transform edit ever produced a single
network request — not the new Pivot Rotation fields, not even the
plain, years-old Rotation field. Root cause: `FourD.tsx`'s
`persistActiveTransform` bailed out entirely (`if (!activeTransformObject
|| !activeSceneObject?.fileId) return`) whenever `fileId` was still null,
*before* ever reaching the self-heal logic a few lines further down that
was specifically written to recover exactly that case (its own comment
even says so). Fixed by only gating on the object/scene-object existing,
letting the self-heal (or its own proper user-facing error) actually run.

**Bug found along the way, #2, hiding behind #1**: fixing that still
produced zero network activity. A one-line `console.log` inside
`persistActiveTransform` showed it firing *dozens of times a second* —
`TimelinePlayback`'s own per-frame `onTick` (`Viewport3D.tsx`: `if
(activeObjectId) onTick()`) is wired to the exact same callback
(`onTransformChange`) a real gizmo edit uses, completely unconditionally,
for as long as *any* object is selected. Since `persistActiveTransform`
clears and reschedules its own 700ms debounce on every call, a
continuously-refiring `onTick` means the debounce can never survive long
enough to fire while the object stays selected — the save only actually
lands the moment you deselect (or switch to a different object), letting
the last-scheduled timer finally run undisturbed. Confirmed directly:
deselecting produced the exact POST that had been silently queued the
whole time.

Flagged to Maro rather than silently fixed alongside bug #1 — he asked
for it fixed in the same pass. The real fix: give `onTick` its own
callback (`Viewport3D`'s new `onTimelineTick` prop → `FourD.tsx`'s new
`handleTransformTick`, which only does `setTransformTick(t => t + 1)`)
instead of sharing `onTransformChange` with a real gizmo edit
(`handleTransformChange`, which still also calls
`persistActiveTransform`). Re-verified live afterward, deliberately
*without* deselecting this time (the whole point) — the save now landed
on its own, correct pivot rotation value included, while the object
stayed selected throughout.

**The lesson**: "zero network requests, zero errors" doesn't mean "the
guard is wrong" — it can just as easily mean "the thing scheduling the
request is being cancelled before it ever gets a chance to run." A
single `console.log` at the top of the suspect function, read for
*frequency* rather than presence/absence, found in one shot what several
rounds of XHR-log-diffing across page reloads had missed. And a save
mechanism that "eventually" works once you stop touching the thing you
just edited is not obviously broken in normal use — it took deliberately
keeping an object selected while checking the network tab, which is
precisely what testing (and not `console.log`-first debugging) does
differently from a user's own workflow.

## 2026-07-23 — "Snap to Surface," and a raycast that quietly can't see schedule-linked IFC elements

Maro's ask: drag an element (a car) and have it rest on whatever other
geometry (a road) is directly underneath it, so only the horizontal drag
needs doing by hand. Built as a small, self-contained addition: a ray cast
straight down from the dragged object's current position, first hit (other
than the object's own subtree) wins, only the vertical position component
gets overwritten — deliberately *not* persisted anywhere (unlike Pivot
Rotation), since it describes how dragging behaves right now, not a fact
about the object. A Global/Local-style toggle, translate-mode only.

**Verification took a very different shape than usual** — no visual "did it
move correctly" screenshot comparison this time, because getting two real
objects into the same neighborhood in world space (a plain mesh import
centered near its own local origin; this project's sample IFC file, whose
geometry carries real large-scale site-survey coordinates) turned out to be
its own small ordeal, on top of an unrelated WebGL-context exhaustion
symptom (the viewport rendering nothing but the gizmo after a long run of
same-tab reloads — fixed by opening a *fresh* tab, not by anything in the
app). Ended up temporarily exposing the raycast helper and a couple of
scene references on `window` to test it directly from the console with
real objects rather than fighting camera framing — same one-off-debug-hook
pattern this project's memory already has on file for scene inspection,
removed again before commit.

**What that testing actually found**: `THREE.Raycaster.intersectObjects`
against a plain mesh (`car.fbx`) works exactly as expected — a raycast
straight through its own known world-space bounding box hit it immediately.
The *same* raycast against the sample IFC building's batched geometry
returned zero hits, every time, from dozens of different positions
including dead center of its own bounding box. Traced to
`THREE.BatchedMesh.getVisibleAt()` — sampled 126 instances spread evenly
across all 17,254 in the batch, every single one `false`, despite the
building rendering completely normally on screen. Confirmed this batch's
elements are genuinely linked to real schedule activities (Isolate's own
"Linked Activities (40)" popup listed real T-00xx codes) — meaning their
visibility is governed by this app's own timeline/schedule-driven pass
(Viewport3D.tsx's own `timelineControlledInstanceIds` carve-out, which
deliberately skips the plain settings-driven base-visibility pass for
exactly these elements), not the simpler always-on default every other
instance gets. In a session where the Animation Timeline was never opened
— true of a plain fresh page load — nothing ever resolves a "current date"
to drive that schedule-visibility pass, and the instances stay at whatever
`visible` state that leaves them in for raycast purposes, even though
*rendering* clearly isn't gated the same way (the building draws fine
regardless).

**First reported "still not working," and a genuinely wrong assumption**:
initially flagged this to Maro as a maybe-working-as-designed timeline
dependency rather than fixed outright. He pushed back with a directly
relevant counter-example: the Measure tool's own Area (face) mode *can*
detect and measure a selected IFC element's surface. That was the right
challenge — Measure's own `MeasurementCatcher` raycasts the exact same way
(`raycaster.intersectObjects(scene.children, true)`), so if it "just
works," the BatchedMesh-visibility theory needed to explain that too, not
wave it away. Re-reading `MeasurementGizmo.tsx` closely enough answered it
without more guessing: it only *resolves a face* against an already-
`ensureMaterialized`'d element — real per-element meshes, not the raw
batch — and *every* UI path that selects an element (viewport click, IFC
Data tree) already calls `ensureMaterialized` on it first. Measure "working
on a selected element" and "BatchedMesh.raycast returning zero hits" were
never in conflict; Measure was just never actually raycasting the still-
batched geometry to begin with.

**The real fix, once that was untangled**: `THREE.BatchedMesh.raycast`
(`node_modules/three/src/objects/BatchedMesh.js:926`) skips any instance
whose own `drawInfo[i].visible` is `false` — confirmed by reading the
library source directly, not inferred. Rather than touching this app's own
timeline-visibility machinery (out of scope, and a much larger blast
radius), `snapObjectToSurface` now temporarily forces every instance's
flag `true` — via the exact instance ids `BatchState.expressIdByInstanceId`
already tracks, no guessing at a valid index range — runs the raycast, then
restores every flag synchronously before returning, so nothing else in the
app (an isolated view, a live timeline) ever observes the change. Verified
live: `allHitsCount` went from `0` to `8` the moment the object's own
horizontal drag position passed over real roof geometry.

**A second, independent bug turned up right behind the first one**: fixing
the raycast, the car still didn't visibly move — `hit` was real, but
`object.position.z` (matching `upAxis`'s own 'z' convention) silently
assumed the object's own local Z axis IS world-vertical. True only for an
object with no axis-correction wrapper of its own; `car.fbx` here is Y-up
under this Z-up scene, sitting inside a 90°-about-X correction `<group>`
(see `toLocalPoint`'s own header, same file) under which local *Y*, not Z,
is the one that's actually world-vertical. The raycast had been finding
real hits the whole time in some earlier attempts too — the fix just kept
writing to the wrong field. Corrected by working entirely in *world* space:
take the object's current world position, replace only its world-vertical
component with the hit's, convert the whole point back to local via
`worldToLocal` in one shot, and `.copy()` it onto `object.position` wholly
— sidesteps ever needing to know which local axis is "up" for any
particular object's own wrapper, since `worldToLocal` already accounts for
it correctly. Verified live, repeatedly: Z dropped from a deliberately-set
50 down to 8.126 (the real roof height) the instant the fix landed, and
kept tracking correctly (6.614 at a different horizontal position) across
further drags.

**The lesson**: a first hypothesis that fits the evidence isn't the same as
a *ruled-out* one — Maro's counter-example (Measure "just works") was the
signal that the timeline-visibility theory, while plausible, hadn't
actually been checked against the one piece of contrary evidence sitting
in the same codebase. And a fixed root cause doesn't guarantee a fixed
symptom: the visibility gate and the wrong-axis-write were two fully
independent bugs stacked on the same feature, each capable of producing
the *identical* "nothing happens" symptom on its own — fixing the first
one and re-testing was what surfaced the second, not further reasoning
about the first.
