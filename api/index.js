module.exports = async (req, res) => {
  // Пинги и пустые вызовы от Яндекса
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
        text: "Ошибка: переменная GEMINI_API_KEY не задана в Vercel.",
        end_session: false
      }
    });
  }

  // Лимит ожидания 2.6 сек, чтобы Яндекс не показал красный баннер ошибки
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2600);

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
                  text: userText
                }
              ]
            }
          ],
          systemInstruction: {
            parts: [
              {
                text: "Отвечай кратко, 1-2 предложениями, разговорным языком без markdown и звездочек."
              }
            ]
          },
          generationConfig: {
            maxOutputTokens: 80,
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
      reply = textPart ? textPart.text : "Ответ пуст.";
    } else {
      reply = `Неожиданный ответ: ${JSON.stringify(data).slice(0, 150)}`;
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

    if (err.name === "AbortError") {
      return res.status(200).json({
        version: req.body.version,
        session: req.body.session,
        response: {
          text: "Нейросеть не успела ответить за 3 секунды. Повторите запрос еще раз.",
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
