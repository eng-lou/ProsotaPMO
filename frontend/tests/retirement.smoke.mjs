import {createRequire} from 'node:module'
import {createServer} from 'vite'
import assert from 'node:assert/strict'
const {chromium,expect}=createRequire(new URL('../../prosotaPowerBI/package.json',import.meta.url))('@playwright/test')
const server=await createServer({configFile:'vite.config.ts',server:{port:4184,host:'127.0.0.1'}})
await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
try{
  const page=await browser.newPage()
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4184')?r.continue():r.abort())
  await page.goto('http://127.0.0.1:4184/')
  await expect(page.getByRole('heading',{level:1})).toContainText('Plan the work.')
  await expect(page.getByRole('link',{name:/Maritime/})).toHaveCount(0)
  await page.goto('http://127.0.0.1:4184/maritime/workspace/models')
  await expect(page).toHaveURL('http://127.0.0.1:4184/')
  await expect(page.getByRole('heading',{level:1})).toContainText('Plan the work.')
  const paths=await page.evaluate(async()=>{
    const {putCachedFile,pruneRemovedProjectFiles}=await import('/src/lib/fileCache.ts')
    await putCachedFile('model','retired','1',new Blob(['retired model']))
    await putCachedFile('texture','retired','2',new Blob(['retired texture']))
    await putCachedFile('environment','retired','3',new Blob(['retired environment']))
    await putCachedFile('model','construction','4',new Blob(['keep']))
    await pruneRemovedProjectFiles(['construction'])
    return (await(await caches.open('prosota-files-v1')).keys()).map(r=>new URL(r.url).pathname)
  })
  assert.deepEqual(paths,['/__file-cache/model/construction/4'])
  console.log('PASS: Construction homepage, removed Maritime navigation, retired URL redirect and scoped browser-cache cleanup.')
}finally{await browser.close();await server.close()}
