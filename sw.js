// Versión y capacidades visibles para que las páginas del laboratorio puedan
// comprobar qué Service Worker está activo sin romper fases anteriores.
const SW_VERSION = "5C";
const SW_FEATURES = ["lab-message", "5B", "5C"];
const LAB_ROUTE_MARKER = "/__lab_route__/";
const LAB_TRANSPORT_MARKER = "/__lab_transport__/";

// Fase 5C: puerto efímero hacia el transport adapter de una página controlada.
// No existe aquí ningún WebSocket ni fetch hacia destinos lógicos.
let transportPort = null;
let nextTransportRequestId = 1;
const pendingTransportRequests = new Map();

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

function base64UrlToText(encoded) {
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

function describeWorker() {
    return {
        source: "service-worker",
        swVersion: SW_VERSION,
        swFeatures: SW_FEATURES
    };
}

// La página de 5C entrega un MessagePort al SW. El WebSocket permanece en la
// página; el SW solo envía/recibe mensajes estructurados por este puerto.
self.addEventListener("message", (event) => {
    if (event.data?.type !== "register-5c-transport") return;

    const port = event.ports?.[0];
    if (!port) return;

    if (transportPort) {
        try {
            transportPort.close();
        } catch (_) {
            // El puerto anterior puede estar ya cerrado.
        }
    }

    transportPort = port;

    transportPort.onmessage = (messageEvent) => {
        const message = messageEvent.data;

        if (message?.type !== "5c-transport-response") return;

        const pending = pendingTransportRequests.get(message.id);
        if (!pending) return;

        clearTimeout(pending.timeoutId);
        pendingTransportRequests.delete(message.id);
        pending.resolve(message);
    };

    transportPort.start();
    transportPort.postMessage({
        type: "5c-transport-registered",
        swVersion: SW_VERSION,
        swFeatures: SW_FEATURES
    });
});

async function requestViaLabTransport(logicalUrl, method) {
    if (!transportPort) {
        throw new Error("No hay transport adapter 5C registrado.");
    }

    const id = nextTransportRequestId++;

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingTransportRequests.delete(id);
            reject(new Error("Timeout esperando al transport adapter 5C."));
        }, 9000);

        pendingTransportRequests.set(id, {
            resolve,
            reject,
            timeoutId
        });

        transportPort.postMessage({
            type: "5c-transport-request",
            id,
            method,
            logicalUrl
        });
    });
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Endpoint virtual original del laboratorio.
    if (url.pathname.endsWith("/lab-message")) {
        event.respondWith(
            jsonResponse({
                ...describeWorker(),
                message: "Esta respuesta fue creada por sw.js",
                requestedUrl: event.request.url
            })
        );
        return;
    }

    // Fase 5C: misma idea de rewriting que 5B, pero ahora la URL lógica se
    // entrega a un transport adapter de laboratorio mediante MessageChannel.
    const transportIndex = url.pathname.indexOf(LAB_TRANSPORT_MARKER);

    if (transportIndex !== -1) {
        event.respondWith((async () => {
            const encoded = url.pathname.slice(
                transportIndex + LAB_TRANSPORT_MARKER.length
            );

            if (event.request.method !== "GET") {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    transported: false,
                    remoteDestinationContacted: false,
                    error: "La Fase 5C solo acepta GET."
                }, 405);
            }

            if (!encoded) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    transported: false,
                    remoteDestinationContacted: false,
                    error: "Falta la URL codificada."
                }, 400);
            }

            try {
                const logicalUrl = base64UrlToText(encoded);
                const parsedLogical = new URL(logicalUrl);

                // Mantener 5C como experimento de destino fijo. No es un relay
                // seleccionable y el adapter tampoco abre esta URL.
                const allowedLogicalUrl = "https://demo.invalid/img/logo.png";

                if (logicalUrl !== allowedLogicalUrl) {
                    return jsonResponse({
                        ...describeWorker(),
                        intercepted: true,
                        transported: false,
                        remoteDestinationContacted: false,
                        error: "La Fase 5C solo permite su URL lógica fija de laboratorio."
                    }, 403);
                }

                const transportResult = await requestViaLabTransport(
                    logicalUrl,
                    event.request.method
                );

                if (!transportResult.ok) {
                    return jsonResponse({
                        ...describeWorker(),
                        intercepted: true,
                        logicalUrl,
                        logicalHost: parsedLogical.host,
                        transported: true,
                        remoteDestinationContacted: false,
                        syntheticResponse: true,
                        error: transportResult.error || "El adapter reportó un error."
                    }, 502);
                }

                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    requestedUrl: event.request.url,
                    browserVisibleHost: url.host,
                    logicalUrl,
                    logicalHost: parsedLogical.host,
                    method: event.request.method,
                    transport: {
                        adapter: "page-message-channel",
                        endpoint: transportResult.endpoint,
                        websocketEchoVerified: transportResult.echoVerified === true,
                        requestId: transportResult.id
                    },
                    transported: true,
                    remoteDestinationContacted: false,
                    syntheticResponse: true,
                    message: "El SW delegó una solicitud lógica fija al adapter 5C y recibió un eco; ningún destino lógico fue contactado."
                });
            } catch (error) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    transported: false,
                    remoteDestinationContacted: false,
                    error: "No se pudo completar la ruta de transporte 5C.",
                    detail: error.message
                }, 500);
            }
        })());
        return;
    }

    // Fase 5B: conservar la respuesta sintética local.
    const markerIndex = url.pathname.indexOf(LAB_ROUTE_MARKER);

    if (markerIndex !== -1) {
        event.respondWith((async () => {
            const encoded = url.pathname.slice(
                markerIndex + LAB_ROUTE_MARKER.length
            );

            if (event.request.method !== "GET") {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    networkContacted: false,
                    error: "La Fase 5B solo acepta GET."
                }, 405);
            }

            if (!encoded) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    networkContacted: false,
                    error: "Falta la URL codificada."
                }, 400);
            }

            try {
                const originalUrl = base64UrlToText(encoded);
                const parsedOriginal = new URL(originalUrl);

                return jsonResponse({
                    ...describeWorker(),
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
                    ...describeWorker(),
                    intercepted: true,
                    networkContacted: false,
                    error: "No se pudo decodificar una URL válida.",
                    detail: error.message
                }, 400);
            }
        })());
    }
});
