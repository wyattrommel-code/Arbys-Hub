import test from 'node:test';
import assert from 'node:assert/strict';
import { captureJpegBlob } from '../lib/face-detect.js';

test('camera captures the whole frame, caps upload size and rejects unready video', async t => {
  const original=globalThis.document; t.after(()=>{globalThis.document=original;});
  let canvas, drawn, quality;
  globalThis.document={createElement:()=>canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>{drawn=args;}}),toBlob:(callback,type,q)=>{quality=q;callback(new Blob(['synthetic'],{type}));}}};
  const video={videoWidth:1920,videoHeight:1080,readyState:2};
  const photo=await captureJpegBlob(video);
  assert.deepEqual([canvas.width,canvas.height],[960,540]);
  assert.deepEqual(drawn,[video,0,0,960,540]);
  assert.equal(photo.type,'image/jpeg'); assert.equal(quality,0.78);
  await captureJpegBlob({videoWidth:720,videoHeight:1280,readyState:2});
  assert.deepEqual([canvas.width,canvas.height],[540,960]);
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
