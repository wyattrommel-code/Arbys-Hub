import test from 'node:test';
import assert from 'node:assert/strict';
import { captureJpegBlob, createDetectorCache, createDetectorWithFallback } from '../lib/face-detect.js';
import { createWorkerDetector } from '../lib/face-detect-worker-client.js';
import { loadFaceAsset } from '../lib/face-detect-assets.js';

test('camera captures the whole frame, caps upload size and rejects unready video', async t => {
  const original=globalThis.document; t.after(()=>{globalThis.document=original;});
  let canvas, drawn, quality;
  globalThis.document={createElement:()=>canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>{drawn=args;}}),toBlob:(callback,type,q)=>{quality=q;callback(new Blob(['synthetic'],{type}));}}};
  const video={videoWidth:1920,videoHeight:1080,readyState:2};
  const photo=await captureJpegBlob(video);
  assert.deepEqual([canvas.width,canvas.height],[720,405]);
  assert.deepEqual(drawn,[video,0,0,720,405]);
  assert.equal(photo.type,'image/jpeg'); assert.equal(quality,0.72);
  await captureJpegBlob({videoWidth:720,videoHeight:1280,readyState:2});
  assert.deepEqual([canvas.width,canvas.height],[405,720]);
  await captureJpegBlob({videoWidth:640,videoHeight:480,readyState:2});
  assert.deepEqual([canvas.width,canvas.height],[640,480]);
  await assert.rejects(captureJpegBlob({videoWidth:0,videoHeight:0,readyState:0}),/not ready/);
});

