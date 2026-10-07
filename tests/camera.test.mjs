import test from 'node:test';
import assert from 'node:assert/strict';
import { captureJpegBlob } from '../lib/face-detect.js';
import { createWorkerDetector } from '../lib/face-detect-worker-client.js';

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
  assert.equal(await detector.detect({}),false,'Loading the model must never hold a frame');
  worker.onmessage({data:{type:'ready'}});await detector.ready;
  const detection=detector.detect({});await Promise.resolve();
  assert.equal(await detector.detect({}),false,'Do not queue frames behind slow inference');
  assert.equal(request.type,'detect');assert.deepEqual(transferred,[bitmap]);
  worker.onmessage({data:{type:'result',id:request.id+1,found:true}});
  assert.equal(await detector.detect({}),false,'An unrelated reply cannot release the pending frame');
  worker.onmessage({data:{type:'result',id:request.id,found:true}});
  assert.equal(await detection,true);assert.equal(bitmapClosed,false,'The receiving worker owns the transferred bitmap');
  const pending=detector.detect({});await Promise.resolve();worker.onerror();
  assert.equal(await pending,false);assert.equal(stopped,true);
  assert.equal(await detector.detect({}),false);
});

test('closing the detector releases a bitmap still being prepared and a failed model cannot stall the camera',async()=>{
  let finishBitmap,closed=0;
  const worker={postMessage(){assert.fail('Must not send after close');},terminate(){}};
  const detector=createWorkerDetector(worker,()=>new Promise(resolve=>{finishBitmap=resolve;}));
  worker.onmessage({data:{type:'ready'}});
  const pending=detector.detect({});detector.close();
  finishBitmap({close(){closed++;}});assert.equal(await pending,false);assert.equal(closed,1);
  const failed={terminate(){}};
  const unavailable=createWorkerDetector(failed,async()=>{});
  failed.onmessage({data:{type:'unavailable'}});await unavailable.ready;
  assert.equal(await unavailable.detect({}),false);
});
