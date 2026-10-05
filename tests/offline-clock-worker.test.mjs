import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('worker prepares a complete shell, deduplicates assets and never caches APIs or Hub pages',async()=>{
  const handlers={},stored=new Map();let added=[],ready,network=true,wait;
  const cache={addAll:async paths=>{assert.equal(new Set(paths).size,paths.length);added=paths;},put:async(key,value)=>stored.set(key,value),match:async key=>stored.get(key)};
  const context={self:{location:{origin:'https://clock.invalid'},addEventListener:(name,fn)=>handlers[name]=fn},URL,Response,AbortController,setTimeout,clearTimeout,
    caches:{open:async()=>cache,match:async key=>stored.get(key)},fetch:async()=>{if(!network)throw new Error('Offline');return new Response('<script src="/_next/static/clock.js"></script><link rel="stylesheet" href="/_next/static/clock.css">',{headers:{'content-type':'text/html'}});}};
  vm.runInNewContext(await readFile(new URL('../public/clock-sw.js',import.meta.url),'utf8'),context);
  handlers.message({data:{type:'PREPARE_CLOCK',assets:['https://clock.invalid/_next/static/clock.js','https://other.invalid/private.js','/api/clock/roster']},ports:[{postMessage:value=>ready=value.ready}],waitUntil:promise=>wait=promise});await wait;
  assert.equal(ready,true);assert.deepEqual(Array.from(added),['https://clock.invalid/_next/static/clock.js','https://clock.invalid/_next/static/clock.css']);
  for(const path of ['/api/clock/roster','/api/photos/punch-photos/payson/photo.jpg','/timeclock/timecards']){
    handlers.fetch({request:{method:'GET',url:'https://clock.invalid'+path,mode:'navigate'},respondWith:()=>assert.fail('Private routes must remain network only')});
  }
  network=false;let response;
  handlers.fetch({request:{method:'GET',url:'https://clock.invalid/clock',mode:'navigate'},respondWith:promise=>response=promise});
  assert.match(await (await response).text(),/clock.js/);
});