test('camera reuses one permission request, pauses between retakes and stops on release',async()=>{
  const {createClockCamera}=await import('../lib/clock-camera.js');
  let requests=0,idle,resolveStream;
  const track={enabled:true,readyState:'live',stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const camera=createClockCamera(()=>{requests++;return new Promise(resolve=>{resolveStream=resolve;});},callback=>{idle=callback;return 1;},()=>{idle=null;});
  const first=camera.acquire();first.release();const second=camera.acquire();
  await Promise.resolve();assert.equal(requests,1);resolveStream(stream);await first.ready;await second.ready;
  assert.equal(track.enabled,true);second.release();assert.equal(track.enabled,false);assert.equal(track.readyState,'live');
  const retake=camera.acquire();assert.equal(await retake.ready,stream);assert.equal(requests,1);assert.equal(track.enabled,true);
  retake.release();idle();assert.equal(track.readyState,'ended');
  const after=camera.acquire();await Promise.resolve();assert.equal(requests,2);
  camera.close();const late={...track,readyState:'live'};resolveStream({getTracks:()=>[late],getVideoTracks:()=>[late]});
  await assert.rejects(after.ready,/paused/);assert.equal(late.readyState,'ended');
});

test('face worker transfers one frame, matches replies and stays off the photo capture path',async t=>{
  let request, transferred, stopped=false, bitmapClosed=false;
  const bitmap={close(){bitmapClosed=true;}};
  const worker={postMessage(message,list){request=message;transferred=list;},terminate(){stopped=true;}};
  const detector=createWorkerDetector(worker,async()=>bitmap);t.after(()=>detector.close());
  assert.deepEqual(await detector.detect({}),[],'Loading the model must never hold a frame');
  worker.onmessage({data:{type:'ready'}});await detector.ready;
  const detection=detector.detect({});await Promise.resolve();
  assert.deepEqual(await detector.detect({}),[],'Do not queue frames behind slow inference');
  assert.equal(request.type,'detect');assert.deepEqual(transferred,[bitmap]);
  worker.onmessage({data:{type:'result',id:request.id+1,boxes:[{x:0.1,y:0.2,width:0.3,height:0.4}]}});
  assert.deepEqual(await detector.detect({}),[],'An unrelated reply cannot release the pending frame');
  worker.onmessage({data:{type:'result',id:request.id,boxes:[{x:0.1,y:0.2,width:0.3,height:0.4}]}});
  assert.deepEqual(await detection,[{x:0.1,y:0.2,width:0.3,height:0.4}]);assert.equal(bitmapClosed,false,'The receiving worker owns the transferred bitmap');
  const pending=detector.detect({});await Promise.resolve();worker.onerror();
  assert.deepEqual(await pending,[]);assert.equal(stopped,true);
  assert.deepEqual(await detector.detect({}),[]);
});

test('closing the detector releases a bitmap still being prepared and a failed model cannot stall the camera',async()=>{
  let finishBitmap,closed=0;
  const worker={postMessage(){assert.fail('Must not send after close');},terminate(){}};
  const detector=createWorkerDetector(worker,()=>new Promise(resolve=>{finishBitmap=resolve;}));
  worker.onmessage({data:{type:'ready'}});
  const pending=detector.detect({});detector.close();
  finishBitmap({close(){closed++;}});assert.deepEqual(await pending,[]);assert.equal(closed,1);
  const failed={terminate(){}};
  const unavailable=createWorkerDetector(failed,async()=>{});
  failed.onmessage({data:{type:'unavailable'}});await unavailable.ready;
  assert.deepEqual(await unavailable.detect({}),[]);
});

test('native and worker face boxes align at any inference resolution and reject invalid bounds',async()=>{
  const {normalizeFaceBoxes}=await import('../lib/face-capture.js');
  const native=normalizeFaceBoxes([{boundingBox:{x:32,y:48,width:64,height:96}}],320,240);
  const worker=normalizeFaceBoxes([{boundingBox:{originX:64,originY:96,width:128,height:192}}],640,480);
  assert.deepEqual(native,[{x:0.1,y:0.2,width:0.2,height:0.4}]);
  assert.deepEqual(worker,native);
  assert.deepEqual(normalizeFaceBoxes([{boundingBox:{x:-10,y:20,width:30,height:100}}],100,100),
    [{x:0,y:0.2,width:0.2,height:0.8}]);
  for(const box of [{x:NaN,y:0,width:10,height:10},{x:0,y:0,width:0,height:10},{x:400,y:0,width:10,height:10}]) {
    assert.deepEqual(normalizeFaceBoxes([{boundingBox:box}],320,240),[]);
  }
  assert.deepEqual(normalizeFaceBoxes([{}],320,240),[]);
  assert.deepEqual(normalizeFaceBoxes([],0,0),[]);
});

test('auto capture and manual taps cannot double-submit or retry a failed save automatically',async()=>{
  const {createFaceCaptureGate}=await import('../lib/face-capture.js');
  const gate=createFaceCaptureGate(), automatic={automatic:true,ready:true,busy:false,visible:true};
  assert.equal(gate.start({...automatic,ready:false}),false);
  assert.equal(gate.start({...automatic,busy:true}),false);
  assert.equal(gate.start({...automatic,visible:false}),false);
  assert.equal(gate.start(automatic),true);
  assert.equal(gate.start(automatic),false);
  assert.equal(gate.start({...automatic,automatic:false}),false,'Manual tap while saving cannot submit twice');
  gate.finish();
  assert.equal(gate.start(automatic),false,'A rejected or slow server response never triggers automatic retries');
  assert.equal(gate.start({...automatic,automatic:false}),true,'Explicit retry remains available');
  gate.finish();
  const manualFirst=createFaceCaptureGate();
  assert.equal(manualFirst.start({...automatic,automatic:false}),true);
  manualFirst.finish();
  assert.equal(manualFirst.start(automatic),false,'Late detection cannot repeat a manual photo');
});

test('stale or absent faces never authorize automatic capture or face metadata',async()=>{
  const {isFreshFace}=await import('../lib/face-capture.js');
  const boxes=[{x:0.1,y:0.2,width:0.3,height:0.4}];
  assert.equal(isFreshFace({boxes,at:100},150),true);
  assert.equal(isFreshFace({boxes,at:100},1100),false);
  assert.equal(isFreshFace({boxes,at:200},100),false);
  assert.equal(isFreshFace({boxes:[],at:100},150),false);
});

test('automatic capture requires a full, steady face across fresh frames', async () => {
  const { createStableFaceTracker } = await import('../lib/face-capture.js');
  const tracker = createStableFaceTracker();
  const box = { x: 0.3, y: 0.2, width: 0.3, height: 0.4 };
  const sample = (at, boxes = [box], now = at + 20) => tracker.update({ boxes, at }, now);
  assert.equal(sample(100), false, 'Never capture on the first detection');
  assert.equal(sample(280), false);
  assert.equal(sample(460, [{ ...box, x: 0.31 }]), true, 'Small natural movement is fine');
  assert.equal(sample(640, []), false, 'Losing the face resets the hold');
  assert.equal(sample(820), false);
  assert.equal(sample(1000), false);
  assert.equal(sample(1180, [{ ...box, x: 0.6 }]), false, 'Moving to another face resets the hold');
  for (const invalid of [{ ...box, x: 0 }, { ...box, y: 0.8 }, { ...box, width: 0.05 }, { ...box, height: 0.05 }]) {
    tracker.reset();
    for (const at of [100, 300, 500, 700]) assert.equal(sample(at, [invalid]), false, 'Clipped and distant faces cannot trigger');
  }
  tracker.reset(); sample(100); sample(300);
  assert.equal(sample(500, [box], 1600), false, 'Slow inference cannot approve an old frame');
  assert.equal(sample(1700), false);
  assert.equal(sample(1900), false);
  assert.equal(sample(2100), true);
  assert.equal(sample(3200), false, 'A long gap requires a new steady sequence');
  tracker.reset(); sample(100); sample(300);
  assert.equal(sample(300), false, 'Repeated replies are not new observations');
});

test('detector cache shares warm-up but recovers from failed startup and later worker failure', async () => {
  let calls = 0;
  const detectors = [
    { ready: Promise.resolve(false), closed: true },
    { ready: Promise.resolve(true), closed: false },
    { ready: Promise.resolve(true), closed: false },
  ];
  const get = createDetectorCache(() => detectors[calls++]);
  const first = get();
  assert.equal(get(), first, 'Concurrent warm-up requests share a worker');
  assert.equal(await (await first).ready, false);
  const recovered = await get();
  assert.equal(recovered, detectors[1]);
  assert.equal(await get(), recovered);
  recovered.closed = true;
  assert.equal(await get(), detectors[2]);
  assert.equal(calls, 3);

  let attempts = 0;
  const retry = createDetectorCache(() => { if (!attempts++) throw new Error('Startup failed'); return recovered; });
  await assert.rejects(retry(), /Startup failed/);
  assert.equal(await retry(), recovered);
});

test('slow first inference can warm up without disabling subsequent automatic detection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let request, stopped = false;
  const worker = { postMessage(message) { request = message; }, terminate() { stopped = true; } };
  const detector = createWorkerDetector(worker, async () => ({ close() {} }));
  t.after(() => detector.close());
  worker.onmessage({ data: { type: 'ready' } });
  const first = detector.detect({}); await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.equal(detector.closed, false, 'Initial WASM setup gets time to finish');
  worker.onmessage({ data: { type: 'result', id: request.id, boxes: [] } });
  await first;
  const stalled = detector.detect({}); await Promise.resolve();
  t.mock.timers.tick(2000);
  assert.deepEqual(await stalled, []);
  assert.equal(detector.closed, true, 'A stalled warmed worker is released for recovery');
  assert.equal(stopped, true);
});

