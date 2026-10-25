"""Publish a verified, immutable Planner installer to an explicit channel."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError

parser = argparse.ArgumentParser()
parser.add_argument('--channel', choices=['stable', 'preview'], required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
folder = root / 'release' / args.channel
manifest_path = folder / 'release-manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
assert manifest['channel'] == args.channel
assert manifest.get('sourceDirty') is False, 'Commit reviewed source and package again before publishing'
assert manifest.get('sourceRevision'), 'Source revision missing'
assert Path(manifest['file']).name == manifest['file'], 'Invalid installer filename'
installer = folder / manifest['file']
with installer.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest().upper() == manifest['sha256']
credential = subprocess.run(['git', 'credential', 'fill'],
    input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True)
fields = dict(line.split('=', 1) for line in credential.stdout.splitlines() if '=' in line)
headers = {'Authorization': 'Bearer ' + fields['password'], 'Accept': 'application/vnd.github+json',
           'User-Agent': 'Prosota-Planner-release', 'X-GitHub-Api-Version': '2022-11-28'}
base = 'https://api.github.com/repos/eng-lou/ProsotaPMO'
tag = f"planner-{args.channel}-v{manifest['version']}"

def request(url, data=None, method=None, extra=None):
    with urlopen(Request(url, data=data, method=method, headers={**headers, **(extra or {})}), timeout=600) as response:
        return json.load(response)

try:
    release = request(base + '/releases/tags/' + tag)
except HTTPError as error:
    if error.code != 404:
        raise RuntimeError(f'GitHub release lookup failed: HTTP {error.code}') from None
    body = ('Recommended release after release checks.' if args.channel == 'stable'
            else 'Latest improvements for testing. Features may be incomplete or less reliable; use test projects.')
    body += '\n\nSign in with your Prosota account. Request access at www.prosota.com. '
    body += 'Stable and Preview have separate local workspaces. Desktop projects do not automatically sync with web. '
    body += 'Existing Prosota Desktop Preview projects stay in Preview. Use Settings → Create backup / Restore backup to transfer a copy between channels.'
    body += '\n\nThe installer is unsigned; Windows may display an unknown-publisher warning.'
    body += f"\n\nSource: `{manifest['sourceRevision']}`\n\nSHA-256: `{manifest['sha256']}`"
    release = request(base + '/releases', json.dumps({
        'tag_name': tag, 'target_commitish': manifest['sourceRevision'],
        'name': f"Prosota Planner {args.channel.title()} {manifest['version']}",
        'draft': True, 'prerelease': args.channel == 'preview', 'make_latest': 'false', 'body': body,
    }).encode(), extra={'Content-Type': 'application/json'})
assert release['prerelease'] == (args.channel == 'preview'), 'Existing tag has a different channel'
assets = {asset['name']: asset for asset in release['assets']}
for file in [installer, manifest_path]:
    with file.open('rb') as stream:
        digest = 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()
    if file.name in assets:
        assert assets[file.name].get('digest') == digest, 'Existing asset cannot be verified or differs; do not overwrite'
        continue
    assert release['draft'], 'Published releases are immutable; use a new version'
    with file.open('rb') as stream:
        request('https://uploads.github.com/repos/eng-lou/ProsotaPMO/releases/' + str(release['id'])
                + '/assets?name=' + file.name, stream,
                extra={'Content-Type': 'application/octet-stream', 'Content-Length': str(file.stat().st_size)})
    print('Uploaded ' + file.name, flush=True)
release = request(base + '/releases/' + str(release['id']),
    json.dumps({'draft': False, 'make_latest': 'true' if args.channel == 'stable' else 'false'}).encode(),
    method='PATCH', extra={'Content-Type': 'application/json'})
print(release['html_url'])
