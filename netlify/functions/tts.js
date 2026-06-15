/**
 * netlify/functions/tts.js
 * ─────────────────────────────────────────────────────────────────────────
 * PROXY DE VOZ (ElevenLabs) — la voz del Rab.
 *
 * La app manda texto → este proxy llama a ElevenLabs con la voz clonada del
 * Rab → devuelve el audio (MP3 en base64) para que el navegador lo reproduzca.
 *
 * La ELEVENLABS_API_KEY y el RAB_VOICE_ID viven SOLO en Netlify, nunca en el
 * navegador ni en GitHub.
 *
 * Mientras la voz del Rab no esté clonada, RAB_VOICE_ID puede apuntar a una
 * voz genérica de ElevenLabs para probar el flujo. El día que tengas la voz
 * del Rab, solo cambias esa variable en Netlify — sin tocar este código.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/";
// Multilingual v2 = mejor calidad y soporte de español (incl. términos hebreos).
const MODEL = "eleven_multilingual_v2";
const MAX_TEXT = 2500; // tope de caracteres por petición (controla costo/latencia)

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  const API_KEY = process.env.ELEVENLABS_API_KEY;
  const VOICE_ID = process.env.RAB_VOICE_ID;

  // Si no hay credenciales, avisamos a la app para que use la voz del navegador
  // (Web Speech API) como respaldo — la experiencia no se rompe.
  if (!API_KEY || !VOICE_ID) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ audio: null, fallback: true, reason: "voz del Rab no configurada" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  let text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Falta 'text'" }) };
  }
  // Limpiamos emojis/símbolos que la voz no debe leer, y recortamos.
  text = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}✓✗👑]/gu, "").slice(0, MAX_TEXT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch(ELEVEN_URL + encodeURIComponent(VOICE_ID) + "?optimize_streaming_latency=3&output_format=mp3_44100_128", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: {
          stability: 0.5,        // equilibrio: voz estable pero con vida
          similarity_boost: 0.85, // fidelidad alta a la voz clonada del Rab
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });
    clearTimeout(timer);

    if (!r.ok) {
      // Error de ElevenLabs (cuota, voz inválida, etc.) → fallback a voz del navegador
      let detail = "";
      try { detail = (await r.text()).slice(0, 200); } catch {}
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ audio: null, fallback: true, reason: "ElevenLabs " + r.status, detail }),
      };
    }

    // La respuesta es audio binario (MP3). Lo pasamos a base64 para el JSON.
    const buf = Buffer.from(await r.arrayBuffer());
    const b64 = buf.toString("base64");

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        audio: "data:audio/mpeg;base64," + b64,
        fallback: false,
      }),
    };
  } catch (e) {
    clearTimeout(timer);
    // Timeout o red caída → fallback a voz del navegador
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ audio: null, fallback: true, reason: "tts no disponible" }),
    };
  }
};
