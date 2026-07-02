# ProsotaPMO — Plain English Learning Log

This file explains, in simple everyday language, what has been done on this project and in what order. It's written for Maro (or anyone else) to read back later and understand how the app was actually built, step by step — no technical jargon assumed.

`PROJECT_STATE.md` and `ARCHITECTURE.md` are the technical reference docs for Claude. This file is the human story version.

Updated at the end of every working session.

---

## Session 1 — 2026-06-30: Turning the idea into a real project

Before this session, ProsotaPMO only existed as one big demo webpage (a "prototype") that showed what the finished product should look like and do, plus a business case document explaining why it's worth building. Nothing was set up as an actual, real piece of software yet.

Steps taken:

1. **Organised the project into folders.** Created a proper structure: one folder for the backend (the "engine" that stores and manages data), one for the frontend (what users actually see and click on in their browser), one for documentation, and one for infrastructure (cloud setup, later).
2. **Saved the reference materials.** Copied the original demo webpage and the business case/scope documents into the project so they're always available to check against.
3. **Built the "engine" (backend) skeleton.** Set up the technology that will run behind the scenes — a Python-based web service (FastAPI) — and defined the database tables it needs: organisations, projects, time periods, activities (schedule tasks), risks, cost elements, and issues/changes/decisions. Confirmed it actually runs on the computer and can talk to a real database (PostgreSQL).
4. **Chose the database driver.** Had to switch to a different technical library (psycopg3) than originally planned, because the first choice didn't support the Python version installed. Small technical detour, no impact on the product.
5. **Tried Docker, hit a wall.** Docker (a tool for running software in standardised "containers") couldn't download what it needed on this machine, so local development continues without it for now — not a blocker, just a workaround.

End of session 1: the basic skeleton existed and ran, but there were no real features yet — just the foundation.

---

## Session 2 — 2026-06-30 (continued): Building the first real features

1. **Built full CRUD for Activities and Risks.** "CRUD" means Create, Read, Update, Delete — the basic ability to add, view, edit, and remove records. This was the first time the app could actually store and manage real schedule activities and risks, with automated tests proving it works correctly.
2. **Built the "linking" feature.** This is one of the app's special ideas — the ability to connect any record to any other record (e.g. "this risk causes a delay in this activity"). Built and tested that this works in both directions.
3. **Improved Cost Elements.** Added the ability to track costs either as a fixed amount or as a percentage-based calculation.
4. **Built full CRUD for Cost Elements and Issues/Changes/Decisions ("ICD").** Same idea as Activities/Risks — full add/view/edit/delete, fully tested.
5. **Set up automatic checks (CI).** Configured GitHub to automatically run all the tests every time code is pushed, so mistakes get caught early instead of being discovered later.

End of session 2: the backend could fully manage Activities, Risks, Cost Elements, and Issues/Changes/Decisions, with the cross-linking feature working and everything automatically tested.

---

## Session 3 — 2026-07-01: Logging in, and the first screen users see

1. **Added real login (Auth0).** Before this, there was no concept of "users" — anyone could do anything. Now the app requires a real login through Auth0 (a login/security service), so every action is tied to a real, verified person.
2. **Started the frontend (the part users actually see).** Set up the visual side of the app using React — the technology that will render all the buttons, tables, and screens.
3. **Built the Project Selector screen.** This is the very first screen a user sees after logging in — it lists their real projects (pulled from the backend, not fake demo data anymore) and lets them create a new one or pick an existing one to work in.
4. **Built the basic app layout.** Added the sidebar menu listing all 8 planned sections of the app (Dashboard, Scheduling, Risk Register, Cost Plan, ICD Tracker, File Manager, Period Manager, Export Center), even though most of them don't have real screens behind them yet.
5. **Connected frontend and backend.** Made sure the two sides could talk to each other securely (handling a browser security rule called CORS), and made sure that the first time someone logs in, the system automatically creates their organisation and user record behind the scenes.
6. **Added Projects, Periods, and "who am I" backend features**, with tests, to support the above.

End of session 3: a real person can log in, see their real projects, create a new one, and land inside the app shell with a working menu. No individual module screens (like Risk Register) are built yet — that's next.

Checked back in at the start of this session (still 2026-07-01): confirmed all 71 backend automated tests still pass and nothing was left uncommitted. Created this log file so progress stays understandable in plain language going forward.

---

## Session 4 — 2026-07-01 (continued): The first real working screen — Risk Register

