// Se ejecuta cuando Chrome instala el Service Worker.
self.addEventListener("install", () => {
    // Activarlo inmediatamente para el laboratorio.
    self.skipWaiting();
});

// Tomar control de las páginas abiertas del mismo scope.
self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

// Interceptar solicitudes realizadas por nuestra aplicación.
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Endpoint virtual de laboratorio.
    if (url.pathname.endsWith("/lab-message")) {
        event.respondWith(
            new Response(
                JSON.stringify({
                    source: "service-worker",
                    message: "Esta respuesta fue creada por sw.js",
                    requestedUrl: event.request.url
                }),
                {
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            )
        );
    }
});
