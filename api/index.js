module.exports = async (req, res) => {
  // Пинги и пустые запросы
  if (!req.body || !req.body.request) {
    return res.status(200).json({
      version: "1.0",
      response: {
        text: "Привет! Я готова отвечать через Gemini.",
        end_session: false
      }
    });
  }

  const userText = req.body.request.command || req.body.request.original_utterance;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!userText || userText.trim() === "") {
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
        text: "Ошибка: переменная GEMINI_API_KEY не задана в настройках Vercel.",
        end_session: false
      }
    });
  }

  // Ограничиваем ожидание от Google 2.4 секундами, чтобы успеть отдать ответ Яндексу
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2400);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Ответь максимально кратко, одно-два предложения, разговорным языком: ${userText}`
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 120,
            temperature: 0.7,
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })
      }
    );

    clearTimeout(timeoutId);
    const data = await response.json();

    let reply = "";

    if (data.error) {
      reply = `Ошибка Google: ${data.error.message || JSON.stringify(data.error)}`;
    } else if (data.candidates?.[0]?.content?.parts) {
      const parts = data.candidates[0].content.parts;
      const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
      reply = textPart ? textPart.text : "Ответ от нейросети пуст.";
    } else {
      reply = `Неожиданный ответ Google: ${JSON.stringify(data).slice(0, 150)}`;
    }

    reply = reply.replace(/[*#_`]/g, "").trim();

    if (reply.length > 950) {
      reply = reply.slice(0, 950) + "...";
    }

    return res.status(200).json({
      version: req.body.version,
      session: req.body.session,
      response: {
        text: reply,
        end_session: false
      }
    });
  } catch (err) {
    clearTimeout(timeoutId);

    // Если сработал таймаут 2.4 секунды
    if (err.name === "AbortError") {
      return res.status(200).json({
        version: req.body.version,
        session: req.body.session,
        response: {
          text: "Нейросеть задумалась дольше 3 секунд. Попробуйте спросить еще раз короче.",
          end_session: false
        }
      });
    }

    return res.status(200).json({
      version: req.body.version,
      session: req.body.session,
      response: {
        text: `Сбой сервера: ${err.message}`,
        end_session: false
      }
    });
  }
};
