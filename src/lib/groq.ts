import "dotenv/config";
import { SUMMARY_PROMPT, ensureCompleteSentence } from "./prompt.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_RETRIES = 4;
const GROQ_MODEL = "qwen/qwen3.8-27b";

export async function summarize(
  title: string,
  rawSummary: string,
  systemPrompt: string = SUMMARY_PROMPT
): Promise<string> {
  const url = "https://api.groq.com/openai/v1/chat/completions";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Заголовок: ${title}\n\nТекст: ${rawSummary}` },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      if (attempt < MAX_RETRIES) {
        await sleep(1000);
        continue;
      }
      throw new Error("Groq вернул пустой ответ");
    }
    return ensureCompleteSentence(text);
  }

  throw new Error("Groq: превышено число повторов");
}
