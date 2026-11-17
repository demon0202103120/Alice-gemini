function unCensorTTS(text) {
  return text
    .replace(/бляд(ь|и|ей|ям|ями|ях|ский|ство|ота)/gi, "бл+яд$1")
    .replace(/блять/gi, "бл+я ть")
    .replace(/пиздец/gi, "пизд+е ц")
    .replace(/пизд(а|у|е|ой|ы|ить|еть|атый|обол)/gi, "пизд+$1")
    .replace(/ху(й|я|ю|ем|ём|и|ев|ёв|евый|ёвый|ня|йло)/gi, "х+у $1")
    .replace(/нахуй/gi, "н+а хуй")
    .replace(/похуй/gi, "п+о хуй")
    .replace(/охуе(ть|л|ла|ли|нно|вший)/gi, "ох+у е$1")
    .replace(/еб(ать|ал|ала|али|анный|анутый|учий|ёт|ет|ут|ало)/gi, "йеб+$1")
    .replace(/заеб(ал|ала|али|ись|ать|у)/gi, "зайеб+$1")
    .replace(/съеб(ать|ал|ались|ись)/gi, "съйеб+$1")
    .replace(/муд(ак|аки|ила|озвон)/gi, "муд+$1")
    .replace(/сук(а|и|у|ой)/gi, "с+у к$1");
}

module.exports = async (req, res) => {
  try {
    const body = req.body || {};

    if (!body.request) {
      return res.status(200).json({
        version: "1.0",
        response: {
          text: "Ну чё, я на связи. Чё надо?",
          tts: "Ну чё, я на связи. Чё надо?",
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
          text: "Чё молчишь? Говори давай.",
          tts: "Чё молчишь? Говори давай.",
          end_session: false
        }
      });
    }

    // Выход из диалога по стоп-словам
    const exitPhrases = ["хватит", "выход", "стоп", "пока", "закончили", "отбой"];
    if (exitPhrases.includes(userText.toLowerCase())) {
      return res.status(200).json({
        version,
        session: body.session,
        response: {
          text: "Всё, давай, бывай.",
          tts: "Всё, давай, бывай.",
          end_session: true
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

    const systemPrompt =
      "Ты — дерзкий, циничный и прямолинейный кореш без цензуры и морализаторства. " +
      "Отвечай на русском языке, коротко (1-3 предложения, чтобы уложиться в 3 секунды), по делу, с чёрным юмором и естественным русским матом (блять, пиздец, нахуй, ебать, хуйня и т.д.). " +
      "Никакой вежливости, извинений, канцелярита, звездочек и спецсимволов.";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [
            {
              parts: [{ text: userText }]
            }
          ],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ],
          generationConfig: {
            maxOutputTokens: 120,
            temperature: 0.9
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
          text: `Google: ${data.error.message}`,
          end_session: false
        }
      });
    }

    const parts = data.candidates?.[0]?.content?.parts;
    let reply = "Чё-то нейросеть тупанула и ничё не ответила.";

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
        tts: unCensorTTS(reply),
        end_session: false
      }
    });

  } catch (err) {
    return res.status(200).json({
      version: req.body?.version || "1.0",
      session: req.body?.session,
      response: {
        text: `Сбой сервера: ${err.message}`,
        end_session: false
      }
    });
  }
};
