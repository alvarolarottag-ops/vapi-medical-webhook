import express from "express";
import { google } from "googleapis";

const app = express();
app.use(express.json());

/**
 * ENV VARS requeridas en Render:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN
 * - GOOGLE_CALENDAR_ID (tu calendario principal, ej: alvarolarottag@gmail.com)
 * - VAPI_SHARED_SECRET (opcional pero recomendado)
 */

function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

function assertAuth(req) {
  // Seguridad simple opcional (recomendado):
  // Vapi puede mandar un header fijo que tú configuras en el tool (server.headers)
  const expected = process.env.VAPI_SHARED_SECRET;
  if (!expected) return;

  const got = req.header("x-vapi-secret");
  if (got !== expected) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

// Health check
app.get("/", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Endpoint único para tools de Vapi (tool-calls).
 * Vapi espera un response:
 * { results: [{ toolCallId, result }] }
 */
app.post("/vapi/tools", async (req, res) => {
  try {
    assertAuth(req);

    const message = req.body?.message;
    if (!message || message.type !== "tool-calls") {
      return res.status(400).json({ error: "Invalid payload: expected tool-calls" });
    }

    const toolCallList = message.toolCallList || [];
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    const results = [];

    for (const toolCall of toolCallList) {
      const toolCallId = toolCall.id;
      const name = toolCall.function?.name;
      const args = toolCall.function?.arguments || {};

      if (name === "cancel_appointment") {
        // args: { eventId }
        const { eventId } = args;
        if (!eventId) throw new Error("cancel_appointment requires eventId");

        await calendar.events.delete({ calendarId, eventId });

        results.push({
          toolCallId,
          result: { ok: true, action: "cancelled", eventId },
        });
        continue;
      }

      if (name === "reschedule_appointment") {
        // args: { eventId, start, end }
        // start/end en RFC3339: "2026-03-05T15:00:00-05:00"
        const { eventId, start, end } = args;
        if (!eventId || !start || !end) {
          throw new Error("reschedule_appointment requires eventId, start, end");
        }

        const patch = {
          start: { dateTime: start },
          end: { dateTime: end },
        };

        const updated = await calendar.events.patch({
          calendarId,
          eventId,
          requestBody: patch,
        });

        results.push({
          toolCallId,
          result: {
            ok: true,
            action: "rescheduled",
            eventId,
            htmlLink: updated.data.htmlLink,
          },
        });
        continue;
      }

      // Tool desconocido
      results.push({
        toolCallId,
        result: { ok: false, error: `Unknown tool function: ${name}` },
      });
    }

    res.json({ results });
  } catch (e) {
    const status = e.statusCode || 500;
    res.status(status).json({ error: e.message || "Server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