1. **Built the Risk Register screen.** This is the first module (out of the 8 planned sections) with a real, working screen instead of a "Coming soon" placeholder. Users can now see a table of risks, add a new one, edit an existing one, or delete one — all of it actually saving to the real backend, not fake demo data.
2. **Demonstrated the "linking" feature on screen for the first time.** Each risk can now be expanded to show and manage connections to other risks (e.g. "this risk causes a delay in that one"). This is only risk-to-risk for now, because the other modules (like Activities or Cost Elements) don't have their own screens yet to pick from — but it proves the underlying linking system works end-to-end, not just in the backend.
3. **Added a small temporary workaround for "periods".** Risks always belong to a specific reporting period (e.g. "Period 1", "Period 2"), but the real Period Manager screen doesn't exist yet. So for now, the app quietly creates a default period automatically if a project doesn't have one yet, just so the Risk Register isn't blocked. This is a stopgap, not the finished feature.
4. **Checked the work carefully before calling it done.** Ran a type-checking tool to catch code mistakes before they'd show up as bugs — confirmed the new code introduced zero new problems (a handful of unrelated pre-existing issues were double-checked and confirmed to already exist before this session's changes, using `git stash` to temporarily "hide" the new work and re-test). Started both the backend and frontend up and confirmed they run without errors.
5. **Hit a real limit: couldn't click through it myself.** The app requires a real login (through Auth0) before you can reach the Risk Register screen, and that login needs real credentials that only the founder has. So while everything technically checks out (no errors, servers running fine), the actual "click Add, type a risk, see it appear" moment still needs to be done by a human in a real browser at least once, to be fully sure it behaves correctly.

End of session 4: Risk Register is built and technically verified, but not yet clicked-through by a human. Nothing has been saved to git yet — that happens after it's confirmed working.

---

## Session 5 — 2026-07-01 (continued): A real bug, found by actually trying it

Maro tried the Risk Register in a real browser as suggested, and hit an error: "Failed to create project." This turned out to be a genuine bug, and a good example of why the "click through it yourself" step matters — all the automated checks in Session 4 had passed, but they couldn't have caught this.

1. **What actually broke.** The backend uses a database driver (something that lets the Python code talk to PostgreSQL) that, on Windows specifically, needs a particular kind of "event loop" (the underlying machinery that lets the program do several things at once) called a `SelectorEventLoop`. Windows normally defaults to a different one. The automated tests already had a workaround for this, but the real running server didn't — and nobody had noticed, because every check so far had only touched a trivial "are you alive?" endpoint that doesn't use the database at all. The moment a real feature tried to write to the database, it broke.
2. **How it was found.** By reading the backend's own error log after the failure — the real cause was clearly written there, several layers down in a technical stack trace, even though the app only showed the user a generic "Failed to create project" message.
3. **How it was fixed.** Added a small new file, `backend/run.py`, whose only job is to tell Windows to use the correct event loop *before* the server starts up. From now on, the backend should be started with `python run.py` instead of the raw `uvicorn` command.
4. **Checked before declaring it fixed.** Ran a direct, isolated database query using the same fix to prove the connection genuinely worked, before asking Maro to try again in the browser rather than just assuming it was fixed.
5. **Confirmed working, then committed.** Maro retried creating a project in the real browser and confirmed it worked. Only then were the Risk Register feature and this bug fix saved to git together.

End of session 5: Risk Register works end-to-end, confirmed by an actual human clicking through it, not just automated checks. This is now the standing rule for every future session too: build it, check what can be checked automatically, but never mark something "done" or commit it until a human has actually confirmed the real thing works.

---

## Session 6 — 2026-07-01 (continued): Deciding how to pace the rest of the build, then Cost Plan and ICD Tracker

Maro made a call on strategy: rather than polishing the Risk Register screen to match the full prototype's look and detail (heat matrix, summary charts, etc.) before moving on, build every remaining screen to the same basic "it works" level first, and come back to polish all of them together later. The reasoning: every screen depends on the others through the linking feature, so perfecting one in isolation doesn't actually get the product closer to finished — having all the pieces roughly in place does.

1. **Built the Cost Plan screen.** Same pattern as Risk Register: a table of cost items, add/edit/delete. Cost items come in two flavours — a "fixed" cost (a direct number, like "Substructure: £500,000") or a "percentage" cost (like "Prelims: 15%", which automatically works itself out as 15% of all the fixed costs added together, and updates itself if those change).
2. **Built the ICD Tracker screen.** This tracks three related but different things in one place: Issues, Changes, and Decisions — with filter buttons to switch between viewing all of them or just one kind. Each type has its own extra details (an Issue has a severity, a Change has a cost/schedule impact, a Decision has a decision-maker and a due date).
3. **Found a real gap while building this — not a bug, a missing feature.** The Issues/Changes/Decisions data storage had no "title" at all — meaning every single item would have shown up as just "Change · Open · 12 May" with no way to tell what it actually was, useless in practice. This wasn't something breaking, just something nobody had noticed was missing yet. Checked with Maro before fixing it, since it meant changing an already-built, already-tested part of the backend, not just adding something new — Maro chose to fix it properly now rather than defer it. Added it as a proper database change (called a "migration" — a recorded, repeatable instruction for how to update the database structure).
4. **Made the "linking" feature actually cross-module for the first time.** Until now, a risk could only link to another risk, because Cost Plan didn't exist yet to link to. Now that it does, a risk can link to a cost element, a cost element can link to an issue, and so on — genuinely proving out the product's core differentiator (the ability to trace "this risk caused this cost overrun which triggered this change") rather than just a same-type demo.
5. **Checked everything that could be checked without a human.** Re-ran the full automated backend test suite (still all 71 passing, after updating them for the new "title" requirement), re-ran the type-checker (same result as before — no new problems introduced), and confirmed the running servers picked up all the changes cleanly.

