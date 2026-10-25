import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
for(const channel of ['stable','preview'])test(`${channel} release page identifies its channel and package versions`,async()=>{
 const {outputFiles}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server.browser';import {PlannerReleases} from './src/components/PlannerReleases';import {PLANNER_VERSION} from './src/lib/releases';export const version=PLANNER_VERSION;export const html=renderToStaticMarkup(React.createElement(PlannerReleases,{onSignIn(){}}));`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env.VITE_RELEASE_CHANNEL':JSON.stringify(channel)}})
 const {html,version}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
 if(channel==='preview'){assert.match(html,/DEVELOPMENT PREVIEW/);assert.match(html,/Open Preview Web/);assert.match(html,/0\.2\.42-preview\.1/);assert.match(html,/same character and motion-import improvements/);assert.equal(version,'0.2.42-preview.1');assert.doesNotMatch(html,/STABLE RELEASES/)}
 else{assert.match(html,/STABLE RELEASES/);assert.match(html,/Open Stable Web/);assert.doesNotMatch(html,/Open Preview Web/);assert.equal(version,'0.2.41')}
})


