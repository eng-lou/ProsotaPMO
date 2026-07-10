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
