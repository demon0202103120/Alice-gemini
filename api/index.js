const cache = new Map();

async function callModel(model, promptText, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Ответь кратко (1-2 предложения), на русском, без спецсимволов и звездочек: ${promptText}` }] }],
        generationConfig: { maxOutputTokens: 90, temperature: 0.6 }
      })
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Google API Error");
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("Empty parts");
  const textPart = parts.find(p => p.text && !p.thought) || parts.find(p => p.text);
  const reply = (textPart ? textPart.text : "").replace(/[*#_`]/g, "").trim();
  if (!reply) throw new Error("Empty text");
  return reply.length > 950 ? reply.slice(0, 950) + "..." : reply;
}

async function askGeminiFast(promptText, apiKey) {
  const models = ["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
  try {
    return await Promise.any(models.map(m => callModel(m, promptText, apiKey)));
  } catch (aggregateErr) {
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
      return res.status(200).json({ version: "1.0", response: { text: "Привет! Я готова отвечать через Gemini.", end_session: false } });
    }
    const userText = (body.request.command || body.request.original_utterance || "").trim();
    const sessionId = body.session?.session_id || "default_session";
    const version = body.version || "1.0";
    const apiKey = process.env.GEMINI_API_KEY;

    if (!userText) return res.status(200).json({ version, session: body.session, response: { text: "Слушаю! О чем спросим Gemini?", end_session: false } });
    if (!apiKey) return res.status(200).json({ version, session: body.session, response: { text: "Ошибка: не задан ключ GEMINI_API_KEY в Vercel.", end_session: false } });

    const isFollowUp = ["дальше", "готово", "ну что", "продолжай", "ответ", "да", "ага"].includes(userText.toLowerCase());
    const existingTask = cache.get(sessionId);

    if (isFollowUp && existingTask) {
      if (existingTask.status === "done") {
        cache.delete(sessionId);
        return res.status(200).json({ version, session: body.session, response: { text: existingTask.reply, end_session: false } });
      }
      const result = await Promise.race([existingTask.promise, new Promise(resolve => setTimeout(() => resolve("TIMEOUT"), 2100))]);
      if (result !== "TIMEOUT") {
        cache.delete(sessionId);
        return res.status(200).json({ version, session: body.session, response: { text: result, end_session: false } });
      }
      return res.status(200).json({ version, session: body.session, response: { text: "Еще секунду, дожимаю ответ... Нажмите «Дальше».", buttons: [{ title: "Дальше", hide: true }], end_session: false } });
    }

    const taskRecord = { status: "pending", reply: null, promise: null };
    const geminiPromise = askGeminiFast(userText, apiKey).then(reply => { taskRecord.status = "done"; taskRecord.reply = reply; return reply; }).catch(err => { taskRecord.status = "done"; taskRecord.reply = `Ошибка связи: ${err.message}`; return taskRecord.reply; });
    taskRecord.promise = geminiPromise;
    cache.set(sessionId, taskRecord);

    const raceResult = await Promise.race([geminiPromise, new Promise(resolve => setTimeout(() => resolve("TIMEOUT"), 2200))]);
    if (raceResult !== "TIMEOUT") {
      cache.delete(sessionId);
      return res.status(200).json({ version, session: body.session, response: { text: raceResult, end_session: false } });
    }
    return res.status(200).json({ version, session: body.session, response: { text: "Генерирую ответ... Скажите «дальше» через секунду.", buttons: [{ title: "Дальше", hide: true }], end_session: false } });
  } catch (globalErr) {
    return res.status(200).json({ version: req.body?.version || "1.0", session: req.body?.session, response: { text: `Ошибка в коде: ${globalErr.message}`, end_session: false } });
  }
};
