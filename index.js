import express from "express";
import { google } from "googleapis";

const app = express();
app.use(express.json());

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

app.get("/", (_req, res) => {
  res.json({ ok: true });
});

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

      // ✅ CANCELAR CITA
      if (name === "cancel_appointment") {
        await calendar.events.delete({
          calendarId,
          eventId: args.eventId,
        });

        results.push({
          toolCallId,
          result: {
            ok: true,
            message: "La cita fue cancelada correctamente."
          },
        });
        continue;
      }

      // ✅ REAGENDAR CITA
      if (name === "reschedule_appointment") {
        const { eventId, start, end } = args;

        // Verificar conflicto antes de mover
        const conflictCheck = await calendar.events.list({
          calendarId,
          timeMin: start,
          timeMax: end,
          singleEvents: true,
        });

        if (conflictCheck.data.items.length > 0) {
          results.push({
            toolCallId,
            result: {
              ok: false,
              message: "No hay disponibilidad en el horario solicitado."
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
            message: "La cita fue reprogramada correctamente."
          },
        });
        continue;
      }

      // ✅ CREAR CITA (VALIDACIÓN REAL DE DISPONIBILIDAD)
      if (name === "create_appointment") {
        const { start, end, summary, description } = args;

        // Verificar si hay eventos en ese rango
        const conflictCheck = await calendar.events.list({
          calendarId,
          timeMin: start,
          timeMax: end,
          singleEvents: true,
        });

        if (conflictCheck.data.items.length > 0) {
          results.push({
            toolCallId,
            result: {
              ok: false,
              message: "Ese horario ya se encuentra ocupado."
            },
          });
          continue;
        }

        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary,
            description,
            start: { dateTime: start },
            end: { dateTime: end },
          },
        });

        results.push({
          toolCallId,
          result: {
            ok: true,
            message: "La cita fue agendada correctamente."
          },
        });
        continue;
      }
    }

    res.json({ results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
