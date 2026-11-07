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
      return res.status(200).json({
        version,
        session: body.session,
        response: {
          text: "Ошибка: не задан ключ GEMINI_API_KEY в Vercel.",
          end_session: false
        }
      });
    }

    // Пробуем модель gemini-2.5-flash-lite (она стабильнее и не имеет такой дикой очереди, как 3.8)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Ответь кратко (1-2 предложения), на русском, без спецсимволов и звездочек: ${userText}`
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 100,
            temperature: 0.7
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({
        version,
        session: body.session,
        response: {
          text: `Google занят (${data.error.message}). Повторите вопрос через пару секунд.`,
          end_session: false
        }
      });
    }

    const parts = data.candidates?.[0]?.content?.parts;
    let reply = "Не удалось получить ответ от нейросети.";

    if (parts) {
      const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
      if (textPart?.text) {
        reply = textPart.text.replace(/[*#_`]/g, "").trim();
      }
    }

    if (reply.length > 950) {
      reply = reply.slice(0, 950) + "...";
    }

    return res.status(200).json({
      version,
      session: body.session,
      response: {
        text: reply,
        end_session: false
      }
    });

  } catch (err) {
    return res.status(200).json({
      version: req.body?.version || "1.0",
      session: req.body?.session,
      response: {
        text: "Нейросеть думает чуть дольше обычного. Спросите еще раз.",
        end_session: false
      }
    });
  }
};
