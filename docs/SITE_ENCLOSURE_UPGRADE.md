# Site enclosure upgrade

Reference: user's site photographs, 21 November 2026.

Implemented in the local web release and the access-tower workspace. Existing single-gap fences continue to use the original renderer until the enclosure settings are edited.

## Authoring

In 4D Site tools, open Layout tools and choose Fence. Select a level path and a fence style. Place each opening by its distance from the first path point. Clear gaps, vehicle gates, pedestrian gates and turnstiles remove the occupied panel interval before fitting. Adjacent openings can share an endpoint. Signed swing angles open the gate leaves on either side of the run. A site name adds an entrance board. Warning lamps can be placed on gateposts or along hoarding.

Level offsets are relative to the source path and repeat the run and its openings. The panel limit is 2,000 across all levels of one fence. Preview and Save pin the path snapshot and settings. Overlaps, corner-crossing entrances and openings on curved sections are rejected before saving.

On a complete imported original access tower, choose Edit / regenerate and open Access tower cover. Choose Bare, Blue-green debris net or Reinforced sheeting. Wrap dimensions and local offsets are independent of the tower and hoist motion. A uniform height change also scales the spacing of all six landing openings. The two cover GLBs are bundled by Vite and use the same authored origin as the source asset. For a prewrapped GLB, keep the editor set to Bare.

The tower workspace contains the four complete static and animated variants, the standalone cover GLBs and their generation scripts. Rebuilding the cover appends geometry to the original GLB buffers and preserves original node, accessor and animation indices.

## Original quality targets

- Extend existing fence path generation to multiple non-overlapping openings. Gaps and gates replace panels; they must remain within a straight span.
- Add framed orange mesh edge protection with posts, slab fixings and toe boards, plus mesh perimeter and solid hoarding finishes.
- Add configurable vehicle gates, pedestrian gates, turnstiles, entrance boards and warning lights. Gate opening angles are editable.
- Repeat fence runs using explicit level offsets; cap total generated panels for performance.
- Add optional netted or sheeted covers around the original access tower, with editable cover dimensions and offsets, bay seams and rear landing openings. Preserve stairs, frame and cage animation.
- Use reusable geometry and instancing; verify close-up and whole-site views, dark-mode controls, save/reload, openings and export.

Existing integration points: SiteSceneLayer.tsx Fence renderer, SiteToolsPanel.tsx fence editor, siteScene.ts recipe types, backend/app/services/site_scene.py fence_layout, backend/app/schemas/site_scene.py.

The original access-tower README describes a nominal 18 m tower with six 3 m bays; main stair footprint approximately 3 x 2.7 m excluding hoists and bridges.
