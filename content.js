// Article Accuracy Checker - Content Script
// Extracts article text and displays accuracy score from Gemini

const ACCURACY_BOX_ID = "article-accuracy-box";
const ACCURACY_BOX_TAB_ID = "accuracy-box-tab";
const FACT_CHECK_PROMPT_ID = "fact-check-prompt";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Common selectors for article body on news sites (Al Jazeera, Fox, CNN, etc.)
const ARTICLE_SELECTORS = [
  "article",
  '[role="article"]',
  ".article-body",
  ".article__body",
  ".post-content",
  ".entry-content",
  ".content-body",
  ".story-body",
  ".article-content",
  "main article",
  ".ArticleBody",
  ".article-body__content",
  '[data-testid="article-body"]',
  ".wysiwyg",
  ".rich-text",
  ".post__content",
  ".story-content",
  ".js-article__body",
  ".article__content",
  ".article-body-content",
  ".article__body",
  ".article-body-text",
  ".content__body",
  ".article__main",
  ".story-body__inner",
  ".article-body-wrapper",
  ".Prose",
  ".prose",
];

function getArticleElement() {
  for (const selector of ARTICLE_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 200) return el;
    }
  }
  const main = document.querySelector("main") || document.body;
  if (main && main.querySelectorAll("p").length > 0) return main;
  return null;
}

function getArticleText() {
  for (const selector of ARTICLE_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 200) return text;
    }
  }
  const main = document.querySelector("main") || document.body;
  const paragraphs = main.querySelectorAll("p");
  const parts = [];
  for (const p of paragraphs) {
    const t = p.innerText?.trim();
    if (t && t.length > 50) parts.push(t);
  }
  const text = parts.join("\n\n");
  return text.length > 200 ? text : null;
}

function createFactCheckPrompt() {
  let prompt = document.getElementById(FACT_CHECK_PROMPT_ID);
  if (prompt) return prompt;
  prompt = document.createElement("div");
  prompt.id = FACT_CHECK_PROMPT_ID;
  prompt.className = "fact-check-prompt";
  prompt.innerHTML = `
      <div class="fact-check-prompt__actions">
        <p class="fact-check-label">Fact Check?</p>
        <button type="button" class="fact-check-prompt__btn" id="fact-check-yes">Yes, check it</button>
        <button type="button" class="fact-check-prompt__btn fact-check-prompt__btn--secondary" id="fact-check-no">Not now</button>
      </div>
    `;
  document.body.appendChild(prompt);
  return prompt;
}

function showFactCheckPrompt() {
  const prompt = createFactCheckPrompt();
  prompt.classList.remove("fact-check-prompt--hidden");
  const yesBtn = document.getElementById("fact-check-yes");
  const noBtn = document.getElementById("fact-check-no");
  if (yesBtn && !yesBtn._bound) {
    yesBtn._bound = true;
    yesBtn.addEventListener("click", () => {
      prompt.classList.add("fact-check-prompt--hidden");
      runArticleCheck();
    });
  }
  if (noBtn && !noBtn._bound) {
    noBtn._bound = true;
    noBtn.addEventListener("click", () => {
      prompt.classList.add("fact-check-prompt--hidden");
    });
  }
}

function runArticleCheck(optCallback) {
  const text = getArticleText();
  if (!text) {
    showError("Could not find article text on this page.");
    if (optCallback) optCallback({ ok: false, error: "No article text" });
    return;
  }
  const box = createScoreBox();
  box.classList.remove("accuracy-box--hidden", "accuracy-box--minimized");
  const tab = document.getElementById(ACCURACY_BOX_TAB_ID);
  if (tab) tab.classList.remove("accuracy-box-tab--visible");
  setStatus("Analyzing…");
  chrome.runtime.sendMessage({ action: "analyzeArticle", text }, (response) => {
    if (chrome.runtime.lastError) {
      showError("Extension error. Check API key in background.js.");
      if (optCallback)
        optCallback({ ok: false, error: chrome.runtime.lastError?.message });
      return;
    }
    if (response?.ok && typeof response.score === "number") {
      showScore(
        response.score,
        response.summary || "",
        response.bias ?? null,
        response.quotes ?? [],
      );
      if (optCallback) optCallback({ ok: true, score: response.score });
    } else {
      showError(response?.error || "Analysis failed.");
      if (optCallback) optCallback({ ok: false, error: response?.error });
    }
  });
}

