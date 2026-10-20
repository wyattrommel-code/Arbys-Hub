/* global self, caches */
// Public app assets only. Employee data and photos live in the private device queue.
const CACHE='arbys-clock-shell-v1';
const localAsset=url=>url.origin===self.location.origin && url.pathname.startsWith('/_next/static/');
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('message',event=>{
  if(event.data?.type!=='PREPARE_CLOCK')return;
  event.waitUntil((async()=>{
    try{
      const cache=await caches.open(CACHE);
      const response=await fetch('/clock',{cache:'no-store'});
      if(!response.ok || !response.headers.get('content-type')?.includes('text/html'))throw new Error('Clock unavailable');
      const html=await response.clone().text();
      const paths=[...new Set([...(event.data.assets || []),...Array.from(html.matchAll(/(?:src|href)="(\/_next\/static\/[^"<>]+)"/g),match=>match[1])]
        .map(path=>new URL(path,self.location.origin)).filter(localAsset).map(url=>url.href))];
      await cache.addAll(paths);
      await cache.put('/clock',response);
      event.ports[0]?.postMessage({ready:true});
    }catch{const cached=await caches.match('/clock',{cacheName:CACHE});event.ports[0]?.postMessage({ready:!!cached});}
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/'))return;
  if(localAsset(url)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE),cached=await cache.match(request);
      if(cached)return cached;
      const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;
    })());return;
  }
  if(request.mode==='navigate' && ['/', '/clock'].includes(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
      try{const response=await fetch(request,{signal:controller.signal});if(response.ok)return response;}catch{/* Use the last fully prepared shell. */}finally{clearTimeout(timer);}
      return (await cache.match('/clock')) || new Response('Reconnect this iPad once to prepare the time clock.',{status:503,headers:{'Content-Type':'text/plain'}});
    })());
  }
});
