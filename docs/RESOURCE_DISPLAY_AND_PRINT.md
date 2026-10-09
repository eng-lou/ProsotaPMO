# Resource display and printing

Updated 6 October 2026. Implementation through commit `6771597` is pushed to `main`.

## Display controls

Resource Tracking and Resource Usage Profile each have independent Budgeted,
Actuals and Earned Value checkboxes. At least one series remains selected.
Selections are saved in browser local storage and used by the corresponding
printed view. The BIM resource windows use the same controls.

Tracking widens its period columns when several series are visible and labels
values B, A and EV. Missing actual/earned figures are blank; recorded zeros remain
visible. Budget zero cells retain their existing blank display. Manual levelling
is available with Budgeted selected alone; actual and earned figures are read-only.

Each view also has a saved **Show overallocation** preference, enabled by default.
Disabling it suppresses red highlighting without changing figures. The profile's
budget bar stays yellow; when enabled, only the portion above capacity is red.
Tracking highlights the resource's overallocated budget total. Printed views
respect their corresponding preferences. The capacity line remains visible when
Budgeted is selected, even when red highlighting is disabled.

## Meaning of actual and earned figures

Tracking and Profile share `computeUsageProfileSeries` in
`frontend/src/modules/scheduling/useResourcesTabData.ts`.

- Budget follows the assignment's time-phased resource spread.
- Where only cumulative AC/EV totals exist, opening balances are estimated across
  elapsed calendar time, bounded by actual completion or the schedule data date.
- Subsequent recorded history changes retain their reporting dates, including
  late costs after physical completion.
- Hours and days for AC/EV are cost-derived equivalents using the resource rate,
  not imported timesheets. A missing/zero rate currently produces zero equivalents.
- Activity AC/EV is counted once on its first tracked assignment. It is not a
  separate actual-cost allocation for every resource assigned to that activity.
  Additional assignments do not multiply the activity total.

These limitations are important when interpreting a resource-level report. The
new display controls do not introduce new actuals records or change accounting.

## Timeline alignment and print space

Tracking and Profile share period widths for days, weeks, months, quarters and
years. Profile follows Tracking's series-dependent width while retaining its
own series selection. Screen timelines still scroll independently.

Print retains the entire timeline across the width, as requested. It does not
split dates into sections. Rows and the chart grow vertically to compensate for
browser shrinking of wide timelines. Page Setup offers **Vertical spacing**:
Compact, Comfortable (default), Spacious and Extra spacious. This preference is
saved locally and affects print only.

The height calculation uses the timeline's configured width relative to 1,100px;
it does not measure the printer's usable paper area. Paper, margins and browser
scale still affect pagination. Taller rows/charts do not independently enlarge
text; the existing print-font controls remain available.

Excel export is a separate path. The new series and overallocation controls are
wired to screen/print, not to new Actuals/EV Excel output.

## Verification

- Frontend production builds passed for the display and print changes.
- `node --test tests/resourceUsageProfile.test.mjs` (from `frontend`) passed all
  10 tests, including assignment/profile reconciliation in hours, days and cost,
  duplicate assignments, earned-only values and late actuals.
- The user confirmed period alignment works after deployment.
- The final taller print layout and overallocation toggles have build validation;
  their appearance across browser paper sizes has not been visually verified.

## Related scheduling changes

Activity rows have a drag handle left of the checkbox. Drops reorder siblings
under the same parent; moving a summary carries its children. Edge scrolling
supports long lists, and a successful drop restores manual ordering. Dates and
parent relationships are preserved. Nine backend move tests passed.

Printed Gantt dependency routes are split into row-local segments so their
endpoints paginate with their task bars, rather than using a table-wide overlay
that ignores repeated headers and page-break gaps.