const HIGHLIGHT_TOOLTIP_ID = "veracity-highlight-tooltip";

function ensureHighlightTooltip() {
  let tip = document.getElementById(HIGHLIGHT_TOOLTIP_ID);
  if (!tip) {
    tip = document.createElement("div");
    tip.id = HIGHLIGHT_TOOLTIP_ID;
    tip.className = "veracity-highlight-tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}

function highlightQuotesInArticle(quotes) {
  const articleEl = getArticleElement();
  if (!articleEl || !quotes || quotes.length === 0) return;

  const normalized = quotes
    .map((q) => {
      const item =
        typeof q === "string"
          ? { text: q.trim(), reason: "Flagged as potentially problematic." }
          : {
              text: (q.text || "").trim(),
              reason: q.reason || "Flagged as potentially problematic.",
            };
      return { ...item, search: item.text.replace(/\s+/g, " ").trim() };
    })
    .filter((q) => q.search.length > 0);

  articleEl.querySelectorAll(".veracity-highlight").forEach((span) => {
    const parent = span.parentNode;
    parent.replaceChild(document.createTextNode(span.textContent), span);
    parent.normalize();
  });

  const tooltipEl = ensureHighlightTooltip();
  const showTip = (e, reason) => {
    tooltipEl.textContent = reason;
    tooltipEl.classList.add("veracity-highlight-tooltip--visible");
    tooltipEl.style.left = `${e.clientX}px`;
    tooltipEl.style.top = `${e.clientY + 14}px`;
  };
  const hideTip = () =>
    tooltipEl.classList.remove("veracity-highlight-tooltip--visible");

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const wrapped = new Set();
  for (const { text, reason, search } of normalized) {
    if (wrapped.has(search)) continue;
    const walker = document.createTreeWalker(
      articleEl,
      NodeFilter.SHOW_TEXT,
      null,
      false,
    );
    let node;
    while ((node = walker.nextNode())) {
      const content = node.textContent;
      let idx = content.indexOf(search);
      let match = idx >= 0 ? content.slice(idx, idx + search.length) : "";
      if (idx === -1) {
        const pattern = escapeRegex(search).replace(/\s+/g, "\\s+");
        const re = new RegExp(pattern);
        const m = content.match(re);
        if (m) {
          idx = m.index;
          match = m[0];
        }
      }
      if (idx === -1 || !match) continue;
      const parent = node.parentNode;
      if (!parent || parent.closest(".veracity-highlight")) continue;
      const before = content.slice(0, idx);
      const after = content.slice(idx + match.length);
      const span = document.createElement("span");
      span.className = "veracity-highlight";
      span.textContent = match;
      span.setAttribute("data-reason", reason);
      span.setAttribute("title", reason);
      span.addEventListener("mouseenter", (e) => showTip(e, reason));
      span.addEventListener("mousemove", (e) => {
        tooltipEl.style.left = `${e.clientX}px`;
        tooltipEl.style.top = `${e.clientY + 14}px`;
      });
      span.addEventListener("mouseleave", hideTip);
      const fragment = document.createDocumentFragment();
      if (before) fragment.appendChild(document.createTextNode(before));
      fragment.appendChild(span);
      if (after) fragment.appendChild(document.createTextNode(after));
      parent.replaceChild(fragment, node);
      wrapped.add(search);
      break;
    }
  }
}

function createScoreBox() {
  let box = document.getElementById(ACCURACY_BOX_ID);
  if (box) return box;

  box = document.createElement("div");
  box.id = ACCURACY_BOX_ID;
  box.className = "accuracy-box accuracy-box--hidden";
  box.innerHTML = `
      <div class="accuracy-box__header">
        <span class="accuracy-box__title">Fact check</span>
        <button type="button" class="accuracy-box__hide" aria-label="Hide">Hide</button>
      </div>
      <div class="accuracy-box__body">
        <div class="accuracy-box__gauges">
          <div class="accuracy-box__gauge-wrap">
          <div class="accuracy-box__gauge accuracy-box__gauge--accuracy" id="accuracy-gauge">
            <div class="accuracy-box__gauge-inner">
              <span class="accuracy-box__gauge-value" id="accuracy-score-value">—</span>
            </div>
          </div>
            <span class="accuracy-box__gauge-label">Factual accuracy</span>
          </div>
          <div class="accuracy-box__gauge-wrap">
            <div class="accuracy-box__gauge accuracy-box__gauge--bias" id="bias-gauge">
              <div class="accuracy-box__gauge-inner">
                <span class="accuracy-box__gauge-value accuracy-box__gauge-value--bias" id="bias-value">—</span>
              </div>
            </div>
            <span class="accuracy-box__gauge-label">Bias</span>
          </div>
        </div>
        <button type="button" class="accuracy-box__read-more" id="accuracy-read-more">Read more</button>
        <div class="accuracy-box__summary-wrap" id="accuracy-summary-wrap">
          <p class="accuracy-box__status accuracy-box__status--hoverable" id="accuracy-status" title="Hover for details"></p>
          <div class="accuracy-box__tooltip" id="accuracy-tooltip" role="tooltip"></div>
        </div>
        <div class="accuracy-box__quotes-wrap">
          <span class="accuracy-box__quotes-title">False or biased quotes</span>
          <div class="accuracy-box__quotes" id="accuracy-quotes"></div>
        </div>
        <p class="accuracy-box__hint">→ Hover over the summary for details</p>
      </div>
    `;

  box.querySelector(".accuracy-box__hide").addEventListener("click", () => {
    box.classList.add("accuracy-box--minimized");
    const tab = document.getElementById(ACCURACY_BOX_TAB_ID);
    if (tab) tab.classList.add("accuracy-box-tab--visible");
  });

  let tab = document.getElementById(ACCURACY_BOX_TAB_ID);
  if (!tab) {
    tab = document.createElement("button");
    tab.type = "button";
    tab.id = ACCURACY_BOX_TAB_ID;
    tab.className = "accuracy-box-tab";
    tab.setAttribute("aria-label", "Show fact check");
    tab.textContent = "Veracity";
    tab.addEventListener("click", () => {
      box.classList.remove("accuracy-box--minimized");
      tab.classList.remove("accuracy-box-tab--visible");
    });
    document.body.appendChild(tab);
  }

  const readMoreBtn = box.querySelector("#accuracy-read-more");
  const summaryWrap = box.querySelector("#accuracy-summary-wrap");
  const statusEl = box.querySelector("#accuracy-status");
  const tooltipEl = box.querySelector("#accuracy-tooltip");

  readMoreBtn.addEventListener("click", () => {
    const boxEl = document.getElementById(ACCURACY_BOX_ID);
    const isOpen = boxEl.classList.toggle("accuracy-box--details-open");
    readMoreBtn.textContent = isOpen ? "Show less" : "Read more";
    if (isOpen)
      summaryWrap.classList.add("accuracy-box__summary-wrap--expanded");
  });

  function showTooltip(text) {
    if (!text) return;
    tooltipEl.textContent = text;
    tooltipEl.classList.add("accuracy-box__tooltip--visible");
  }
  function hideTooltip() {
    tooltipEl.classList.remove("accuracy-box__tooltip--visible");
  }
  function positionTooltip(e) {
    const offset = 12;
    tooltipEl.style.left = `${e.clientX - offset}px`;
    tooltipEl.style.top = `${e.clientY - offset}px`;
  }
  statusEl.addEventListener("mouseenter", (e) => {
    showTooltip(statusEl.textContent);
    positionTooltip(e);
  });
  statusEl.addEventListener("mousemove", positionTooltip);
  statusEl.addEventListener("mouseleave", hideTooltip);

  document.body.appendChild(box);
  return box;
}

function showScore(score, statusText, bias, quotes) {
  const box = createScoreBox();
  const scoreEl = document.getElementById("accuracy-score-value");
  const gaugeEl = document.getElementById("accuracy-gauge");
  const biasValEl = document.getElementById("bias-value");
  const statusEl = document.getElementById("accuracy-status");
  const quotesEl = document.getElementById("accuracy-quotes");

  if (score !== null && score !== undefined) {
    const pct = Math.round((score / 10) * 100);
    scoreEl.textContent = score;
    const level = score >= 8 ? "high" : score >= 4 ? "medium" : "low";
    box.classList.remove(
      "accuracy-box--high",
      "accuracy-box--medium",
      "accuracy-box--low",
    );
    box.classList.add(`accuracy-box--${level}`);
    if (gaugeEl) {
      gaugeEl.style.setProperty("--gauge-value", "0");
      gaugeEl.classList.add("accuracy-box__gauge--animating");
      let step = 0;
      const segmentPct = 10;
      const segmentMs = 85;
      const steps = Math.ceil(pct / segmentPct);
      const interval = setInterval(() => {
        step += 1;
        const value = Math.min(step * segmentPct, pct);
        gaugeEl.style.setProperty("--gauge-value", String(value));
        if (value >= pct) {
          clearInterval(interval);
          gaugeEl.classList.remove("accuracy-box__gauge--animating");
        }
      }, segmentMs);
    }
  } else {
    scoreEl.textContent = "—";
    if (gaugeEl) gaugeEl.style.removeProperty("--gauge-value");
  }

  const biasGaugeEl = document.getElementById("bias-gauge");
  if (biasGaugeEl) {
    biasGaugeEl.classList.remove(
      "accuracy-box__gauge--bias-left",
      "accuracy-box__gauge--bias-center",
      "accuracy-box__gauge--bias-right",
    );
  }
  if (bias && bias.leaning) {
    const lean = (bias.leaning || "").toLowerCase();
    const label = /left/.test(lean)
      ? "Left"
      : /right/.test(lean)
        ? "Right"
        : "Center";
    biasValEl.textContent = label;
    biasValEl.className =
      "accuracy-box__gauge-value accuracy-box__gauge-value--bias accuracy-box__gauge-value--set";
    if (biasGaugeEl) {
      if (/left/.test(lean))
        biasGaugeEl.classList.add("accuracy-box__gauge--bias-left");
      else if (/right/.test(lean))
        biasGaugeEl.classList.add("accuracy-box__gauge--bias-right");
      else
        biasGaugeEl.classList.add(
          "accuracy-box__gauge--bias-center",
        ); /* center or neutral = white */
    }
  } else {
    biasValEl.textContent = "—";
    biasValEl.className =
      "accuracy-box__gauge-value accuracy-box__gauge-value--bias";
  }

  if (quotesEl) {
    if (quotes && quotes.length > 0) {
      quotesEl.innerHTML = quotes
        .map((q) => {
          const text = typeof q === "string" ? q : q.text || "";
          return `<blockquote class="accuracy-box__quote">${escapeHtml(text)}</blockquote>`;
        })
        .join("");
      quotesEl.classList.remove("accuracy-box__quotes--empty");
    } else {
      quotesEl.innerHTML =
        '<p class="accuracy-box__quotes-empty">None identified</p>';
      quotesEl.classList.add("accuracy-box__quotes--empty");
    }
  }

  highlightQuotesInArticle(quotes);

  if (statusEl) statusEl.textContent = statusText || "";
  box.classList.remove("accuracy-box--hidden");
}

function showError(message) {
  showScore(null, message, null, null);
}

function setStatus(text) {
  const statusEl = document.getElementById("accuracy-status");
  if (statusEl) statusEl.textContent = text;
}

// Show initial "Fact check this article?" prompt when an article is detected
if (getArticleText()) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showFactCheckPrompt);
  } else {
    showFactCheckPrompt();
  }
}

// Listen for messages from popup (when user clicks "Check this article")
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "checkArticle") {
    const prompt = document.getElementById(FACT_CHECK_PROMPT_ID);
    if (prompt) prompt.classList.add("fact-check-prompt--hidden");
    const box = document.getElementById(ACCURACY_BOX_ID);
    if (box) {
      box.classList.remove("accuracy-box--minimized");
      const tab = document.getElementById(ACCURACY_BOX_TAB_ID);
      if (tab) tab.classList.remove("accuracy-box-tab--visible");
    }
    runArticleCheck(sendResponse);
    return true; // keep channel open for async sendResponse
  }
  return false;
});
