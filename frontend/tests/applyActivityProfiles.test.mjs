import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/modules/fourD/applyActivityProfiles.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' })
const { applyActivityProfiles } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const targets = [{ id: 'a', animation_profile_id: null }]
const failedResponse = async () => { throw new Error('Response lost after commit') }

test('lost response is successful when reload confirms the profile was saved', async () => {
  await applyActivityProfiles(targets, 'profile', failedResponse, async () => [{ id: 'a', animation_profile_id: 'profile' }])
})
test('clearing to Default is confirmed even when the response fails', async () => {
  await applyActivityProfiles([{ id: 'a', animation_profile_id: 'profile' }], null, failedResponse, async () => targets)
})
test('mixed batch counts only changes still unconfirmed by reload', async () => {
  await assert.rejects(applyActivityProfiles([...targets, { id: 'b', animation_profile_id: null }], 'profile', failedResponse,
    async () => [{ id: 'a', animation_profile_id: 'profile' }, { id: 'b', animation_profile_id: null }]), /1 of 2/)
})
test('successful save and failed reload is reported as a refresh problem', async () => {
  await assert.rejects(applyActivityProfiles(targets, 'profile', async () => {}, failedResponse), /Profiles saved, but the schedule could not refresh/)
})
test('failed response and missing reload never claim success or definite failure', async () => {
  await assert.rejects(applyActivityProfiles(targets, 'profile', failedResponse, async () => undefined), /Could not confirm/)
})
