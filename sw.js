import { BareClient } from '@mercuryworkshop/bare-mux';

const SW_VERSION = "6.0-BareMux";
const BARE_ROUTE_MARKER = "/__bare/";

// Instancia el cliente que se comunicará automáticamente con el backend 
// a través del túnel Epoxy configurado en el hilo principal.
const bareClient = new BareClient();

self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Interceptar solo las solicitudes marcadas para el proxy
    if (url.pathname.startsWith(BARE_ROUTE_MARKER)) {
        event.respondWith((async () => {
            try {
                // Extraer la URL destino real
                const targetUrl = url.pathname.slice(BARE_ROUTE_MARKER.length) + url.search;
                
                // bareClient.fetch empaqueta la solicitud y la envía a través
                // del WebWorker de bare-mux (usando Epoxy y WSS). 
                // Securly solo verá tráfico encriptado hacia tu servidor WSS.
                const proxyResponse = await bareClient.fetch(targetUrl, {
                    method: event.request.method,
                    headers: event.request.headers,
                    body: event.request.body
                });

                return proxyResponse;
            } catch (error) {
                return new Response(JSON.stringify({
                    error: "Fallo en el túnel Bare",
                    detail: error.message
                }), { status: 502 });
            }
        })());
    }
});