End of session 6: Cost Plan and ICD Tracker are built and technically verified, but — same as before — not yet clicked through by a human, since that still requires a real login only Maro can do.

---

## What's next (in plain terms)

Maro to click through Cost Plan (try both a fixed and a percentage cost item) and ICD Tracker (try an issue, a change, and a decision, and link a couple of items together across screens) to confirm it all works before it gets saved to git. After that: Scheduling and the Controls Dashboard, built the same "basic first" way, then one combined polish pass across every screen at the end.

---

## Session 7 — 2026-07-01 (continued): Real user testing found three more things worth fixing

Maro tried out Cost Plan and ICD Tracker and came back with sharp, specific feedback — proof that a real person clicking through catches things automated checks simply can't.

1. **ICD Tracker's "Create" button was actually broken.** The cause was subtle: the running backend program had reloaded itself after an earlier code change, and said "Reloading..." in its own log — but it turned out it never actually picked up the new version properly, and kept running old code that didn't know about the new "title" field added a bit earlier in the session. The fix was to not trust that self-reload message and instead fully stop and restart the program from scratch, then double-check the fix landed before asking for a re-test.
2. **CPI and SPI (two standard project-cost health metrics) were shown as boxes you could just type a number into.** Maro correctly pointed out these aren't things a person should be typing in by hand — they're meant to be worked out automatically from other numbers already in the system (like how well actual spend compares to the budget). Since the app doesn't yet have all the information needed to calculate these properly (in particular, the "how far along is the schedule" data, which lives in the not-yet-built Scheduling screen), the honest fix for now was to remove the manual boxes entirely rather than let someone type in a number that looks official but isn't actually calculated. They'll show as blank until real calculation logic exists.
3. **The Issue/Change/Decision status field was a plain text box instead of a dropdown**, meaning someone could type "opne" by mistake or use inconsistent wording. Fixed by giving each of the three types its own proper dropdown list of sensible statuses (matching the wording used in the original prototype).
4. **Added proper reference codes**, e.g. "RSK-0001" for a risk, "CST-0001" for a cost item, "ISS-0001"/"CHA-0001"/"DEC-0001" for issues/changes/decisions — the sort of short code a team would actually say out loud in a meeting ("have we closed off CHA-0001 yet?"), instead of a long title or an invisible internal ID. Numbers count up per project and are never reused, even if something gets deleted later, and are padded to 4 digits (0001, 0002...) so they stay tidy even with a large number of entries over the life of a project. This touched the database directly (a proper migration, the recorded/repeatable kind of database change), and the two records already created earlier in testing were automatically given codes retroactively so nothing was lost.

End of session 7: three real, specific pieces of feedback addressed, all technically verified again (full automated test suite, type-checking, a full clean restart of the backend rather than trusting its self-reload). Still waiting on Maro to click through and confirm all four fixes for real before anything gets saved to git.

---

## Session 8 — 2026-07-01 (continued): Learning to get the project-management maths right

After confirming the previous round of fixes worked, Maro made a bigger-picture point: as a real project-management expert, he'd noticed a pattern — the CPI/SPI mistake earlier, and now the same kind of mistake in something called "EMV" (Expected Monetary Value, a standard way of estimating how much a risk is really "worth" in money or time). He'd added three official reference books to the project (a PMBOK guide and two PMP exam-prep books) and asked that they be properly consulted going forward, instead of guessing at how these calculations should work.

1. **Looked up the correct formula properly**, using the actual reference books rather than assuming. First had a research pass done across all three books to find the exact formula and definitions. Then, at Maro's specific request to "take your time and learn," went further and read the entire risk management chapter of one of the books directly, start to finish, rather than just taking a summary at face value.
2. **Found the exact mistake.** The correct formula is: EMV = Probability x Impact, where "Impact" must be a real amount of money or time (e.g. "a 65% chance of a £40,000 problem" = an EMV of £26,000) — never a normalised, unitless "severity score." The app had been letting someone directly type in the final EMV figure as if it were just another piece of information to enter, rather than something the software works out on its own from the real inputs. This is the exact same category of mistake as the earlier CPI/SPI issue: a calculated result was being treated as raw data entry.
3. **Fixed it properly.** Added two new proper input fields — "cost impact if this risk occurs" and "schedule impact if this risk occurs," in real pounds and real days — and made the app calculate the actual EMV automatically from those, the same way a spreadsheet formula would, rather than trusting a manually typed number. Also fixed the closely related "risk rating" (used for the classic risk heat-map/matrix) the same way, since it had the identical problem.
4. **Corrected the existing demo data**, since a couple of test risks created earlier had clearly wrong numbers sitting in them from before the fix (one had an EMV of £5,000,000, which was just a number typed in during testing) — recalculated them properly rather than leaving obviously wrong figures on screen.
5. **Added automated tests that check the exact textbook example** (65% chance of a £40,000 problem = £26,000) so this specific calculation can never quietly break again without a test failing.
6. **Learned more than just the one formula.** While reading the chapter properly, also picked up that a full risk register really should distinguish between "threats" (bad risks) and "opportunities" (good risks that could save time or money), and that when adding up all the risk values to work out a project's overall contingency (safety-margin) budget, opportunities should be subtracted from threats, not just added together. The app doesn't do this yet — noted as a future improvement for when a project dashboard/summary screen gets built, rather than something to bolt on right now.

