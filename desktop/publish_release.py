"""Publish a verified preview installer using the existing Git credential helper.

Credentials stay in memory and are used only with api.github.com/uploads.github.com.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'release/release-manifest.json').read_text(encoding='utf-8-sig'))
installer = root / 'release' / manifest['file']
assert hashlib.file_digest(installer.open('rb'), 'sha256').hexdigest().upper() == manifest['sha256']
credential = subprocess.run(
    ['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
    text=True, capture_output=True, check=True,
)
fields = dict(line.split('=', 1) for line in credential.stdout.splitlines() if '=' in line)
headers = {'Authorization': 'Bearer ' + fields['password'], 'Accept': 'application/vnd.github+json',
           'User-Agent': 'Prosota-release', 'X-GitHub-Api-Version': '2022-11-28'}
base = 'https://api.github.com/repos/eng-lou/ProsotaPMO'
tag = 'desktop-v' + manifest['version']

def request(url, data=None, method=None, extra=None):
    with urlopen(Request(url, data=data, method=method, headers={**headers, **(extra or {})}), timeout=600) as response:
        return json.load(response)

try:
    release = request(base + '/releases/tags/' + tag)
except HTTPError as error:
    if error.code != 404:
        raise RuntimeError(f'GitHub release lookup failed: HTTP {error.code}') from None
    release = request(base + '/releases', json.dumps({
        'tag_name': tag, 'name': 'Prosota Desktop Preview ' + manifest['version'],
        'draft': True, 'prerelease': True,
        'body': 'Windows 10/11 x64 preview. Download and run the Setup.exe installer. '
                'Sign in with your Prosota account; new users request approval through Prosota Web. '
                'Desktop projects are stored locally and do not automatically sync with web projects. '
                'This preview installer is unsigned.\n\nSHA-256: `' + manifest['sha256'] + '`',
    }).encode(), extra={'Content-Type': 'application/json'})
assets = {asset['name']: asset for asset in release['assets']}
for path in [installer, root / 'release/release-manifest.json']:
    if path.name in assets:
        assert assets[path.name]['size'] == path.stat().st_size, 'Existing asset differs; do not overwrite'
        continue
    with path.open('rb') as stream:
        request('https://uploads.github.com/repos/eng-lou/ProsotaPMO/releases/' + str(release['id'])
                + '/assets?name=' + path.name, stream,
                extra={'Content-Type': 'application/octet-stream', 'Content-Length': str(path.stat().st_size)})
    print('Uploaded ' + path.name, flush=True)
release = request(base + '/releases/' + str(release['id']), b'{"draft":false}', method='PATCH',
                  extra={'Content-Type': 'application/json'})
print(release['html_url'])
