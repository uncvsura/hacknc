// Article Accuracy Checker - Background Service Worker
// Calls Gemini API to analyze article text for accuracy/misinformation

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
// Models to try in order (first with free-tier quota; fallback if not found)
const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash",
];

const SYSTEM_PROMPT = `You are an expert fact-checker and media analyst. Your task is to evaluate a news article for accuracy and potential misinformation.

Consider:
- Whether claims are verifiable or speculative
- Use of loaded language, exaggeration, or one-sided framing
- Omission of important context that could change the meaning
- Consistency with widely accepted facts and established reporting
- Sensationalism vs. measured tone
- Today is feb 16 2026
- Comparison to reputable sources
Respond in this exact format only (no other text):
SCORE: [integer from 1 to 10]
SUMMARY: [your full explanation in one or two sentences]

Where 10 = no significant misinformation, factual and balanced; 1 = highly misleading or containing clear misinformation.`;

function buildPrompt(articleText) {
  const truncated =
    articleText.length > 28000
      ? articleText.slice(0, 28000) + "\n\n[Article truncated...]"
      : articleText;
  return `${SYSTEM_PROMPT}\n\n---\n\nARTICLE TO EVALUATE:\n\n${truncated}`;
}

function parseGeminiResponse(text) {
  if (!text || typeof text !== "string") return { score: null, summary: "" };
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch
    ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)))
    : null;
  // Capture everything after "SUMMARY:" to end of response (full summary, no truncation)
  const summaryLabel = text.match(/\bSUMMARY:\s*/i);
  let summary = "";
  if (summaryLabel) {
    const start = text.indexOf(summaryLabel[0]) + summaryLabel[0].length;
    summary = text.slice(start).trim().replace(/\s+/g, " ");
  }
  return { score, summary };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "analyzeArticle" || !message.text) {
    sendResponse({ ok: false, error: "Missing action or text" });
    return;
  }

  (async () => {
    const { apiKey } = await chrome.storage.sync.get("apiKey");
    if (!apiKey || !apiKey.trim()) {
      return { ok: false, error: "No API key. Set it in the extension popup." };
    }

    const body = {
      contents: [{ parts: [{ text: buildPrompt(message.text) }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    };

    let lastError = "";
    for (const model of MODELS_TO_TRY) {
      try {
        const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          let errMsg =
            data?.error?.message || data?.error || `HTTP ${res.status}`;
          if (res.status === 429 || /quota|rate limit|limit: 0/i.test(errMsg)) {
            const retryMatch = errMsg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
            const secs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
            lastError = `Rate limit reached. Try again in ${secs} seconds. See ai.google.dev/gemini-api/docs/rate-limits`;
            break; // don't try other models on quota
          }
          if (/not found|not supported/i.test(errMsg)) {
            lastError = errMsg;
            continue; // try next model
          }
          return { ok: false, error: errMsg };
        }

        const candidate = data?.candidates?.[0];
        const content = candidate?.content?.parts?.[0]?.text;
        if (!content) {
          return { ok: false, error: "Empty or invalid response from Gemini" };
        }

        const { score, summary } = parseGeminiResponse(content);
        if (score === null) {
          return { ok: false, error: "Could not parse score from response" };
        }

        return { ok: true, score, summary };
      } catch (e) {
        lastError = e.message || "Network or request failed";
      }
    }
    return { ok: false, error: lastError || "All models failed" };
  })()
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: "Unexpected error" }));

  return true; // keep message channel open for async sendResponse
});