End of session 8: the EMV/rating calculation is now done properly, checked against the actual reference material rather than assumed, with automated tests locking in the real textbook example. As with previous sessions, waiting on Maro to confirm it looks right in the real app before anything is committed.

---

## What's next (in plain terms)

Maro to retest Risk Register with the new fields (probability + impact for the heat-map rating; cost/schedule impact for EMV) and confirm the numbers work out as expected. Once confirmed, everything from today's session gets committed together. Going forward, any future project-management calculation (like this one) should be checked against the reference books in `docs/` before being built, not guessed at.

---

## Session 9 — 2026-07-01 (continued): Bringing the whole Risk Register up to a proper standard

Maro then made a bigger request: the EMV fix on its own wasn't enough. He wanted everything the original demo/prototype had already envisioned for the Risk Register — plus everything the proper project-management textbook chapter covers (threats vs opportunities, watch lists, mitigation tracking, and so on) — pulled together into one clear plan, before doing anything else. So a planning document (`docs/RISK_MODULE_PLAN.md`) was written first, comparing three things side by side: what the original demo already showed, what the textbook chapter says is best practice, and what actually exists in the real app today. Maro then said "go ahead," and all six pieces of that plan were built in one go:

1. **Made the risk description more structured.** Instead of just one title, a risk can now record its Cause (what could trigger it), Effect (what happens if it does), and Rationale (why we think this is a risk), plus who owns/watches it and a second category dimension ("Theme" and "Area") — matching how the original demo laid things out.
2. **Split every risk into "Threat" or "Opportunity."** Not every risk is bad — some are genuinely good things that might happen (like a supplier discount). This turned out to matter more than expected: the textbook's own examples show that a good/threatening risk affects money and schedule in opposite ways from each other (a threat costs money but adds days to the schedule; an opportunity saves money but also saves days) — a subtle detail that was checked carefully against the book rather than assumed, and locked in with tests proving both directions work correctly.
3. **Added "before and after mitigation" risk ratings, with a real visual heat-map.** Previously there was only one risk rating. Now there's the "as things stand today" rating and a separate "what we're aiming for once our mitigation plan works" target rating, shown side by side on an actual colour-coded 5×5 grid (green/yellow/red), the same style of chart shown in the original demo — not just numbers in a table.
4. **Added a proper checklist of mitigation actions per risk.** Rather than one vague "mitigation status" note, each risk can now have its own numbered to-do list of specific actions (e.g. "MA-01: Dual-source supplier"), each with its own owner, due date, status, and progress bar — plus separate "if this happens, do X" and "if X doesn't work, do Y" fallback plans.
5. **Added an editable rulebook for what "High probability" or "Critical impact" actually mean.** Different people might disagree about what counts as a "Medium" risk unless it's written down somewhere shared. Added an editable table (collapsible section at the top of the Risk Register) defining exactly what each probability and impact level means in real terms (e.g. "Medium probability = 25-50% chance," "Critical impact = over £1,000,000 or over 8 weeks"), pre-filled with sensible defaults from the original demo, editable per project.
6. **Made the "how much could this cost" estimate more realistic.** Instead of a single guessed number, risks can now record a Minimum, Most Likely, and Maximum estimate for both cost and schedule impact — like asking "best case, most likely case, worst case?" instead of just one figure. The actual EMV calculation still uses only the "Most Likely" figure, deliberately — the textbook's own worked examples never blend all three into one weighted formula, so rather than invent a fancier calculation that couldn't be checked against the source material, the simpler, verifiable approach was kept.

Along the way, a genuinely large amount of new automated testing was added (26 new tests across three new test files, on top of extending the existing risk tests) — the backend test count went from 71 at the very start of today's session to 97 by the end, and every single one still passes.

**Deliberately left for later, not because they were missed but because they belong elsewhere:** working out a project's overall risk "safety margin" budget by adding up every threat and subtracting every opportunity (that's a whole-project summary, which needs a dashboard screen that doesn't exist yet), and a formal "watch list" for minor risks that don't need full tracking yet.

End of session 9: the Risk Register now reflects both the original product vision and genuine textbook-verified project-management practice, not just a working demo. As always, nothing has been saved to git yet — waiting on Maro to click through the real app and confirm it all works as expected first.

---

## What's next (in plain terms)

Maro to click through the whole Risk Register — the new fields, threat/opportunity selection, the before/after heat-map, adding a mitigation action, editing the criteria table, and entering a 3-point cost estimate — to confirm it all behaves as expected. Once confirmed, everything from today (Cost Plan, ICD Tracker, the EMV fix, and this whole Risk Module upgrade) gets committed together, and then it's on to bringing Cost Plan and ICD Tracker up to the same standard, followed by Scheduling and the Controls Dashboard.

