/**
 * netlify/functions/javruta.js
 * ─────────────────────────────────────────────────────────────────────────
 * EL PROXY DEL JAVRUTA.
 *
 * La app del navegador llama a  /api/javruta  (sin ninguna llave).
 * Esta función:
 *   1. Valida la entrada.
 *   2. Arma el system prompt del Rab + el texto fuente (grounding).
 *   3. Llama a Claude con la API key (que vive SOLO aquí, en Netlify).
 *   4. Devuelve la respuesta — o un fallback seguro si algo falla.
 *
 * La ANTHROPIC_API_KEY nunca toca el navegador ni el repositorio de GitHub.
 * ─────────────────────────────────────────────────────────────────────────
 */

const { buildSystemPrompt } = require("./_systemPrompt.js");

// ── Config ──
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";        // modelo del javruta
const MAX_TOKENS = 1024;
const MAX_HISTORY = 16;                    // turnos máximos que reenviamos
const MAX_MSG_LEN = 4000;                  // tope por mensaje (anti-abuso)

// Cabeceras CORS (la app y el proxy viven en el mismo dominio Netlify,
// pero dejamos esto explícito y restringible).
const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── Fallback: qué responde el javruta si la API no está disponible ──
// No inventa contenido: devuelve una pregunta socrática genérica del método,
// para que la experiencia no se rompa y el alumno siga pensando.
const FALLBACK_PREGUNTAS = [
  "Antes de seguir: ¿qué hace el texto justo ahí — pregunta, responde, objeta o concluye?",
  "Pensemos con el método: ¿cuál es el sujeto (נושא) de lo que estás leyendo, y cuál es su ley?",
  "Regla de Kanpanton: nada sobra. ¿Ves alguna palabra o repetición que parezca de más? ¿Qué vendría a enseñarte?",
  "¿Qué pregunta crees que abrirá la Guemará sobre esto? Intenta predecirla antes de mirar.",
  "Volvamos al texto: ¿qué es lo que NO se dice, y por qué podría ser significativo ese silencio?",
];

function fallbackReply() {
  const i = Math.floor(Math.random() * FALLBACK_PREGUNTAS.length);
  return FALLBACK_PREGUNTAS[i];
}

// ── Saneo de la conversación que llega del cliente ──
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY) // solo los últimos N turnos
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_MSG_LEN),
    }));
}

exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: "Método no permitido" }),
    };
  }

  // La llave debe existir en el entorno de Netlify
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    // No exponemos el detalle al cliente; devolvemos fallback.
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ reply: fallbackReply(), grounded: false, fallback: true }),
    };
  }

  // Parseo seguro del cuerpo
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "JSON inválido" }),
    };
  }

  const messages = sanitizeMessages(body.messages);
  if (messages.length === 0) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Faltan mensajes" }),
    };
  }

  // Contexto de la suguiá / pantalla — incluye el TEXTO FUENTE (grounding)
  const ctx = {
    suguia: typeof body.suguia === "string" ? body.suguia.slice(0, 200) : "",
    arquetipo: typeof body.arquetipo === "string" ? body.arquetipo.slice(0, 60) : "",
    paso: typeof body.paso === "string" ? body.paso.slice(0, 120) : "",
    // 'fuentes' = texto real verificado. Hoy lo manda la app (la suguiá);
    // mañana lo inyectará sefaria.js. Si viene vacío, el prompt prohíbe citar.
    fuentes: typeof body.fuentes === "string" ? body.fuentes.slice(0, 12000) : "",
  };

  // Dos modos:
  //  - Por defecto: javruta conversacional con grounding (prompt del Rab).
  //  - 'system' override: generadores estructurados de la app (plan, shiur,
  //    comprensión, hoja de Shabat). Aun así pasan por el proxy (key protegida)
  //    y se les recuerda no inventar fuentes.
  const ANTI_HALU = "\n\nIMPORTANTE: no inventes fuentes, números de daf ni citas que no te hayan sido dadas. Responde solo lo pedido, en español.";
  let system, grounded;
  if (typeof body.system === "string" && body.system.trim()) {
    system = body.system.slice(0, 8000) + ANTI_HALU;
    grounded = false;
  } else {
    system = buildSystemPrompt(ctx);
    grounded = !!(ctx.fuentes && ctx.fuentes.trim());
  }
  // max_tokens configurable por la app (con tope de seguridad)
  const maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || MAX_TOKENS, 64), 2048);

  // ── Llamada a Claude con timeout (no dejamos colgada la función) ──
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages,
      }),
    });
    clearTimeout(timer);

    if (!r.ok) {
      // Error de la API (rate limit, etc.) → fallback, sin filtrar detalles
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ reply: fallbackReply(), grounded, fallback: true }),
      };
    }

    const data = await r.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        reply: reply || fallbackReply(),
        grounded,
        fallback: !reply,
      }),
    };
  } catch (e) {
    clearTimeout(timer);
    // Timeout o caída de red → fallback seguro
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ reply: fallbackReply(), grounded, fallback: true }),
    };
  }
};
