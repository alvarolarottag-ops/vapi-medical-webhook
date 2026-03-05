import express from "express";
import { google } from "googleapis";

const app = express();
app.use(express.json());

// ============================
// Google Calendar Client
// ============================
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

// ============================
// Health Check
// ============================
app.get("/", (_req, res) => {
  res.json({ ok: true });
});

// ============================
// Vapi Tools Webhook
// ============================
app.post("/vapi/tools", async (req, res) => {
  try {
    const message = req.body?.message;

    if (!message || message.type !== "tool-calls") {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    const results = [];

    for (const toolCall of message.toolCallList) {
      const toolCallId = toolCall.id;
      const name = toolCall.function?.name;
      const args = toolCall.function?.arguments || {};

      // ============================
      // ✅ VALIDAR DISPONIBILIDAD (FUENTE DE VERDAD)
      // ============================
      if (name === "check_availability") {
        const { start, end } = args;

        const conflictCheck = await calendar.events.list({
          calendarId,
          timeMin: start,
          timeMax: end,
          singleEvents: true,
          orderBy: "startTime",
        });

        const items = conflictCheck.data.items || [];
        const hasConflict = items.length > 0;

        results.push({
          toolCallId,
          result: {
            ok: true,
            available: !hasConflict,
          },
        });

        continue;
      }

      // ============================
      // ✅ CANCELAR CITA
      // ============================
      if (name === "cancel_appointment") {
        await calendar.events.delete({
          calendarId,
          eventId: args.eventId,
        });

        results.push({
          toolCallId,
          result: {
            ok: true,
            message: "La cita fue cancelada correctamente.",
          },
        });
        continue;
      }

      // ============================
      // ✅ REAGENDAR CITA (CON VALIDACIÓN REAL)
      // ============================
      if (name === "reschedule_appointment") {
        const { eventId, start, end } = args;

        const conflictCheck = await calendar.events.list({
          calendarId,
          timeMin: start,
          timeMax: end,
          singleEvents: true,
          orderBy: "startTime",
        });

        const items = conflictCheck.data.items || [];

        if (items.length > 0) {
          results.push({
            toolCallId,
            result: {
              ok: false,
              message: "No hay disponibilidad en el horario solicitado.",
            },
          });
          continue;
        }

        await calendar.events.patch({
          calendarId,
          eventId,
          requestBody: {
            start: { dateTime: start },
            end: { dateTime: end },
          },
        });

        results.push({
          toolCallId,
          result: {
            ok: true,
            message: "La cita fue reprogramada correctamente.",
          },
        });

        continue;
      }

      // ============================
      // ❌ BLOQUEO TOTAL DE CREACIÓN EN BACKEND
      // ============================
      results.push({
        toolCallId,
        result: {
          ok: false,
          message:
            "La creación de citas está deshabilitada en este servicio.",
        },
      });
    }

    res.json({ results });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ============================
// Server
// ============================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Vapi Medical Webhook running on port ${port}`);
});
