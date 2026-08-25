(() => {
  if (globalThis.__duniMarkdownExporterInstalled) return;
  globalThis.__duniMarkdownExporterInstalled = true;

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'HGROUP', 'HR', 'MAIN', 'NAV', 'P',
    'SECTION', 'SUMMARY', 'TABLE'
  ]);

  function visible(element) {
    if (!(element instanceof Element)) return true;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function bestRoot() {
    const dialogs = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"], .modal.show, .modal[style]')]
      .filter(visible)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
      });
    if (dialogs[0]) return dialogs[0];

    const candidates = [...document.querySelectorAll('main, article, [role="main"]')]
      .filter(visible)
      .sort((a, b) => (b.innerText?.length || 0) - (a.innerText?.length || 0));
    return candidates[0] || document.body;
  }

  function normalizeText(value) {
    return String(value || '').replace(/[\t\r\n ]+/g, ' ');
  }

  function escapeInline(value) {
    return normalizeText(value).replace(/([\\`*_[\]<>])/g, '\\$1');
  }

  function absoluteUrl(value) {
    try { return new URL(value, document.baseURI).href; } catch { return value || ''; }
  }

  function tableMarkdown(table) {
    const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')]
      .filter(visible)
      .map((row) => [...row.querySelectorAll(':scope > th, :scope > td')]
        .map((cell) => normalizeText(cell.innerText).replace(/\|/g, '\\|').trim()))
      .filter((row) => row.some(Boolean));
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
    const lines = [
      `| ${normalized[0].join(' | ')} |`,
      `| ${Array(width).fill('---').join(' | ')} |`,
      ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`)
    ];
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function childrenMarkdown(node, context) {
    return [...node.childNodes].map((child) => nodeMarkdown(child, context)).join('');
  }

  function nodeMarkdown(node, context = {}) {
    if (node.nodeType === Node.TEXT_NODE) return escapeInline(node.nodeValue);
    if (!(node instanceof Element) || !visible(node)) return '';
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME'].includes(node.tagName)) return '';

    const tag = node.tagName;
    const inner = childrenMarkdown(node, context).trim();
    if (/^H[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`;
    if (tag === 'BR') return '  \n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'STRONG' || tag === 'B') return inner ? `**${inner}**` : '';
    if (tag === 'EM' || tag === 'I') return inner ? `_${inner}_` : '';
    if (tag === 'DEL' || tag === 'S') return inner ? `~~${inner}~~` : '';
    if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') return inner ? `\`${normalizeText(node.textContent).replace(/`/g, '\\`')}\`` : '';
    if (tag === 'PRE') {
      const code = String(node.textContent || '').replace(/^\n|\n$/g, '');
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
    }
    if (tag === 'A') {
      const href = absoluteUrl(node.getAttribute('href'));
      return href ? `[${inner || href}](${href})` : inner;
    }
    if (tag === 'IMG') {
      const src = absoluteUrl(node.getAttribute('src'));
      const alt = escapeInline(node.getAttribute('alt') || 'image');
      return src ? `![${alt}](${src})` : '';
    }
    if (tag === 'TABLE') return tableMarkdown(node);
    if (tag === 'BLOCKQUOTE') return `\n\n${inner.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'UL' || tag === 'OL') {
      const ordered = tag === 'OL';
      const items = [...node.children].filter((child) => child.tagName === 'LI' && visible(child));
      return `\n${items.map((item, index) => {
        const content = childrenMarkdown(item, { ...context, inList: true }).trim().replace(/\n{3,}/g, '\n\n');
        return `${ordered ? `${index + 1}.` : '-'} ${content.replace(/\n/g, '\n  ')}`;
      }).join('\n')}\n`;
    }
    if (tag === 'LI') return inner;
    if (tag === 'INPUT') {
      const type = node.getAttribute('type');
      if (type === 'checkbox') return node.checked ? '[x]' : '[ ]';
      return escapeInline(node.value || node.getAttribute('placeholder') || '');
    }
    if (tag === 'TEXTAREA') return `\n\n\`\`\`\n${node.value}\n\`\`\`\n\n`;
    if (tag === 'SELECT') return escapeInline(node.selectedOptions?.[0]?.textContent || '');
    if (tag === 'BUTTON') return inner ? `**${inner}**` : '';

    if (BLOCK_TAGS.has(tag)) return inner ? `\n\n${inner}\n\n` : '';
    return inner;
  }

  function selectionRoot() {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return null;
    const holder = document.createElement('div');
    for (let index = 0; index < selection.rangeCount; index += 1) holder.append(selection.getRangeAt(index).cloneContents());
    holder.style.cssText = 'position:fixed;left:0;top:0;visibility:visible;display:block;width:1000px;height:auto;z-index:-1';
    document.documentElement.append(holder);
    return holder;
  }

  function clean(markdown) {
    return markdown
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\\([<>])/g, '$1');
  }

  function safeFilename(title) {
    const cleanTitle = String(title || 'page')
      .normalize('NFKD')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'page';
    const now = new Date();
    const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    return `${cleanTitle} ${stamp}.md`;
  }

  function exportMarkdown(mode) {
    let root;
    let temporary = false;
    if (mode === 'selection') {
      root = selectionRoot();
      temporary = Boolean(root);
      if (!root) throw new Error('Bạn chưa chọn phần văn bản nào trên trang.');
    } else {
      root = bestRoot();
    }
    const body = clean(nodeMarkdown(root));
    if (temporary) root.remove();
    if (!body) throw new Error('Không tìm thấy nội dung có thể xuất.');

    const title = document.title || location.hostname;
    const header = `# ${title}\n\nNguồn: [${location.href}](${location.href})\n\nXuất lúc: ${new Date().toLocaleString('vi-VN')}\n\n---\n\n`;
    return { markdown: header + body + '\n', filename: safeFilename(title) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'DUNI_EXPORT_MARKDOWN') return;
    try {
      sendResponse({ ok: true, ...exportMarkdown(message.mode) });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
})();
