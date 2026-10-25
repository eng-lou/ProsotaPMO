const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
function sourceFingerprint() {
  const root=path.resolve(__dirname,'..'), hash=crypto.createHash('sha256')
  function visit(folder) {
    for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(entry.name==='__pycache__')continue
      const relative=folder+'/'+entry.name
      if(entry.isDirectory())visit(relative)
      else if(entry.name.endsWith('.py'))hash.update(relative).update('\0').update(fs.readFileSync(path.join(root,relative))).update('\0')
    }
  }
  for(const folder of ['backend/app','backend/alembic','desktop/backend'])visit(folder)
  return hash.digest('hex')
}
const stamp=path.join(__dirname,'runtime/backend/source-fingerprint.json')
function verifyBackend() {
  if(!fs.existsSync(stamp)||JSON.parse(fs.readFileSync(stamp,'utf8')).sha256!==sourceFingerprint())
    throw Error('Bundled backend is missing or stale. Run desktop/build.ps1 -SkipInstaller before packaging.')
}
if(require.main===module&&process.argv.includes('--write'))fs.writeFileSync(stamp,JSON.stringify({sha256:sourceFingerprint()},null,2)+'\n')
module.exports={verifyBackend,sourceFingerprint}
