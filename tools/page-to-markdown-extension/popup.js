const statusNode = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];

function setBusy(busy, message = '', error = false) {
  buttons.forEach((button) => { button.disabled = busy; });
  statusNode.textContent = message;
  statusNode.classList.toggle('error', error);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Không tìm thấy tab hiện tại.');
  if (!/^https?:/i.test(tab.url || '')) throw new Error('Chrome không cho phép đọc trang này.');
  return tab;
}

async function extract(mode) {
  const tab = await activeTab();
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'DUNI_EXPORT_MARKDOWN', mode });
  if (!result?.ok) throw new Error(result?.error || 'Không thể đọc nội dung trang.');
  return result;
}

function download(markdown, filename) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
}

async function run(mode, action) {
  try {
    setBusy(true, 'Đang đọc trang…');
    const result = await extract(mode);
    if (action === 'copy') {
      await navigator.clipboard.writeText(result.markdown);
      setBusy(false, `Đã sao chép ${result.markdown.length.toLocaleString('vi-VN')} ký tự.`);
    } else {
      download(result.markdown, result.filename);
      setBusy(false, 'Đã tạo file Markdown.');
    }
  } catch (error) {
    setBusy(false, error instanceof Error ? error.message : String(error), true);
  }
}

document.querySelector('#export-page').addEventListener('click', () => run('page', 'download'));
document.querySelector('#export-selection').addEventListener('click', () => run('selection', 'download'));
document.querySelector('#copy-page').addEventListener('click', () => run('page', 'copy'));
