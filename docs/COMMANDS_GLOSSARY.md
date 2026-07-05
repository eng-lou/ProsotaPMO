# ProsotaPMO — Commands Glossary (Plain English)

A running list of every terminal command used to build and run this project, with a plain-English explanation of what it does and why we use it. Written for learning purposes — so you could rebuild or operate this project yourself without needing to already know these tools.

Companion to `docs/LEARNING_LOG.md` (the story of what happened) and `PROJECT_STATE.md`/`ARCHITECTURE.md` (the technical reference). Updated at the end of every session whenever a new command type gets used.

Commands are grouped by tool. Within each group, the most commonly used ones are listed first.

---

## Git (version control — tracks every change to the code over time)

| Command | What it does |
|---|---|
| `git status` | Shows what's changed since the last save point (which files are new, edited, or deleted). The safest "what's going on?" command — never changes anything. |
| `git log --oneline` | Shows the history of past saves ("commits"), one line each, newest first. |
| `git diff` | Shows the exact line-by-line changes that haven't been saved yet. |
| `git add <file>` | Stages a file — marks it as "ready to be included in the next save." Doesn't save it yet. |
| `git commit -m "message"` | Actually saves the staged changes, with a short note explaining why. This is the core "save my work" action in Git. |
| `git push` | Uploads your saved commits to GitHub (the online copy), so they're backed up and shareable. |
| `git branch` | Lists the different parallel lines of work ("branches"). We currently do all work on `main`. |
| `git checkout -- <file>` | Throws away any un-saved edits to one specific file and puts it back exactly as it was at the last commit. Used to cleanly undo a whole run of failed experimental changes to a file, without touching any other files that had separate, wanted changes mixed into the same working copy. |
| `git show HEAD:<path>` | Prints out an old (last-committed) version of a file without actually restoring it — used to pull just a snapshot for reference/copying, while leaving the current working file untouched. |
| `git remote set-url origin <url>` | Changes which GitHub address `git push`/`git pull` actually talk to for this folder — used after a repo got renamed on GitHub's side, so this computer's copy points at the new name instead of relying on GitHub's redirect indefinitely. |
| `git clone --depth 1 <url>` | Downloads a copy of someone else's public GitHub project to read its code, but only the latest snapshot (not its whole history) — much faster, used purely for research (reading how another Gantt-chart tool solved a layout problem) rather than to actually work on that project. |

---

## Backend — Python / FastAPI (the server that stores and manages data)

| Command | What it does |
|---|---|
| `python -m venv .venv` | Creates an isolated, private set of Python software just for this project (a "virtual environment"), so it doesn't clash with anything else installed on the computer. |
| `.venv\Scripts\activate` (Windows) | Switches the terminal into using that private set of Python software. You do this once per terminal session before running backend commands. |
| `pip install -r requirements.txt` | Reads the list of required software packages from `requirements.txt` and installs them all — this is how FastAPI, SQLAlchemy, etc. get onto the machine. |
| `pip install -r requirements-dev.txt` | Same as above, but also installs extra tools only needed for development/testing (like `pytest`), not for running the real app. |
| `uvicorn app.main:app --reload` | Starts the actual backend server running on your computer (usually at `http://localhost:8000`), and automatically restarts it whenever you edit the code. `uvicorn` is the engine that runs FastAPI apps. |
| `python -m pytest -q` (or `pytest -v`) | Runs all the automated tests — little scripts that check the code behaves correctly. `-q` = quiet/short output, `-v` = verbose/detailed output. This is how we catch bugs before they reach real users. |
| `alembic revision --autogenerate -m "message"` | Looks at the database table definitions in the code and automatically writes a "migration" — a script describing how to update the real database to match. |
| `alembic upgrade head` | Actually runs the migration scripts against the database, bringing it up to date with the latest table structure. |

---

## Frontend — npm / Node.js (the visual part users click on)

| Command | What it does |
|---|---|
| `npm install` | Reads `package.json` and downloads every software package the frontend needs (React, Tailwind, etc.) into a `node_modules` folder. |
| `npm run dev` | Starts the frontend in "development mode" using Vite — opens a local website (usually `http://localhost:5173`) that automatically refreshes in the browser whenever you save a code change. |
| `npm run build` | Compiles the frontend into optimised, production-ready files, ready to be hosted for real users. |
| `npm run preview` | Lets you view the built production version locally, to sanity-check it before deploying. |
| `npx tsc --noEmit` | Runs TypeScript's checker over the whole frontend without actually building anything — just reports type mistakes (e.g. passing the wrong kind of data to a function) so they can be fixed before running the app. |

---

## Direct database inspection (a one-off Python script, not a saved tool)

| Command | What it does |
|---|---|
| `python -c "import psycopg; conn = psycopg.connect(...); cur = conn.cursor(); cur.execute('select ...'); print(cur.fetchall())"` | Talks directly to the real Postgres database from the command line, bypassing the app entirely — useful when a bug might be in the *data itself* rather than the code. This is exactly how a real bug was found in session 20: querying the `periods` table directly revealed two "Period 1" rows created 1.5 milliseconds apart for the same project, something no amount of reading the code alone would have shown. |

## curl (a simple way to check a website or server from the command line)

| Command | What it does |
|---|---|
| `curl <url>` | Fetches whatever is at that web address, the same way a browser would, but prints the raw result as text instead of drawing it visually. Handy for a quick "is the server actually running and responding?" check without opening a browser. |
| `curl -s -o /dev/null -w "%{http_code}" <url>` | Same idea, but throws away the actual content and just prints the status code (e.g. `200` = OK, `404` = not found) — a fast way to check "did that work?" in scripts. |

## PowerShell process management (finding and stopping a stuck/wrong server process on Windows)

| Command | What it does |
|---|---|
| `Get-NetTCPConnection -LocalPort 8000 -State Listen` | Finds which running process currently has port 8000 (the backend's address) open and listening. Useful when a server needs restarting but you don't know its process ID. |
| `Stop-Process -Id <id> -Force` | Forcibly shuts down a specific running program by its process ID — used here to kill an old backend server process before starting a fixed version in its place. |

## pdftotext (pulling plain text out of a PDF file)

| Command | What it does |
|---|---|
| `pdftotext -layout <file.pdf> <output.txt>` | Converts a PDF into a plain text file, trying to preserve the original page layout/columns. Used to properly read the PMBOK/PMP reference books directly (page-by-page image rendering wasn't available on this machine, so this was the practical way to search and read the actual chapter text). |

## Docker (not currently in active use on this machine)

| Command | What it does |
|---|---|
| `docker-compose up` | Was intended to start Postgres (and other services) in isolated "containers" with one command, so you don't have to install them directly on your machine. Currently doesn't work on this dev machine because Docker Hub (where the container images are downloaded from) isn't reachable — so we run PostgreSQL natively installed on Windows instead. |

---

## GitHub Actions (automatic checks that run in the cloud, not on your machine)

These aren't commands you type — they run automatically on GitHub's servers every time code is pushed, defined in `.github/workflows/ci.yml`:

- Spins up a temporary PostgreSQL database
- Installs backend dependencies (`pip install -r requirements-dev.txt`)
- Runs the full test suite (`pytest -v`)

This is a safety net: if a change breaks something, it shows up as a red ✗ on GitHub before it can cause real problems.

---

## Notes

- "Terminal" / "command line" / "shell" all mean the same thing: a text-based way of giving the computer instructions, instead of clicking buttons.
- Commands in this file are the ones actually used on this project so far — not a generic tutorial. If a new tool or command gets introduced in a future session, it gets added here.
