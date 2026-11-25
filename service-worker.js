/* Recolleat Build 4.45 — offline-first, versioned, update-safe. */
const CACHE='recolleat-mobile-v4-45-connected-1';
const CRITICAL=['./','./index.html','./recolleat-v4-45.css','./recolleat-v4-45.js','./account-config.js','./accounts.js','./places-config.js','./places.js','./manifest.webmanifest','./manifest.webmanifest?v=4.45','./privacy.html','./terms.html','./icon-192.png','./icon-512.png','./icon-192.png?v=3.3','./icon-512.png?v=3.3'];
const OPTIONAL=['./icon-maskable-512.png','./icon-maskable-512.png?v=3.3','./apple-touch-icon.png','./install-check.html','./recolleat-release.txt'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // Do not install a partial app shell. Failure leaves the old worker active.
 await cache.addAll(CRITICAL);
 await Promise.all(OPTIONAL.map(async path=>{try{await cache.add(path)}catch(e){console.warn('Optional cache asset failed',path,e)}}));
})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k.startsWith('recolleat-')&&k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const u=new URL(req.url);if(u.origin!==self.location.origin)return;
 // Files used to create the app are fetched fresh when online. A versioned
 // cached fallback keeps the installed app available when offline.
 const appAsset=req.mode==='navigate'||/\.(?:html|js|css|webmanifest|txt)$/.test(u.pathname);
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  if(appAsset){
   try{const response=await fetch(req,{cache:'no-store'});
    if(response.ok)await cache.put(req,response.clone());
    return response;
   }catch{return await cache.match(req)||(req.mode==='navigate'?await cache.match('./index.html'):null)||Response.error()}
  }
  const cached=await cache.match(req);if(cached)return cached;
  try{const response=await fetch(req);
   if(response.ok)cache.put(req,response.clone()).catch(()=>{});
   return response;
  }catch{return Response.error()}
 })());
});
