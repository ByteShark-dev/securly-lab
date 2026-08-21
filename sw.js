// Versión y capacidades visibles para que las páginas del laboratorio puedan
// comprobar qué Service Worker está activo sin romper fases anteriores.
const SW_VERSION = "5D";
const SW_FEATURES = ["lab-message", "5B", "5C", "5D"];
const LAB_ROUTE_MARKER = "/__lab_route__/";
const LAB_TRANSPORT_MARKER = "/__lab_transport__/";
const LAB_WISP_MARKER = "/__lab_wisp__/";
const FIXED_LOGICAL_URL = "https://demo.invalid/img/logo.png";

// Fase 5C: puerto efímero hacia el transport adapter de una página controlada.
let transportPort = null;
let nextTransportRequestId = 1;
const pendingTransportRequests = new Map();

// Fase 5D: puerto separado hacia el adapter que construye y valida frames Wisp.
let wispPort = null;
let nextWispRequestId = 1;
const pendingWispRequests = new Map();

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

function base64UrlToText(encoded) {
    let base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    while (base64.length % 4 !== 0) base64 += "=";

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
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

function replacePort(currentPort, nextPort) {
    if (currentPort) {
        try { currentPort.close(); } catch (_) {}
    }
    return nextPort;
}

self.addEventListener("message", (event) => {
    const type = event.data?.type;
    const port = event.ports?.[0];
    if (!port) return;

    if (type === "register-5c-transport") {
        transportPort = replacePort(transportPort, port);

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
        return;
    }

    if (type === "register-5d-wisp-transport") {
        wispPort = replacePort(wispPort, port);

        wispPort.onmessage = (messageEvent) => {
            const message = messageEvent.data;
            if (message?.type !== "5d-wisp-response") return;

            const pending = pendingWispRequests.get(message.id);
            if (!pending) return;

            clearTimeout(pending.timeoutId);
            pendingWispRequests.delete(message.id);
            pending.resolve(message);
        };

        wispPort.start();
        wispPort.postMessage({
            type: "5d-wisp-registered",
            swVersion: SW_VERSION,
            swFeatures: SW_FEATURES
        });
    }
});

async function requestViaLabTransport(logicalUrl, method) {
    if (!transportPort) throw new Error("No hay transport adapter 5C registrado.");

    const id = nextTransportRequestId++;
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingTransportRequests.delete(id);
            reject(new Error("Timeout esperando al transport adapter 5C."));
        }, 9000);

        pendingTransportRequests.set(id, { resolve, reject, timeoutId });
        transportPort.postMessage({
            type: "5c-transport-request",
            id,
            method,
            logicalUrl
        });
    });
}

async function requestViaWispLab(logicalUrl, method) {
    if (!wispPort) throw new Error("No hay Wisp adapter 5D registrado.");

    const id = nextWispRequestId++;
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingWispRequests.delete(id);
            reject(new Error("Timeout esperando al Wisp adapter 5D."));
        }, 12000);

        pendingWispRequests.set(id, { resolve, reject, timeoutId });
        wispPort.postMessage({
            type: "5d-wisp-request",
            id,
            method,
            logicalUrl
        });
    });
}

function extractEncoded(url, marker) {
    const index = url.pathname.indexOf(marker);
    if (index === -1) return null;
    return url.pathname.slice(index + marker.length);
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    if (url.pathname.endsWith("/lab-message")) {
        event.respondWith(jsonResponse({
            ...describeWorker(),
            message: "Esta respuesta fue creada por sw.js",
            requestedUrl: event.request.url
        }));
        return;
    }

    // Fase 5D: el SW solo recupera la URL lógica y delega la representación Wisp
    // a una página controlada. El SW NO abre sockets al hostname lógico.
    const wispEncoded = extractEncoded(url, LAB_WISP_MARKER);
    if (wispEncoded !== null) {
        event.respondWith((async () => {
            if (event.request.method !== "GET") {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    wispTransported: false,
                    remoteDestinationContacted: false,
                    error: "La Fase 5D solo acepta GET."
                }, 405);
            }

            if (!wispEncoded) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    wispTransported: false,
                    remoteDestinationContacted: false,
                    error: "Falta la URL codificada para 5D."
                }, 400);
            }

            try {
                const logicalUrl = base64UrlToText(wispEncoded);
                const parsedLogical = new URL(logicalUrl);

                if (logicalUrl !== FIXED_LOGICAL_URL) {
                    return jsonResponse({
                        ...describeWorker(),
                        intercepted: true,
                        wispTransported: false,
                        remoteDestinationContacted: false,
                        error: "La Fase 5D solo permite su URL lógica fija de laboratorio."
                    }, 403);
                }

                const wispResult = await requestViaWispLab(
                    logicalUrl,
                    event.request.method
                );

                if (!wispResult.ok) {
                    return jsonResponse({
                        ...describeWorker(),
                        intercepted: true,
                        logicalUrl,
                        logicalHost: parsedLogical.host,
                        wispTransported: true,
                        remoteDestinationContacted: false,
                        syntheticResponse: true,
                        error: wispResult.error || "El Wisp adapter reportó un error."
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
                        framing: "Wisp v2 educational frames",
                        endpoint: wispResult.endpoint,
                        streamId: wispResult.streamId,
                        framesBuilt: wispResult.framesBuilt,
                        framesEchoed: wispResult.framesEchoed,
                        framesByteIdentical: wispResult.framesByteIdentical,
                        decodedTypes: wispResult.decodedTypes
                    },
                    wispTransported: true,
                    remoteDestinationContacted: false,
                    syntheticResponse: true,
                    message: "El SW delegó la solicitud fija al adapter 5D; los frames Wisp fueron transportados como texto Base64 y validados, sin abrir el destino lógico."
                });
            } catch (error) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    wispTransported: false,
                    remoteDestinationContacted: false,
                    error: "No se pudo completar la ruta Wisp 5D.",
                    detail: error.message
                }, 500);
            }
        })());
        return;
    }

    // Fase 5C: URL lógica → MessageChannel → WebSocket Echo → MessageChannel.
    const transportEncoded = extractEncoded(url, LAB_TRANSPORT_MARKER);
    if (transportEncoded !== null) {
        event.respondWith((async () => {
            if (event.request.method !== "GET") {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    transported: false,
                    remoteDestinationContacted: false,
                    error: "La Fase 5C solo acepta GET."
                }, 405);
            }

            if (!transportEncoded) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    transported: false,
                    remoteDestinationContacted: false,
                    error: "Falta la URL codificada."
                }, 400);
            }

            try {
                const logicalUrl = base64UrlToText(transportEncoded);
                const parsedLogical = new URL(logicalUrl);

                if (logicalUrl !== FIXED_LOGICAL_URL) {
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
    const routeEncoded = extractEncoded(url, LAB_ROUTE_MARKER);
    if (routeEncoded !== null) {
        event.respondWith((async () => {
            if (event.request.method !== "GET") {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    networkContacted: false,
                    error: "La Fase 5B solo acepta GET."
                }, 405);
            }

            if (!routeEncoded) {
                return jsonResponse({
                    ...describeWorker(),
                    intercepted: true,
                    networkContacted: false,
                    error: "Falta la URL codificada."
                }, 400);
            }

            try {
                const originalUrl = base64UrlToText(routeEncoded);
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
