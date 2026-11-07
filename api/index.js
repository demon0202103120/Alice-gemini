module.exports = async (req, res) => {
  // Проверка на пустые запросы или пинги от Яндекса
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

  // Если пользователь запустил навык и молчит
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

  // Проверка наличия ключа в переменных окружения
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

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Ответь кратко, понятно для голосового ответа на слух, без спецсимволов и звездочек (до 2-3 предложений): ${userText}`
                }
              ]
            }
          ],
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })
      }
    );

    const data = await response.json();

    let reply = "";

    // Если Google вернул ошибку — выводим ее текст для диагностики
    if (data.error) {
      reply = `Ошибка Google: ${data.error.message || JSON.stringify(data.error)}`;
    } else if (data.candidates?.[0]?.content?.parts) {
      // Ищем часть с текстом (исключая технические мысли thinking)
      const parts = data.candidates[0].content.parts;
      const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
      reply = textPart ? textPart.text : "Ответ от нейросети пуст.";
    } else {
      reply = `Неожиданный ответ Google: ${JSON.stringify(data).slice(0, 200)}`;
    }

    // Очищаем текст от разметки Markdown
    reply = reply.replace(/[*#_`]/g, "");

    // Обрезаем ответ под лимит Яндекс Диалогов (1000 символов)
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
