document.getElementById('check').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'checkArticle' }, (response) => {
    if (chrome.runtime.lastError) {
      alert('Open a news article page first, then click "Check this article" again.');
      return;
    }
    if (response && !response.ok) {
      alert(response.error || 'Check failed.');
      return;
    }
    window.close();
  });
});
