# Jabrutouch by Tashema — Backend

Yeshivá digital que enseña el método **Darjé Hamishná** del Rab Yehoshúa
Benzadón. Esta carpeta contiene la app más el backend que la conecta, de forma
segura, con Claude (el javruta), Sefaria (texto real) y ElevenLabs (voz del Rab).

-----

## Cómo está armado

```
Navegador  →  /api/...  →  Netlify Functions  →  Claude / Sefaria / ElevenLabs
(la app)      (proxy)       (aquí viven las claves)
```

La app **nunca** habla directo con las APIs ni conoce las claves. Todo pasa por
el proxy, donde las claves viven protegidas. El progreso del alumno se guarda en
su propio dispositivo (sin base de datos, sin login).

### Las tres funciones del backend

|Función     |Ruta          |Qué hace                                                       |Necesita clave                       |
|------------|--------------|---------------------------------------------------------------|-------------------------------------|
|`javruta.js`|`/api/javruta`|El javruta (Claude) con el método del Rab y anti-alucinación   |`ANTHROPIC_API_KEY`                  |
|`sefaria.js`|`/api/sefaria`|Trae el texto real (Mishná/Guemará/Rashi) para anclar las citas|No (API pública)                     |
|`tts.js`    |`/api/tts`    |La voz del Rab (ElevenLabs)                                    |`ELEVENLABS_API_KEY` + `RAB_VOICE_ID`|

**Clave del diseño anti-alucinación:** el javruta solo cita texto que se le
entrega verificado (de Sefaria). Nunca cita “de memoria”. Si no tiene la fuente,
lo dice. Y nunca da dictamen halájico (psak).

-----

## Despliegue paso a paso

### 1. Subir el proyecto a GitHub

1. Crea una cuenta en [github.com](https://github.com) si no la tienes.
1. Crea un repositorio nuevo (por ejemplo, `jabrutouch`). Puede ser privado.
1. Sube esta carpeta completa al repositorio. Si usas la web de GitHub, puedes
   arrastrar los archivos; si usas la terminal:
   
   ```bash
   git init
   git add .
   git commit -m "Jabrutouch backend inicial"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/jabrutouch.git
   git push -u origin main
   ```

> El `.gitignore` ya evita que se suban claves o `node_modules`. Verifica que
> **no** aparezca ningún archivo `.env` en el repositorio.

### 2. Conectar Netlify al repositorio

1. Crea una cuenta en [netlify.com](https://netlify.com) (puedes entrar con GitHub).
1. **Add new site → Import an existing project → GitHub** y elige tu repositorio.
1. Netlify leerá el archivo `netlify.toml` automáticamente. Confirma:
- **Publish directory:** `public`
- **Functions directory:** `netlify/functions`
- No hace falta “build command” (la app es estática).
1. Pulsa **Deploy**. En un minuto tendrás una URL tipo
   `https://TU-SITIO.netlify.app`.

### 3. Configurar las claves (variables de entorno)

En el panel de Netlify: **Site settings → Environment variables → Add a variable**.

Añade (al inicio, solo la primera es obligatoria):

|Nombre              |Valor                                                 |¿Obligatoria?    |
|--------------------|------------------------------------------------------|-----------------|
|`ANTHROPIC_API_KEY` |Tu clave de Claude (de console.anthropic.com)         |**Sí**           |
|`ELEVENLABS_API_KEY`|Tu clave de ElevenLabs                                |No (voz, después)|
|`RAB_VOICE_ID`      |El Voice ID de la voz clonada del Rab                 |No (voz, después)|
|`ALLOWED_ORIGIN`    |Tu URL de Netlify (ej. `https://tu-sitio.netlify.app`)|Recomendada      |

Después de añadir o cambiar variables, ve a **Deploys → Trigger deploy →
Deploy site** para que tomen efecto.

### 4. Probar que funciona

Abre tu URL de Netlify y:

1. Completa el onboarding y entra a una suguiá.
1. Abre el **javruta** (el copilot) y escríbele algo, por ejemplo:
   *“No entiendo por qué la Mishná repite que cada uno jura.”*
1. Debe responderte **con una pregunta del método** (no con una respuesta
   cerrada), anclada al texto real de la suguiá.

Si responde con preguntas genéricas del método aunque le escribas varias veces,
revisa que `ANTHROPIC_API_KEY` esté bien puesta (ver “Solución de problemas”).

-----

## La voz del Rab (cuando esté lista)

La app ya funciona con la **voz del navegador** mientras no haya voz clonada.
Para activar la voz real del Rab:

### Clonar la voz en ElevenLabs

1. **Permiso primero.** Clonar una voz requiere el consentimiento del Rab.
   ElevenLabs te pedirá confirmar que tienes derecho a usarla.
1. Entra a [elevenlabs.io](https://elevenlabs.io) → **Voices → Add a new voice →
   Instant Voice Cloning**.
1. Sube **1 a 5 minutos** de audio del Rab, en español, solo su voz, sin música
   ni ruido. (No necesitas el archivo completo de una clase: recorta un
   fragmento limpio.)
1. Ponle nombre (ej. “Rab Benzadón”) y acepta la confirmación de permiso.
1. Al crearse, copia el **Voice ID** (una cadena de letras y números).
1. En Netlify, añade `ELEVENLABS_API_KEY` y `RAB_VOICE_ID`, y redespliega.

A partir de ahí, el javruta hablará con la voz del Rab — sin cambiar código.

> Para la versión de máxima fidelidad, ElevenLabs ofrece *Professional Voice
> Cloning* (necesita más audio y verificación del propio Rab). Empieza con
> Instant para validar, y sube a Professional cuando quieras la definitiva.

-----

## Solución de problemas

**El javruta solo responde preguntas genéricas, nunca específicas.**
Suele ser la clave de Claude. Verifica que `ANTHROPIC_API_KEY` esté en las
variables de Netlify y que hayas redesplegado después de añadirla.

**No se oye la voz del Rab (pero sí la del navegador).**
Es lo esperado hasta clonar la voz. Cuando configures `ELEVENLABS_API_KEY` y
`RAB_VOICE_ID`, empezará a sonar su voz.

**El javruta no cita el texto exacto / dice que no tiene la fuente.**
Sefaria pudo no estar disponible en ese momento; la app usa entonces el texto
local de respaldo. Reintenta; si persiste, revisa la consola del navegador
(F12) por errores en `/api/sefaria`.

**Cómo ver errores.** En Netlify: **Functions → (elige la función) → Logs**.
Ahí ves qué pasó en cada llamada al backend.

-----

## Desarrollo local (opcional)

Con la [CLI de Netlify](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
cp .env.example .env      # rellena tus claves en .env (NO se sube a git)
netlify dev               # levanta la app + las funciones en local
```

-----

## Privacidad y datos

- No hay cuentas ni base de datos: el progreso vive en el dispositivo del alumno.
- Las claves viven solo en Netlify, nunca en el navegador ni en GitHub.
- El texto talmúdico proviene de Sefaria (fuente pública verificada).
- El método y la voz son propiedad de Tashema / Rab Benzadón.
