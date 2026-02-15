// Article Accuracy Checker - Content Script
// Extracts article text and displays accuracy score from Gemini

const ACCURACY_BOX_ID = 'article-accuracy-box';

// Common selectors for article body on news sites (Al Jazeera, Fox, CNN, etc.)
const ARTICLE_SELECTORS = [
  'article',
  '[role="article"]',
  '.article-body',
  '.article__body',
  '.post-content',
  '.entry-content',
  '.content-body',
  '.story-body',
  '.article-content',
  'main article',
  '.ArticleBody',
  '.article-body__content',
  '[data-testid="article-body"]',
  '.wysiwyg',
  '.rich-text',
  '.post__content',
  '.story-content',
  '.js-article__body',
  '.article__content',
  '.article-body-content',
  '.article__body',
  '.article-body-text',
  '.content__body',
  '.article__main',
  '.story-body__inner',
  '.article-body-wrapper',
  '.Prose',
  '.prose'
];

function getArticleText() {
  for (const selector of ARTICLE_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 200) return text;
    }
  }
  // Fallback: get all paragraph text from main content area
  const main = document.querySelector('main') || document.body;
  const paragraphs = main.querySelectorAll('p');
  const parts = [];
  for (const p of paragraphs) {
    const t = p.innerText?.trim();
    if (t && t.length > 50) parts.push(t);
  }
  const text = parts.join('\n\n');
  return text.length > 200 ? text : null;
}

function createScoreBox() {
  let box = document.getElementById(ACCURACY_BOX_ID);
  if (box) return box;

  box = document.createElement('div');
  box.id = ACCURACY_BOX_ID;
  box.className = 'accuracy-box accuracy-box--hidden';
  box.innerHTML = `
    <div class="accuracy-box__header">
      <span class="accuracy-box__title">Accuracy score</span>
      <button type="button" class="accuracy-box__close" aria-label="Close">&times;</button>
    </div>
    <div class="accuracy-box__body">
      <div class="accuracy-box__score-wrap">
        <span class="accuracy-box__score" id="accuracy-score-value">—</span>
        <span class="accuracy-box__max">/ 10</span>
      </div>
      <p class="accuracy-box__hint">10 = misinfo-free</p>
      <p class="accuracy-box__status" id="accuracy-status"></p>
    </div>
  `;

  box.querySelector('.accuracy-box__close').addEventListener('click', () => {
    box.classList.add('accuracy-box--hidden');
  });

  document.body.appendChild(box);
  return box;
}

function showScore(score, statusText) {
  const box = createScoreBox();
  const scoreEl = document.getElementById('accuracy-score-value');
  const statusEl = document.getElementById('accuracy-status');

  if (score !== null && score !== undefined) {
    scoreEl.textContent = score;
    scoreEl.className = 'accuracy-box__score accuracy-box__score--set';
    const level = score >= 8 ? 'high' : score >= 5 ? 'medium' : 'low';
    box.classList.remove('accuracy-box--high', 'accuracy-box--medium', 'accuracy-box--low');
    box.classList.add(`accuracy-box--${level}`);
  } else {
    scoreEl.textContent = '—';
    scoreEl.className = 'accuracy-box__score';
  }

  if (statusEl) statusEl.textContent = statusText || '';
  box.classList.remove('accuracy-box--hidden');
}

function showError(message) {
  showScore(null, message);
}

function setStatus(text) {
  const statusEl = document.getElementById('accuracy-status');
  if (statusEl) statusEl.textContent = text;
}

// Listen for messages from popup (when user clicks "Check this article")
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'checkArticle') {
    const text = getArticleText();
    if (!text) {
      showError('Could not find article text on this page.');
      sendResponse({ ok: false, error: 'No article text' });
      return true;
    }

    const box = createScoreBox();
    box.classList.remove('accuracy-box--hidden');
    setStatus('Analyzing…');

    chrome.runtime.sendMessage(
      { action: 'analyzeArticle', text },
      (response) => {
        if (chrome.runtime.lastError) {
          showError('Extension error. Check API key in extension popup.');
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (response?.ok && typeof response.score === 'number') {
          showScore(response.score, response.summary || '');
          sendResponse({ ok: true, score: response.score });
        } else {
          showError(response?.error || 'Analysis failed.');
          sendResponse({ ok: false, error: response?.error });
        }
      }
    );
    return true; // keep channel open for async sendResponse
  }
  return false;
});

