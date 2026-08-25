chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'export-current-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'DUNI_EXPORT_MARKDOWN', mode: 'page' });
    if (!result?.ok) return;
    const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(result.markdown)}`;
    await chrome.downloads.download({ url: dataUrl, filename: result.filename, saveAs: true });
  } catch {
    // Chrome blocks extensions on internal pages and the Web Store.
  }
});
