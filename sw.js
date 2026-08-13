const BUILD='20260813.2';
const CACHE=`rectify-${BUILD}`;
const versioned=path=>`${path}?v=${BUILD}`;
const INDEX=versioned('index.html');
const ASSETS=[
  INDEX,versioned('styles.css'),versioned('fast-detector.js'),versioned('detector.js'),
  versioned('detector-worker.js'),versioned('model-detector.js'),versioned('ort.wasm.min.js'),
  versioned('ort-wasm-simd-threaded.mjs'),versioned('ort-wasm-simd-threaded.wasm'),
  versioned('docaligner-lcnet100.onnx'),versioned('app.js'),versioned('manifest.webmanifest'),
  versioned('icon.svg'),versioned('icon-192.png'),versioned('icon-512.png'),versioned('version.json')
];

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(ASSETS.map(async path=>{
    const request=new Request(new URL(path,self.registration.scope),{cache:'reload'});
    const response=await fetch(request);
    if(!response.ok)throw new Error(`Failed to cache ${path}`);
    await cache.put(request,response);
  }));
  await self.skipWaiting();
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.pathname.endsWith('/version.json')){
    event.respondWith(fetch(new Request(event.request,{cache:'no-store'})));
    return;
  }
  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(new Request(event.request,{cache:'no-store'}));
        if(response.ok)await (await caches.open(CACHE)).put(new Request(new URL(INDEX,self.registration.scope)),response.clone());
        return response;
      }catch{return (await caches.open(CACHE)).match(new Request(new URL(INDEX,self.registration.scope)));}
    })());
    return;
  }
  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    if(cached)return cached;
    const response=await fetch(new Request(event.request,{cache:'reload'}));
    if(response.ok&&url.origin===self.location.origin)await (await caches.open(CACHE)).put(event.request,response.clone());
    return response;
  })());
});
