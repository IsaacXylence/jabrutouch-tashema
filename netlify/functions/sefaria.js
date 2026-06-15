/**
 * netlify/functions/sefaria.js
 * ─────────────────────────────────────────────────────────────────────────
 * PROXY A SEFARIA — la fuente de verdad del TEXTO.
 *
 * Trae el texto REAL (Mishná, Guemará, Rashi) desde la API pública de Sefaria
 * y lo devuelve limpio, listo para inyectarse como <FUENTES> en el javruta.
 * Esto es lo que garantiza 0 alucinaciones en las CITAS: el modelo no cita de
 * memoria, cita lo que Sefaria devuelve, palabra por palabra.
 *
 * Sefaria NO requiere API key (API pública y gratuita).
 *
 * La app llama:  /api/sefaria?ref=<suguia>&lang=both
 *   ref  → clave corta de la suguiá (shnayim, suca…) o un Ref directo de Sefaria
 *   lang → 'he' (original), 'en' (traducción) o 'both' (ambos). Default: both
 * ─────────────────────────────────────────────────────────────────────────
 */

const SEFARIA = "https://www.sefaria.org/api/v3/texts/";

// Cabeceras CORS
const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

/**
 * Mapa de las suguiot de la app → Refs reales de Sefaria.
 * Para cada una traemos la Mishná, la Guemará (daf) y Rashi.
 * (Los nombres de tratado en Sefaria van en transliteración inglesa.)
 */
const SUGYOT = {
  shnayim: {
    titulo: "Babá Metzía 1:1 · Shnayim Ojazín",
    mishna: "Mishnah Bava Metzia.1.1",
    guemara: "Bava Metzia.2a",
    rashi: "Rashi on Bava Metzia.2a",
  },
  suca: {
    titulo: "Sucá 1:1",
    mishna: "Mishnah Sukkah.1.1",
    guemara: "Sukkah.2a",
    rashi: "Rashi on Sukkah.2a",
  },
  bk: {
    titulo: "Babá Kamá 3:1 · HaManíaj",
    mishna: "Mishnah Bava Kamma.3.1",
    guemara: "Bava Kamma.27a",
    rashi: "Rashi on Bava Kamma.27a",
  },
  meematai: {
    titulo: "Berajot 1:1 · Meematai",
    mishna: "Mishnah Berakhot.1.1",
    guemara: "Berakhot.2a",
    rashi: "Rashi on Berakhot.2a",
  },
  elu: {
    titulo: "Babá Metzía 2:1 · Elú Metziot",
    mishna: "Mishnah Bava Metzia.2.1",
    guemara: "Bava Metzia.21a",
    rashi: "Rashi on Bava Metzia.21a",
  },
};

// Quita HTML/espacios sobrantes (por si return_format deja algo)
function clean(t) {
  if (t == null) return "";
  if (Array.isArray(t)) t = t.join(" ");
  return String(t)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trae UN ref de Sefaria, devolviendo {he, en}.
 * Usa v3 con return_format=text_only y dos versiones (source + translation).
 */
async function fetchRef(ref, signal) {
  const url =
    SEFARIA +
    encodeURIComponent(ref) +
    "?version=source&version=translation&return_format=text_only";
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) return { he: "", en: "", error: `Sefaria ${r.status}` };

  const data = await r.json();
  // v3 devuelve un array 'versions'; cada una trae 'text' y 'language'
  let he = "",
    en = "";
  const versions = Array.isArray(data.versions) ? data.versions : [];
  for (const v of versions) {
    const txt = clean(v.text);
    if (!txt) continue;
    // 'he'/'hebrew' = original; el resto lo tratamos como traducción
    if (v.language === "he" || v.language === "hebrew") {
      if (!he) he = txt;
    } else if (!en) {
      en = txt;
    }
  }
  return { he, en };
}

/**
 * Busca textos en toda la biblioteca de Sefaria (full-text).
 * Devuelve una lista de refs con un fragmento, para que el usuario elija.
 */
