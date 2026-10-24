"""Owns a private PostgreSQL cluster and backend for the Windows app."""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading


def run(config=None):
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    config = config or json.loads(sys.stdin.readline())
    if config.get("maintenance") == "restore":
        from workspace_backup import restore_backup
        restore_backup(config)
        return
    root = Path(config["dataDir"]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    from workspace_backup import recover_interrupted_restore
    recover_interrupted_restore(root)
    cluster = root / "database"
    pg = Path(config["postgresDir"]) / "bin"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def command(binary, *args):
        # PostgreSQL is a long-lived child of pg_ctl. Do not use PIPE here:
        # inherited Windows pipe handles can keep communicate() waiting forever.
        with (root / "database-launch.log").open("ab") as log:
            return subprocess.run([str(pg / binary), *map(str, args)], check=True,
                                  stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                  creationflags=flags, timeout=90)

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        db_port = sock.getsockname()[1]
    if not (cluster / "PG_VERSION").exists():
        password_file = root / "initial-password.tmp"
        try:
            password_file.write_text(config["dbPassword"], encoding="utf-8")
            command("initdb.exe", "-D", cluster, "-U", "prosota", "--pwfile", password_file,
                    "--auth", "scram-sha-256", "--encoding", "UTF8", "--locale", "C")
        finally:
            password_file.unlink(missing_ok=True)
    # Always re-use this installation's private cluster, never a system service.
    command("pg_ctl.exe", "-D", cluster, "-l", root / "postgres.log",
            "-o", f"-h 127.0.0.1 -p {db_port}", "-w", "start")
    try:
        if config.get("maintenance"):
            from workspace_backup import create_backup, run_pg
            if config["maintenance"] == "backup":
                create_backup(config, pg, db_port)
            elif config["maintenance"] == "load-dump":
                run_pg(pg, "pg_restore.exe", db_port, config["dbPassword"],
                       ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction",
                        str(root / "database.dump")])
            else:
                raise ValueError("Unknown maintenance action")
            return
        config["databaseUrl"] = f"postgresql+psycopg://prosota:{config['dbPassword']}@127.0.0.1:{db_port}/postgres"
        from server import create_app, initialise
        import uvicorn
        app = create_app(config)
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=config["port"],
                                              access_log=False, log_level="warning"))

        def parent_watch():
            # EOF also stops the backend if Electron crashes.
            sys.stdin.read()
            server.should_exit = True

        threading.Thread(target=parent_watch, daemon=True).start()

        async def serve():
            await initialise(config.get("identity"))
            await server.serve()

        asyncio.run(serve())
    finally:
        command("pg_ctl.exe", "-D", cluster, "-m", "fast", "-w", "stop")


if __name__ == "__main__":
    # Existing workers invoke sys.executable with their source-file path.
    workers = {"ifc_conversion_worker": "app.services.ifc_conversion_worker",
               "ifc_planning_snapshot": "app.services.ifc_planning_snapshot"}
    if len(sys.argv) == 4 and Path(sys.argv[1]).stem in workers:
        import runpy
        module = workers[Path(sys.argv[1]).stem]
        sys.argv = sys.argv[1:]
        runpy.run_module(module, run_name="__main__")
    else:
        run()
