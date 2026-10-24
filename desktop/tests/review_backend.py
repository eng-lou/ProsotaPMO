"""Full backend tests against a new disposable PostgreSQL cluster."""
import os, secrets, socket, subprocess, sys
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
root=repo/'desktop/.test-data'/('review-'+secrets.token_hex(5));root.mkdir(parents=True)
pg=repo/'desktop/runtime/postgres/bin';cluster=root/'database'
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
def command(name,*args):
 with (root/'launch.log').open('ab') as log:
  subprocess.run([str(pg/name),*map(str,args)],check=True,stdout=log,stderr=log,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,timeout=90)
command('initdb.exe','-D',cluster,'-U','review','--auth','trust','--encoding','UTF8','--locale','C')
command('pg_ctl.exe','-D',cluster,'-l',root/'postgres.log','-o',f'-h 127.0.0.1 -p {port} -c fsync=off -c synchronous_commit=off -c full_page_writes=off','-w','start')
try:
 command('createdb.exe','-h','127.0.0.1','-p',port,'-U','review','prosota_review_test')
 url=f'postgresql+psycopg://review@127.0.0.1:{port}/prosota_review_test'
 env=dict(os.environ,TEST_DATABASE_URL=url,DATABASE_URL=url,PYTHONPATH=str(repo/'backend'))
 result=subprocess.run([sys.executable,'-m','pytest',*(sys.argv[1:] or [str(repo/'backend/tests')]),'-q','--tb=short'],cwd=root,env=env)
finally:
 command('pg_ctl.exe','-D',cluster,'-m','fast','-w','stop')
sys.exit(result.returncode)
