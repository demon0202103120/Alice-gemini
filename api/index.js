const cache = new Map();

// Запрос к одной конкретной модели
async function callModel(model, promptText, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [ { parts: [ { text: `Ответь кратко (1-2 предложения), на русском, без спецсимволов и звездочек: ${promptText}`
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 90,
          temperature: 0.6
        }
      })
    }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || "Google API Error");
  }

  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("Empty parts");
  }

  const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
  const reply = (textPart ? textPart.text : "").replace(/[*#_`]/g, "").trim();

  if (!reply) {
    throw new Error("Empty text");
  }

  return reply.length > 950 ? reply.slice(0, 950) + "..." : reply;
}

// Параллельный запрос сразу к нескольким моделям — берем ту, что ответит первой без очереди
async function askGeminiFast(promptText, apiKey) {
  const models = [
    "gemini-3.8-flash",
    "gemini-3.8-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash"
  ];

  try {
    return await Promise.any(models.map(m => callModel(m, promptText, apiKey)));
  } catch (aggregateErr) {
    // Если с первой попытки все перегружены, ждем 800 мс и пробуем 3.8-flash еще раз
    await new Promise(r => setTimeout(r, 800));
    try {
      return await callModel("gemini-3.8-flash", promptText, apiKey);
    } catch (finalErr) {
      return `Сервера Google сейчас перегружены (${finalErr.message}). Попробуйте спросить через минуту.`;
    }
  }
}

module.exports = async (req, res) => {
  try {
    const body = req.body || {};

    if (!body.request) {
      return res.status(200).json({
        version: "1.0",
        response: {
          text: "Привет! Я готова отвечать через Gemini.",
          end_session: false
        }
      });
    }

    const userText = (body.request.command || body.request.original_utterance || "").trim();
    const sessionId = body.session?.session_id || "default_session";
    const version = body.version || "1.0";
    const apiKey = process.env.GEMINI_API_KEY;

    if (!userText) {
      return res.status(200).json({
        version,
        session: body.session,
        response: {
          text: "Слушаю! О чем спросим Gemini?",
          end_session: false
        }
      });
    }

    if (!apiKey) {
      return