---

## Session 9 (continued): First real test found a real bug — a box too small for a real answer

Maro tried actually creating a risk with realistic detail, and it failed. This is exactly the value of a human testing it for real: the box for "Mitigation status" had quietly been limited to only 50 characters ever since it was first built — far too small for an actual sentence describing what's being done about a risk — and nobody had noticed because nobody had typed a real, full answer into it until now. Widened it to allow a proper paragraph, like the similar boxes next to it (Contingency plan, Fallback plan), and changed it from a single skinny line to a proper multi-line text box to match. Added a test using Maro's exact wording so this specific mistake can't quietly come back.

Maro then confirmed the whole Risk Module "works extremely well" — so everything from this long session (Cost Plan, ICD Tracker, the EMV fix, and the full Risk Register rebuild) was saved to git as one commit. Before doing that, though, the three big reference PDFs were deliberately kept out of git — they're large (about 108MB combined) and are commercial, copyrighted study materials, not something the project should be redistributing every time someone copies the repository. They're still on this computer for reference; just not tracked by version control.

## Session 9 (continued further): A few more real-world fields the register still needed

Maro then pointed out the Risk Register still wasn't quite finished — a few realistic, everyday fields were missing:

1. **When was this risk first noticed?** ("Date raised") and, separately, **when was it closed** (if it has been)? These track the lifetime of a risk from identification to resolution, matching how the original prototype recorded a "Date Identified."
2. **When would this risk actually happen, if it does?** Added as "Expected impact date" — a best guess at the date the problem would actually hit the project, separate from when it was first spotted. (This is a best interpretation of what was asked for — worth double-checking the wording is exactly right.)
3. **When was this risk last properly looked at again?** ("Last reviewed") — so it's clear if a risk has been sitting untouched for months versus checked recently.
4. **A running history of "what changed and why," each with its own date and time** — separate from the existing single explanation box. Previously there was only one "why is this rated this way" text box, which gets overwritten every time it's edited, losing the story of how the risk evolved. Now, whenever someone changes the probability, impact, or status of a risk, the app notices and gently prompts: "this changed — want to explain why?" If they do, it's saved as a permanently dated entry in a running list, building up a real history over time (e.g. "12 June: probability lowered after supplier confirmed backup plan"). There's also a manual "+ Log a review" button for cases where someone checked a risk and decided nothing needs to change, so that gets recorded too. Every time something is logged this way, the "Last reviewed" date above updates automatically.

End of session 9: 105 automated tests now pass (up from 71 at the very start of the session). As always, this newest addition hasn't been saved to git yet — waiting for Maro to check it in the real app first, and in particular to confirm the "Expected impact date" naming actually captures what was meant.

---

## Session 9 (continued, further still): Making the review log fixable, and bringing back the everyday toolbar tools

Maro called this "brilliant work" and asked for two more things: the ability to fix or remove a review-log entry (previously it could only ever be added, never corrected — a reasonable safety feature for some tools, but not what was wanted here), and a set of practical, everyday tools the original demo had that hadn't been rebuilt yet: a search box, a filters button, a way to group risks together, the ability to export the list, and a proper print/preview.

