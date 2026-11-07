module.exports = async (req, res) => {
  // Проверка на пустые запросы или технические пинги от Яндекса
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

  try {
    // Обращение к быстрой модели, чтобы успеть ответить Алисе за 3 секунды
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
          ]
        })
      }
    );

    const data = await response.json();
    let reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Не удалось получить ответ от нейросети.";

    // Очищаем текст от разметки Markdown, чтобы Алиса не читала спецсимволы
    reply = reply.replace(/[*#_`]/g, "");

    // Обрезаем ответ, если он превышает лимит Яндекс Диалогов
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
        text: "Произошла ошибка при связи с Gemini.",
        end_session: false
      }
    });
  }
};
