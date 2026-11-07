// Глобальный кеш в оперативной памяти сервера (живет между быстрыми запросами)
const cache = new Map();

// Функция обращения к Gemini без жесткого обрыва соединения
async function askGemini(promptText, apiKey) {
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
                text: `Ответь кратко (1-2 предложения), на русском, для чтения вслух без спецсимволов: ${promptText}`
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 90,
          temperature: 0.6,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      })
    }
  );

  const data = await response.json();

  if (data.error) {
    return `Ошибка Google: ${data.error.message}`;
  }

  if (data.candidates?.[0]?.content?.parts) {
    const parts = data.candidates[0].content.parts;
    const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
    let reply = (textPart ? textPart.text : "Пустой ответ от модели.").replace(/[*#_`]/g, "").trim();
    if (reply.length > 950) reply = reply.slice(0, 950) + "...";
    return reply;
  }

  return "Не удалось разобрать ответ нейросети.";
}

module.exports = async (req, res) => {
  // 1. Технические пинги и запуск навыка
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

  // 2. Если пользователь просит дослушать отложенный ответ ("дальше")
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
      // Если ответ еще доделывается, ждем его еще до 2.2 сек
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
          text: "Еще буквально секунду, скажите: дальше.",
          end_session: false
        }
      });
    }
  }

  // 3. Запускаем новый запрос к Gemini
  const taskRecord = { status: "pending", reply: null, promise: null };

  const geminiPromise = askGemini(userText, apiKey)
    .then(reply => {
      taskRecord.status = "done";
      taskRecord.reply = reply;
      return reply;
    })
    .catch(err => {
      const errText = `Сбой связи: ${err.message}`;
      taskRecord.status = "done";
      taskRecord.reply = errText;
      return errText;
    });

  taskRecord.promise = geminiPromise;
  cache.set(sessionId, taskRecord);

  // Не даем Vercel "убить" фоновый процесс после отправки промежуточного ответа Яндексу
  try {
    const { waitUntil } = require("@vercel/functions");
    if (waitUntil) waitUntil(geminiPromise);
  } catch (e) {
    // В стандартной среде Node на Vercel промис продолжает жить в теплом инстансе
  }

  // Гонка: ждем ответ от Google максимум 2.35 секунды
  const timeoutPromise = new Promise(resolve => setTimeout(() => resolve("TIMEOUT"), 2350));
  const raceResult = await Promise.race([geminiPromise, timeoutPromise]);

  // Вариант А: Нейросеть успела ответить за 2.35 сек — отдаем ответ сразу!
  if (raceResult !== "TIMEOUT") {
    cache.delete(sessionId);
    return res.status(200).json({
      version: req.body.version,
      session: req.body.session,
      response: {
        text: raceResult,
        end_session: false
      }
    });
  }

  // Вариант Б: Нейросеть думает дольше 2.35 сек — успокаиваем Яндекс, а ответ дозревает в фоне
  return res.status(200).json({
    version: req.body.version,
    session: req.body.session,
    response: {
      text: "Генерирую ответ... Скажите «дальше» через секунду.",
      buttons: [{ title: "Дальше", hide: true }],
      end_session: false
    }
  });
};
