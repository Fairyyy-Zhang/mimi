self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()))
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()))
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate') event.respondWith(fetch(event.request).catch(()=>new Response('<meta charset=utf-8><meta name=viewport content="width=device-width"><title>Mimi</title><h1>Mimi 暂时离线</h1><p>重新联网后，可以继续查看计划。</p><a href="/">重新连接</a>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})))
})
