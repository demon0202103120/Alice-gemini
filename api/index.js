const cache = new Map();

// Список актуальных моделей: от самых быстрых и легких к основным
const MODELS = [
  "gemini-3.8-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash"
];

async function askGeminiWithFallback(promptText, apiKey) {
  let lastError = "";

  // Проходим по списку моделей, пока одна из них не ответит без ошибки перегрузки
  for (const model of MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Ответь кратко (1-2 предложения), на русском, для чтения вслух без спецсимволов: ${promptText}`
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

      // Если эта модель не найдена (404) или перегружена (503 / high demand) — сразу пробуем следующую
      if (data.error) {
        lastError = data.error.message || JSON.stringify(data.error);
        continue;
      }

      if (data.candidates?.[0]?.content?.parts) {
        const parts = data.candidates[0].content.parts;
        const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
        let reply = (textPart ? textPart.text : "").replace(/[*#_`]/g, "").trim();

        if (reply) {
          if (reply.length > 950) reply = reply.slice(0, 950) + "...";
          return reply;
        }
      }
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  // Если с первого круга все модели заняты, ждем 1 секунду и делаем контрольный запрос к 3.8-flash
  await new Promise(r => setTimeout(r, 1000));
  try {
    const retryResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `Ответь одним предложением на русском: ${promptText}` }] }],
          generationConfig: { maxOutputTokens: 80 }
        })
      }
    );
    const retryData = await retryResp.json();
    if (retryData.candidates?.[0]?.content?.parts) {
      const parts = retryData.candidates[0].content.parts;
      const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
      if (textPart?.text) return textPart.text.replace(/[*#_`]/g, "").trim();
    }
  } catch (e) {}

  return `Сервера Google сейчас перегружены (${lastError}). Попробуйте через минуту.`;
}

module.exports = async (req, res) => {
  if (!req.body || !req.body.request) {
    return res.status(200).json({
      version: "1.0",
      response: {
        text: "Привет! Я готова отвечать через Gemini.",
        end_session: false
      }
    });
  }

  const userText = (req.body.request.command || req.body.request.original_utterance || "").trim();
  const sessionId = req.body.session?.session_id || "default_session";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!userText) {
    return res.status(200).json({
      version: req.body.version,
      session: req.body.session,
      response: {
        text: "Слушаю! О чем спросим Gemini?",
        end_session: false
      }
    });
  }

  if (!apiKey) {
    return res.status(200).json({
      version: req.body.version,
      session: req.body.session,
      response: {
        text: "Ошибка: не задан ключ GEMINI_API_KEY в Vercel.",
        end_session: false
      }
    });
  }

  const lowerText = userText.toLowerCase();
  const isFollowUp = ["дальше", "готово", "ну что", "продолжай", "ответ", "да", "ага"].includes(lowerText);
  const existingTask = cache.get(sessionId);

  if (isFollowUp && existingTask) {
    if (existingTask.status === "done") {
      cache.delete(sessionId);
      return res.status(200).json({
        version: req.body.version,
        session: req.body.session,
        response: {
          text: existingTask.reply,
          end_session: false
        }
      });
    } else {
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve("TIMEOUT"), 2200));
      const result = await Promise.race([existingTask.promise, timeoutPromise]);

      if (result !== "TIMEOUT") {
        cache.delete(sessionId);
        return res.status(200).json({
          version: req.body.version,
          session: req.body.session,
          response: {
            text: result,
            end_session: false
          }
        });
      }

      return res.status(200).json({
        version: req.body.version,
        session: req.body.session,
        response: {
          text: "Сервер Google сильно загружен, еще дожимаю ответ... Нажмите «Дальше».",
          buttons: [{ title: "Дальше", hide: true }],
          end_session: false
        }
      });
    }
  }

  const taskRecord = { status: "pending", reply: null, promise: null };

  const geminiPromise = askGeminiWithFallback(userText, apiKey)
    .then(reply => {
      taskRecord.status = "done";
      taskRecord.reply = reply;
      return reply;