Before building, two quick judgment calls were checked first rather than guessed at:
- One of the demo's buttons, labelled "C-3," had genuinely no function behind it anywhere in the original demo's code — not a hidden feature, just leftover visual decoration. Confirmed it was safe to skip rather than invent a meaning for it.
- "Import" (pulling in a real Excel or XML file) is a much bigger job than the rest — it needs real file-reading and a way to match up columns, not just a button. Rather than repeat the exact mistake this whole session has been about (building something that looks like it works but doesn't), Import was deliberately left for its own separate piece of work later. Everything else (search, filters, grouping, export, print) was built for real this time.

What was added:
1. **The review log can now be edited or deleted**, not just added to.
2. **A real search box** — type a risk's name, code, category, area, or owner and the list narrows instantly.
3. **A filters panel** — tick which statuses, which risk types (threat/opportunity), which theme, or which area you want to see, and the list narrows to match; a live counter shows how many filters are active.
4. **Grouping** — view the register bundled by Theme, Area, Status, or Risk Type instead of one long flat list, with a count next to each group.
5. **A genuine working Export button** — downloads the risks currently on screen (respecting whatever search/filters are active) as a real spreadsheet file that opens directly in Excel. Deliberately not a fake "Export to .xlsx" button that does nothing — this one actually works, today, with no extra software needed.
6. **Real Print/Preview**, using the same print function already built into every web browser rather than faking a preview screen: tick the risks you want (or none, to mean "everything currently shown"), then choose "Print as shown" for a clean printed version of the table, or "Print selected, full detail" for a proper one-page-per-risk report covering the full risk statement, both heat-map assessments, the 3-point cost/schedule estimate, and the response plan. (The mitigation action checklist and review-log history aren't included in the printed detail yet — flagged honestly as a scope limit rather than silently left out.)

End of session 9 (this stretch): 108 automated tests passing. As always, nothing from this batch has been saved to git yet — waiting for Maro to try all of it out for real first.

---

## Session 10 — 2026-07-01: Bringing the ICD Tracker (Issues/Changes/Decisions) up to the same standard as the Risk Register

With the Risk Register confirmed working and committed, Maro asked for the same rigorous process to be repeated for the ICD Tracker: read the original prototype design and the scope document, read the relevant chapter of the PM reference book, write up a gap-analysis plan document first, and only then start building — phase by phase, testing after every step. `docs/ICD_MODULE_PLAN.md` was created following that process (covering Rita Mulcahy's Issue Log structure and the "Integrated Change Control" chapter), and Maro approved the full 7-phase plan plus a decision to reuse the Risk Register's "reassessment log" pattern for tracking history, rather than building an automatic change-tracking system.

What got built, across all 7 phases:

1. **Filled in the missing basic fields** every issue/change/decision should have had from day one: a description, who raised it (as distinct from who's fixing it), a due date, and a resolution note.
2. **Real Change Control fields for the "Change" type** — what kind of change it is (Variation / Client Instruction / Omission), whether the change-control board approved, rejected, or deferred it (kept separate from the everyday status field), the reason if it was rejected, the actual contract clause it relates to, the cost/time being claimed, and a quality-impact rating.
3. **A "what happens if this decision is late" field** for the Decision type — capturing the real consequence of missing the deadline, not just the deadline itself.
4. **Action items** — a repeatable checklist against any issue/change/decision (its own short code like ACT-01, an owner, a due date, a status, and a percent-complete slider), reusing the exact same pattern already built for Risk's mitigation actions.
5. **Real comments** — a genuine discussion thread on each item, showing the actual signed-in person's name (not a placeholder), where only the original author can edit or delete their own comment (checked on the server too, not just hidden in the screen).
6. **The everyday toolbar tools** — search, a filters panel (status/priority/owner), grouping, a working spreadsheet export, and print/preview (either "print everything currently shown" or "print full detail for just the ones I've ticked") — the same toolkit built for Risk, now generalised for this module too.
7. **A "last reviewed" date plus an editable/deletable review-log history** — exactly like Risk's, auto-prompting for a note whenever status, priority, severity, the change-control decision, cost, or quality impact changes, and auto-updating "last reviewed" whenever a note is logged.
8. **A KPI summary strip** at the top of the tracker — open/overdue issue counts, pending/approved change counts plus their combined cost and schedule impact, and pending/completed decision counts — calculated live from whatever's already loaded on screen, no extra requests needed.

Along the way, three real bugs Maro caught while testing were fixed:
- **Two "Open" options appeared in the status dropdown** for issues. Cause: the dropdown's options were written in Title Case ("Open") but the actual saved value was lowercase ("open") — a mismatch that made the screen inject a second, duplicate-looking entry. Fixed by making every status value consistent lowercase everywhere, with a separate lookup table just for how it's displayed.
- **Priority was a free-text box** instead of a fixed dropdown (Critical/High/Medium/Low) like the rest of the app — fixed.
- **"Due date" and "Required by" meant the same thing for a Decision**, which was confusing — the generic due-date box is now hidden for decisions, and "Required by" (with its own more specific "what happens if we miss it" field) is used instead.
- **The KPI numbers didn't move after changing a Change's status from Pending to Approved.** Root cause: the KPI counts were only checking a separate, less-visible "CCB decision" field, not the main "Status" dropdown Maro actually used — so editing Status alone left the KPI looking at stale data. Fixed so the KPI recognises either field.

End of session 10: 147 automated tests passing (up from 108 at the start of this stretch). Maro clicked through everything in the real app, including the KPI fix, and confirmed it all works — this is the point where it gets saved to git.

---

## Session 11 — 2026-07-01/02: Bringing Cost Plan up to the same standard, then fixing what real testing found

With Risk Register and ICD Tracker both done properly, Maro asked for Cost Plan to get the same treatment: read the original prototype design and the scope document, read the relevant chapter of the PM reference book (Chapter 9, "Budget and Resources," covering cost estimating and Earned Value Management), write up a gap-analysis plan first, then build it phase by phase. `docs/COST_PLAN_MODULE_PLAN.md` was created following that process, and Maro answered four open questions (how to split "Status" from an automatic variance-severity badge; which Estimate-at-Completion formula to use; whether to finally combine Risk's and ICD's near-identical "reassessment log" features into one shared piece of code instead of copying it a third time; and where a project's floor area should live) before approving all seven phases in one go, with an instruction to keep going through every phase without stopping to ask along the way.

What got built:

1. **The everyday missing fields** — who's accountable for a cost line, a proper status dropdown, a longer scope description separate from the short name, a note explaining why a figure has moved, and a QS sign-off (name + date).
2. **Real Earned Value Management** — previously the two key health metrics (CPI and SPI) were just blank, unused columns left over from an earlier fix. This session replaced them with an honest calculation: enter how physically complete a piece of work is (0-100%), and the app works out Cost Variance, Cost Performance Index, the forecast final cost, and how much more it'll cost to finish — all real formulas, not guesses.
3. **Configurable Variance Thresholds** — a project can define what "Over Budget," "Monitor," "On Budget," and "Saving" actually mean in percentage terms, editable at any time, the same idea already built for Risk's probability/impact bands.
4. **A Rate Card** — the same repeatable "Qty × Unit × Rate" breakdown used in real QS cost plans (e.g. "CFA piles × 267 @ £576 each"), attached to any cost line.
5. **Open Commitments** — a running list of purchase orders committed against a cost line, with a live running total.
6. **A proper Cost Summary panel and toolbar** — £ per m² and £ per Space (only shown if a project has a floor area recorded), a budget breakdown by group, search/filter/group/export/print — the same toolkit already built twice for Risk and ICD.
7. **The reassessment log, done once and shared properly** — rather than copy Risk's and ICD's near-identical "log what changed and why" feature a third time, it was pulled out into one shared building block used by all three modules now. Existing history for Risk and ICD was carried across, not lost.

Then Maro tried it for real and found several things that genuinely weren't right, each fixed in turn:

- **Citing the reference book by name inside the actual product** ("Earned Value (Rita Mulcahy Ch. 9)") was flagged as unprofessional — reference material is for how the app gets built correctly behind the scenes, never something a real user should see written on screen. Removed; checked the whole app for anything similar.
- **SPI (schedule performance) turned out to be a fake number.** Because there's no real day-by-day schedule yet (that's tomorrow's job), the "planned value" the formula needs was standing in as just "the budget" — which meant Schedule Performance Index always worked out to be exactly the same figure as % complete restated as a decimal, telling you nothing new. Rather than show a number dressed up as insight, it was removed outright, with a note to bring it back properly once the Scheduling module exists. The cost-side numbers (Cost Variance, Cost Performance Index, forecast, etc.) don't have this problem and stayed.
- **"Forecast" and the computed "final expected cost" were the same thing, entered twice.** Maro caught that a manually-typed Forecast figure was just duplicating what the app already works out itself once progress is entered. Forecast is now always the calculated figure (falling back to the budget itself before any progress exists) — no more typing it in by hand.
- **Budget and "original baseline" were also the same thing, entered twice** — for exactly the same reason: when a cost line is first created there's no previous version to compare against, so of course they start out identical. The baseline is now set automatically from the first budget figure and then locked — it won't shift again just because the budget is edited later, which is what makes "how far have we moved from the original number" a meaningful question at all.
- **The Cost Summary box was quietly comparing mismatched totals** — one side included the percentage-based lines (Prelims, Contingencies, etc.), the other didn't (since those lines never had a baseline to compare against), which inflated the "uplift" figure by the entire on-costs total every time. Fixed to compare like with like.
- **Maro then asked for something more useful than the baseline comparison anyway**: show Budget against the live Forecast instead of the original baseline, since the baseline only ever moves if someone deliberately changes it, whereas the forecast updates the moment real progress is entered — a far more useful "are we heading over budget" signal. Also made the threshold descriptions properly editable (they weren't before, only the percentage cut-offs were).
- **That then surfaced one more contradiction**: the summary said "forecast overrun" while a specific line's badge still said "On Budget," because the badge hadn't been updated to use the same forecast-based comparison — it was still quietly using the old, rarely-moving baseline. Fixed so the badge, the coloured status pill, and the summary box are all now driven by the exact same "forecast vs budget" calculation, and the threshold wording was corrected everywhere (including backfilling the descriptions already saved for Maro's test project) to stop saying "baseline" when it now means "forecast."

End of session 11: 171 automated tests passing. Every fix in this session came from Maro actually clicking through the real app and catching something a computer wouldn't — this is exactly the working pattern that's proven itself over ten-plus sessions now. Everything is committed; next session picks up with the Scheduling module.

---

## Session 12 — 2026-07-02: Building the whole Scheduling module, all nine phases in one go

This was the biggest single session so far — the entire Scheduling module, built the same disciplined way as Risk, ICD, and Cost Plan (read the prototype design, read the relevant chapter of the PM reference book, write a gap-analysis plan first, get sign-off, then build phase by phase) but with nine phases instead of six or seven, because Scheduling starts from nothing — there was no real screen for it at all before this session, just a bare skeleton database table.

Before writing any code, a few real decisions needed Maro's input, since this isn't something the reference book covers the same way it covers Earned Value or risk scoring:

- **How should the task hierarchy work?** Maro chose the Microsoft Project style over the Primavera P6 style — meaning there's no separate "structure" you manage on the side; the list of activities *is* the structure, and any task becomes a "phase" automatically the moment something else is nested under it.
- **Should the app actually calculate the critical path itself, or just display numbers someone else worked out?** Maro was clear this needed to be real and correct — "very important to get it right" — not something to fake or defer.
- **How should working calendars (which days count as working days) be handled?** Confirmed a whole project can run on one standard calendar, but an individual activity can be given its own calendar instead — Maro's own example was a piling activity that needed Saturday working because of contractor availability, while the rest of the project stayed Monday-to-Friday.
- **A free, open-source scheduling tool Maro found online (GanttProject)** was checked directly rather than assumed usable — it turned out to be a completely different kind of software (a Java desktop program, GPL-licensed) that couldn't actually be reused in this project, but it was still useful to study for ideas about how a critical-path calculator should be structured.

What got built, phase by phase:

1. **The basic activity fields** — and the same class of mistake caught before (in Risk's EMV and Cost's CPI/SPI) turned up again here: "is this activity on the critical path" and "how much slack does it have" were sitting there as fields anyone could just type a value into, with nothing actually calculating them. Fixed to be honestly blank until the real calculation exists later in the session.
2. **The task hierarchy (WBS)** — tasks can now be nested under each other by clicking Indent/Outdent, exactly like Microsoft Project. Maro also asked for a choice when deleting a task that has sub-tasks under it: delete everything underneath too, or just that one task while its children move up a level. Both options work.
3. **Task dependencies** — one activity can now be linked to another as "must finish before this starts" (the everyday case) plus three less common relationship types, with the ability to add a lag (a forced wait) or a lead (allowed overlap). The app also now catches and rejects any link that would create a circular loop of dependencies, which would make the schedule impossible to calculate.
4. **Working calendars** — create named calendars (Standard, Saturday Working, etc.), mark which days of the week they cover and how many hours a day, add exceptions like bank holidays or a planned Christmas shutdown, and assign a specific calendar to an individual activity when needed.
5. **The critical path calculator itself — the heart of the whole module.** This is a genuine implementation of the standard critical-path-method calculation used in real scheduling software: given how long each task takes, how it depends on other tasks, which calendar it follows, and any fixed constraints, the app works out the earliest and latest an activity could realistically start and finish, how much spare time ("float") it has, and whether it's on the critical path (zero float — any delay here delays the whole project). This is also the point where Start and Finish dates stopped being something you type in directly and became something the app calculates for you — the same "don't let people type in an answer the computer should work out" principle applied everywhere else in this project, just applied to the biggest and most central numbers in the whole module.
6. **"Set Baseline"** — a button that captures today's planned dates as a fixed reference point, so that as the live schedule shifts around later, you can always see how far current thinking has drifted from what was originally agreed. Unlike Cost Plan's baseline (which is set once automatically and locked forever), a schedule baseline can genuinely be re-captured on purpose whenever a revision is formally agreed with the client — that's how real scheduling practice works, not a shortcut.
7. **A schedule quality check**, based on an industry-standard 14-point checklist (used across construction and defence scheduling) for catching bad scheduling practice — missing links, too much slack, hard-coded dates, activities that go on for months without a checkpoint, and so on. Twelve of the fourteen checks are implemented (the other two need months of historical tracking data across future periods to mean anything, so they're deliberately left for later); Maro's numbering for the checks the prototype already showed was matched exactly, with a note flagging that the ones filled in beyond that should be double-checked against his own practice, since — like the DCMA standard itself — this isn't something covered by the PM reference books already being used to check other modules' formulas.
8. **A "what changed and why" review log**, reusing the exact same shared feature already built for Risk, ICD, and Cost Plan, plus the same search/filter/export-to-Excel/print toolbar as the other modules.
9. **A reschedule tool** — shift the whole programme forward or backward by a chosen number of days/weeks/months and see the new finish date. Because dates are now genuinely calculated rather than typed in, this works by moving the project's start anchor and letting the critical-path engine recalculate everything from there — which is also why an activity locked to a fixed date (a "hard constraint") correctly refuses to move even when the rest of the schedule shifts around it. That's the honest, correct behaviour of a hard constraint, not a bug.

A few real technical snags came up and got fixed along the way, worth recording because they'll matter again:

- **Deleting something with real-world knock-on effects needs extra care.** When one task was deleted and its links to other tasks should have vanished with it, the underlying database technology sometimes got confused about what still existed versus what had just been "cleaned up" from memory — leading to a genuine crash in testing. Fixed by being more careful and explicit about cleaning up connected records before deleting the main one, rather than assuming the database would sort it out silently.
- **Order of operations mattered for the "phase" rollup.** When two tasks under the same phase got linked together (changing their calculated dates), the phase's own summary dates weren't being refreshed afterwards — so the phase could show stale start/finish dates that no longer matched its own sub-tasks. Fixed by making sure the critical-path recalculation always runs before the phase-summary rollup, not after.
- **The live backend server didn't always pick up new code changes automatically**, even though it's supposed to restart itself when files change — caught by checking the running server's own list of available features directly rather than assuming it had updated, and fixed with a full manual restart.

242 automated tests passing by the end (was 171 at the start of the session — every phase came with its own dedicated set of tests). All nine phases are built, tested, and committed. **Not yet clicked through by Maro in a real browser** — that's the next step before considering Scheduling finished. Once confirmed, Cost Plan's still-missing "real SPI" schedule-performance metric can finally be built properly, since it was waiting specifically on Scheduling providing genuine day-by-day planned dates.
