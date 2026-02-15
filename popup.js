document.getElementById('save').addEventListener('click', async () => {
    const input = document.getElementById('api-key');
    const key = input.value.trim();
    await chrome.storage.sync.set({ apiKey: key });
    input.value = '';
    input.placeholder = 'Saved. You can close this.';
  });
  
  document.getElementById('check').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { action: 'checkArticle' }, () => {
      if (chrome.runtime.lastError) {
        alert('Open a news article page first, then click "Check this article" again.');
        return;
      }
      window.close();
    });
  });
  
  (async () => {
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (apiKey) {
      document.getElementById('api-key').placeholder = '•••••••• (saved)';
    }
  })();
  