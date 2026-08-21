/*
 * =========================================================
 * BYTE SHARK WEB FILTERING LAB
 * Fase 3A - Relay limitado
 * =========================================================
 *
 * Este Worker NO es un proxy abierto.
 * Solo puede solicitar https://example.com/
 */

// Único sitio al que puede acceder el relay.
const TARGET_URL = "https://example.com/";

// Único origin autorizado para leer la respuesta desde JavaScript.
const ALLOWED_ORIGIN = "https://byteshark-dev.github.io";

export default {
    async fetch(request) {
        /*
         * ---------------------------------------------------------
         * CORS PREFLIGHT
         * ---------------------------------------------------------
         */
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Max-Age": "86400",
                    "Vary": "Origin"
                }
            });
        }

        /*
         * ---------------------------------------------------------
         * SOLO PERMITIMOS GET
         * ---------------------------------------------------------
         */
        if (request.method !== "GET") {
            return jsonResponse(
                {
                    success: false,
                    error: "Method not allowed"
                },
                405
            );
        }

        /*
         * ---------------------------------------------------------
         * COMPROBAR ORIGIN
         * ---------------------------------------------------------
         *
         * Si la petición procede de fetch() en nuestro GitHub Pages,
         * Chrome enviará el header Origin.
         *
         * Abrir el Worker directamente en una pestaña normalmente no
         * incluye Origin, así que también permitimos origin === null
         * para poder comprobar visualmente que el Worker funciona.
         */
        const origin = request.headers.get("Origin");

        if (origin !== null && origin !== ALLOWED_ORIGIN) {
            return new Response(
                JSON.stringify(
                    {
                        success: false,
                        error: "Origin not allowed"
                    },
                    null,
                    2
                ),
                {
                    status: 403,
                    headers: {
                        "Content-Type": "application/json; charset=UTF-8",
                        "Vary": "Origin"
                    }
                }
            );
        }

        /*
         * ---------------------------------------------------------
         * PETICIÓN REAL DESDE CLOUDFLARE
         * ---------------------------------------------------------
         */
        try {
            // Esta conexión la realiza Cloudflare, no el Chromebook.
            const upstream = await fetch(TARGET_URL, {
                method: "GET",
                redirect: "follow"
            });

            const text = await upstream.text();

            const result = {
                success: true,
                relay: "Cloudflare Worker",
                target: TARGET_URL,
                targetStatus: upstream.status,
                receivedCharacters: text.length,
                preview: text.substring(0, 300)
            };

            return jsonResponse(result, 200);
        } catch (error) {
            return jsonResponse(
                {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                },
                500
            );
        }
    }
};

/*
 * Crear respuestas JSON consistentes y habilitar CORS únicamente
 * para nuestro GitHub Pages.
 */
function jsonResponse(data, status) {
    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,
            headers: {
                "Content-Type": "application/json; charset=UTF-8",
                "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
                "Vary": "Origin",
                "Cache-Control": "no-store"
            }
        }
    );
}