async function searchSefaria(query, signal, categoria) {
  // Detectar si la consulta es hebrea (para elegir el campo correcto)
  const isHebrew = /[\u0590-\u05FF]/.test(query);
  const body = {
    query: query,
    type: "text",
    // 'exact' funciona para español/inglés; 'naive_lemmatizer' solo hebreo.
    field: isHebrew ? "naive_lemmatizer" : "exact",
    slop: isHebrew ? 10 : 2,
    size: 12,
    source_proj: true, // devolver el documento completo (ref, categories, etc.)
  };
  // Filtro por categoría: debe ser la RUTA del campo 'path' de Sefaria.
  if (categoria) {
    body.filters = [categoria];
    body.filter_fields = ["path"];
  }
  const r = await fetch("https://www.sefaria.org/api/search-wrapper", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { results: [], error: `Sefaria search ${r.status}` };
  const data = await r.json();
  // ElasticSearch: data.hits.hits[]._source { ref, heRef, categories, exact... }
  const hits = (data && data.hits && data.hits.hits) || [];
  const results = hits.map((h) => {
    const s = h._source || h.fields || {};
    // El fragmento puede venir en highlight (varias claves posibles) o en el texto
    let hl = "";
    if (h.highlight) {
      const keys = Object.keys(h.highlight);
      if (keys.length) hl = [].concat(h.highlight[keys[0]] || []).join(" … ");
    }
    const snippet = clean(hl || s.exact || s.naive_lemmatizer || "").slice(0, 240);
    return {
      ref: s.ref || s.title || "",
      heRef: s.heRef || "",
      categoria: Array.isArray(s.categories) ? s.categories.join(" › ") : (s.categories || ""),
      snippet,
    };
  }).filter((x) => x.ref);
  return { results };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  const params = event.queryStringParameters || {};
  const action = (params.action || "text").toLowerCase();
  const key = (params.ref || "").trim();
  const lang = (params.lang || "both").toLowerCase();

  // ── ACCIÓN: BÚSQUEDA en toda la biblioteca ──
  if (action === "search") {
    const q = (params.q || "").trim();
    if (!q) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Falta 'q'" }) };
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const out = await searchSefaria(q, ctrl.signal, params.categoria || "");
      clearTimeout(t);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ q, ...out, source: "sefaria" }) };
    } catch (e) {
      clearTimeout(t);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ q, results: [], error: "búsqueda no disponible", source: "sefaria" }) };
    }
  }

  // ── ACCIÓN: TRAER TEXTO (por defecto) ──
  if (!key) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Falta 'ref'" }) };
  }

  // ¿Es una de nuestras suguiot, o un Ref directo de Sefaria?
  const sug = SUGYOT[key];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    let out;

    if (sug) {
      // Suguiá conocida: traemos Mishná + Guemará + Rashi en paralelo
      const [mishna, guemara, rashi] = await Promise.all([
        fetchRef(sug.mishna, controller.signal),
        fetchRef(sug.guemara, controller.signal),
        fetchRef(sug.rashi, controller.signal),
      ]);
      clearTimeout(timer);

      // Armamos el bloque de fuentes para el grounding del javruta
      const pick = (o) =>
        lang === "he" ? o.he : lang === "en" ? o.en : [o.he, o.en].filter(Boolean).join("\n");

      const fuentes =
        `=== ${sug.titulo} ===\n\n` +
        `[MISHNÁ — ${sug.mishna}]\n${pick(mishna) || "(no disponible)"}\n\n` +
        `[GUEMARÁ — ${sug.guemara}]\n${pick(guemara) || "(no disponible)"}\n\n` +
        `[RASHI — ${sug.rashi}]\n${pick(rashi) || "(no disponible)"}`;

      // Si NADA vino con texto, devolvemos vacío para que la app use su respaldo local.
      const algo = (mishna.he||mishna.en||guemara.he||guemara.en||rashi.he||rashi.en);
      out = {
        ref: key,
        titulo: sug.titulo,
        fuentes: algo ? fuentes : "",
        partes: { mishna, guemara, rashi },
        source: "sefaria",
      };
    } else {
      // Ref directo de Sefaria (ej. "Bava Metzia.2b")
      const one = await fetchRef(key, controller.signal);
      clearTimeout(timer);
      const pick =
        lang === "he" ? one.he : lang === "en" ? one.en : [one.he, one.en].filter(Boolean).join("\n");
      out = {
        ref: key,
        titulo: key,
        fuentes: pick ? `[${key}]\n${pick}` : "",
        partes: { texto: one },
        source: "sefaria",
      };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(out) };
  } catch (e) {
    clearTimeout(timer);
    // Si Sefaria falla o hay timeout, devolvemos vacío con aviso.
    // El javruta seguirá funcionando con el texto local (SUG_CTX) de respaldo.
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ref: key,
        titulo: sug ? sug.titulo : key,
        fuentes: "",
        error: "Sefaria no disponible ahora mismo",
        source: "sefaria",
      }),
    };
  }
};