test('public face detector assets load from their cache after the internet drops', async t => {
  const originalCaches = globalThis.caches, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.caches = originalCaches; globalThis.fetch = originalFetch; });
  const stored = new Map(); let requests = 0;
  globalThis.caches = { open: async name => {
    assert.equal(name, 'arbys-clock-face-assets-v1');
    return { match: async url => stored.get(url)?.clone(), put: async (url, response) => stored.set(url, response) };
  } };
  globalThis.fetch = async (_url, options) => { requests++; assert.equal(options.credentials, 'omit'); return new Response('public detector file'); };
  const url = 'https://cdn.example.test/face.wasm';
  assert.equal(await (await loadFaceAsset(url)).text(), 'public detector file');
  globalThis.fetch = async () => { throw new Error('Offline'); };
  assert.equal(await (await loadFaceAsset(url)).text(), 'public detector file');
  assert.equal(requests, 1);
  await assert.rejects(loadFaceAsset('https://cdn.example.test/not-prepared.wasm'), /Offline/);
  globalThis.caches = { open: async () => { throw new Error('Storage unavailable'); } };
  globalThis.fetch = async () => new Response('online fallback');
  assert.equal(await (await loadFaceAsset(url)).text(), 'online fallback');
  globalThis.fetch = async () => new Response('failed', { status: 503 });
  await assert.rejects(loadFaceAsset(url), /Could not load/);
});

test('face detection falls back when worker startup is unsupported, rejected, or times out', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const browser = { type: 'browser', ready: Promise.resolve(true) };
  let browserStarts = 0;
  const fallback = () => { browserStarts++; return browser; };
  const healthy = { ready: Promise.resolve(true), closed: false };
  assert.equal(await createDetectorWithFallback(() => healthy, fallback), healthy);
  assert.equal(browserStarts, 0, 'Working workers stay off the UI thread');
  assert.equal(await createDetectorWithFallback(null, fallback), browser);
  assert.equal(await createDetectorWithFallback(() => { throw new Error('Worker unsupported'); }, fallback), browser);
  let closed = 0;
  assert.equal(await createDetectorWithFallback(() => ({ ready: Promise.resolve(false), close() { closed++; } }), fallback), browser);
  assert.equal(closed, 1);
  assert.equal(await createDetectorWithFallback(() => ({ ready: Promise.reject(new Error('Canvas unsupported')), close() { closed++; } }), fallback), browser);
  assert.equal(closed, 2);
  const worker = createWorkerDetector({ terminate() { closed++; } }, async () => ({ close() {} }));
  const pending = createDetectorWithFallback(() => worker, fallback);
  await Promise.resolve(); t.mock.timers.tick(15000);
  assert.equal(await pending, browser);
  assert.equal(closed, 3, 'Timed-out worker is released before fallback');
  await assert.rejects(createDetectorWithFallback(null, () => { throw new Error('No detector'); }), /No detector/,
    'If both paths fail, never return fake face detections or enable capture');
});
