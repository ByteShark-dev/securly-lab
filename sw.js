// Versión visible para que las páginas del laboratorio puedan comprobar
// qué Service Worker está activo.
const SW_VERSION = "5B";
const LAB_ROUTE_MARKER = "/__lab_route__/";

// Se ejecuta cuando Chrome instala el Service Worker.
self.addEventListener("install", () => {
    // Activarlo inmediatamente para el laboratorio.
    self.skipWaiting();
});

// Tomar control de las páginas abiertas del mismo scope.
self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

function base64UrlToText(encoded) {
    // Base64URL usa - y _ en lugar de + y /. Restauramos también el padding.
    let base64 = encoded
        .replaceAll("-", "+")
        .replaceAll("_", "/");

    while (base64.length % 4 !== 0) {
        base64 += "=";
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder().decode(bytes);
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

// Interceptar solicitudes realizadas por nuestra aplicación.
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Endpoint virtual original del laboratorio. Lo conservamos para no romper
    // las fases anteriores y añadimos la versión del SW como diagnóstico.
    if (url.pathname.endsWith("/lab-message")) {
        event.respondWith(
            jsonResponse({
                source: "service-worker",
                swVersion: SW_VERSION,
                message: "Esta respuesta fue creada por sw.js",
                requestedUrl: event.request.url
            })
        );
        return;
    }

    // Fase 5B: una URL reescrita entra al mismo origen de GitHub Pages.
    // El SW recupera la URL lógica original, pero NO la solicita a la red.
    const markerIndex = url.pathname.indexOf(LAB_ROUTE_MARKER);

    if (markerIndex !== -1) {
        event.respondWith((async () => {
            const encoded = url.pathname.slice(
                markerIndex + LAB_ROUTE_MARKER.length
            );

            if (event.request.method !== "GET") {
                return jsonResponse({
                    source: "service-worker",
                    swVersion: SW_VERSION,
                    intercepted: true,
                    networkContacted: false,
                    error: "La Fase 5B solo acepta GET."
                }, 405);
            }

            if (!encoded) {
                return jsonResponse({
                    source: "service-worker",
                    swVersion: SW_VERSION,
                    intercepted: true,
                    networkContacted: false,
                    error: "Falta la URL codificada."
                }, 400);
            }

            try {
                const originalUrl = base64UrlToText(encoded);
                const parsedOriginal = new URL(originalUrl);

                return jsonResponse({
                    source: "service-worker",
                    swVersion: SW_VERSION,
                    intercepted: true,
                    requestedUrl: event.request.url,
                    browserVisibleHost: url.host,
                    originalUrl,
                    originalHost: parsedOriginal.host,
                    method: event.request.method,
                    networkContacted: false,
                    syntheticResponse: true,
                    message: "La URL original fue decodificada, pero no se hizo ninguna petición hacia ella."
                });
            } catch (error) {
                return jsonResponse({
                    source: "service-worker",
                    swVersion: SW_VERSION,
                    intercepted: true,
                    networkContacted: false,
                    error: "No se pudo decodificar una URL válida.",
                    detail: error.message
                }, 400);
            }
        })());
    }
});
