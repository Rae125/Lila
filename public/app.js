// Core DOM nodes used for the downloader flow.
const form = document.getElementById('download-form');
const urlInput = document.getElementById('url-input');
const statusText = document.getElementById('status-text');
const previewCard = document.getElementById('preview-card');
const previewTitle = document.getElementById('preview-title');
const previewMeta = document.getElementById('preview-meta');
const thumb = document.getElementById('thumb');
const sourceLink = document.getElementById('source-link');
const directBtn = document.getElementById('direct-btn');
const formatNote = document.getElementById('format-note');
const formatButtons = document.querySelectorAll('.toggle-btn[data-format]');
const historyList = document.getElementById('history-list');
// View switching between downloader/history/about/news/settings.
const navButtons = document.querySelectorAll('.nav-item[data-view], .history-fab[data-view], .back-button[data-view]');
const viewSections = document.querySelectorAll('.view[data-view]');
const legalBar = document.querySelector('.legal-bar');
const historyBar = document.querySelector('.history-bar');
const legalLinks = document.querySelectorAll('.legal-link[data-view]');
const clearHistoryButton = document.getElementById('clear-history');
const toastStack = document.getElementById('toast-stack');
const aboutTabs = document.querySelectorAll('.about-tab');
const aboutSections = document.querySelectorAll('.about-section');
const defaultFormatButtons = document.querySelectorAll('[data-default-format]');
const qualityButtons = document.querySelectorAll('[data-quality]');
const safeFilenamesButton = document.getElementById('safe-filenames');
const historyModeButton = document.getElementById('history-mode');
const lightModeButton = document.getElementById('light-mode');
const newsItems = document.querySelectorAll('.news-item[data-news-page]');
const newsPrev = document.querySelector('.news-nav.is-left');
const newsNext = document.querySelector('.news-nav.is-right');
const newsPagination = document.getElementById('news-pagination');
const donateOptions = document.querySelectorAll('.donate-options [data-amount]');
const customDonateGo = document.getElementById('donate-custom-go');
let selectedDonateAmount = '10';
const customDonateInput = document.getElementById('donate-custom-amount');
let downloadCooldown = false;
let newsIndex = 0;
let selectedQuality = 'best';
let clearHistoryOnDownload = false;
const STORAGE_KEY = 'lila-settings';
const VIEW_KEY = 'lila-last-view';
let isApplyingSettings = false;

// UI state.
let selectedFormat = 'mp4';
let lastUrl = '';
let lastInfo = null;
let lastAvatar = '';

// Feedback text under the input bar.
function setStatus(text, tone = 'muted') {
  statusText.textContent = text;
  statusText.dataset.tone = tone;
  if (tone === 'error') {
    showToast('Error', text);
  }
}

// Show/hide the preview card.
function setPreviewVisible(visible) {
  previewCard.classList.toggle('is-hidden', !visible);
}

// Sync the active MP4/MP3 toggle buttons.
function setActiveFormat(format) {
  selectedFormat = format;
  formatButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.format === format);
  });
  if (!isApplyingSettings) {
    saveSettings();
  }
}

// Switch active page view and related footers.
function setActiveView(view) {
  navButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === view);
  });
  viewSections.forEach((section) => {
    section.classList.toggle('is-active', section.dataset.view === view);
  });
  document.body.classList.toggle('no-scroll', view === 'downloader');
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (_err) {
    // Ignore storage failures.
  }
  if (legalBar) {
    legalBar.style.display = view === 'downloader' ? 'inline-flex' : 'none';
  }
  if (historyBar) {
    historyBar.style.display = view === 'history' ? 'inline-flex' : 'none';
  }
}

// Keep filenames safe for OS file systems.
function sanitizeFilename(value) {
  if (safeFilenamesButton && safeFilenamesButton.getAttribute('aria-pressed') === 'false') {
    return value.replace(/[<>:\"/\\|?*]+/g, '').trim().replace(/\s+/g, ' ');
  }
  return value
    .replace(/[^\x20-\x7E]+/g, '')
    .replace(/[<>:\"/\\|?*]+/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Read persisted settings from localStorage.
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_err) {
    return {};
  }
}

// Persist current settings to localStorage.
function saveSettings() {
  try {
    const payload = {
      format: selectedFormat,
      quality: selectedQuality,
      lightMode: document.body.classList.contains('theme-light'),
      safeFilenames: safeFilenamesButton ? safeFilenamesButton.getAttribute('aria-pressed') === 'true' : true,
      autoClearHistory: clearHistoryOnDownload
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_err) {
    // Ignore storage failures (private mode, blocked storage).
  }
}

// Apply stored settings to the UI controls.
function applySettings() {
  isApplyingSettings = true;
  const settings = loadSettings();
  const format = settings.format === 'mp3' ? 'mp3' : 'mp4';
  setActiveFormat(format);
  defaultFormatButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.defaultFormat === format);
  });

  selectedQuality = settings.quality || 'best';
  qualityButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.quality === selectedQuality);
  });

  if (safeFilenamesButton) {
    const enabled = settings.safeFilenames !== false;
    safeFilenamesButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    safeFilenamesButton.textContent = enabled ? 'Enabled' : 'Disabled';
  }

  clearHistoryOnDownload = settings.autoClearHistory === true;
  if (historyModeButton) {
    historyModeButton.setAttribute('aria-pressed', clearHistoryOnDownload ? 'true' : 'false');
    historyModeButton.textContent = clearHistoryOnDownload ? 'Auto-clear' : 'Keep history';
  }

  if (settings.lightMode) {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }
  if (lightModeButton) {
    lightModeButton.setAttribute('aria-pressed', settings.lightMode ? 'true' : 'false');
    lightModeButton.textContent = settings.lightMode ? 'Enabled' : 'Disabled';
  }
  isApplyingSettings = false;
}

// Build the server streaming URL with selected options.
function buildDownloadUrl(url, format, title) {
  const safeTitle = sanitizeFilename(title || 'download') || 'download';
  const quality = encodeURIComponent(selectedQuality);
  return `/api/youtube/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format)}&quality=${quality}&title=${encodeURIComponent(safeTitle)}`;
}

// Trigger browser download via an anchor click.
function triggerDownload(downloadUrl) {
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Lightweight toast for errors and feedback.
function showToast(title, message) {
  if (!toastStack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';

  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;

  const messageEl = document.createElement('div');
  messageEl.className = 'toast-message';
  messageEl.textContent = message;

  toast.appendChild(titleEl);
  toast.appendChild(messageEl);
  toastStack.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// Basic YouTube URL guard.
function isYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch (_err) {
    return false;
  }
}

// Render a history card entry.
function addHistoryItem(info, format) {
  if (clearHistoryOnDownload) {
    historyList.innerHTML = '';
  }
  if (!info) return;
  const title = info.title || 'Untitled';

  const item = document.createElement('div');
  item.className = 'history-item';

  const thumbEl = document.createElement('div');
  thumbEl.className = 'history-thumb';
  if (info.thumbnail) {
    const proxied = `/api/thumbnail?url=${encodeURIComponent(info.thumbnail)}`;
    thumbEl.style.backgroundImage = `url("${proxied}")`;
  }

  const infoEl = document.createElement('div');
  infoEl.className = 'history-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'history-title-text';
  titleEl.textContent = title;

  const metaEl = document.createElement('div');
  metaEl.className = 'history-meta';
  metaEl.textContent = [info.uploader, info.extractor].filter(Boolean).join(' | ');

  infoEl.appendChild(titleEl);
  infoEl.appendChild(metaEl);

  const formatEl = document.createElement('div');
  formatEl.className = 'history-format';
  formatEl.textContent = format.toUpperCase();

  item.appendChild(thumbEl);
  item.appendChild(infoEl);
  item.appendChild(formatEl);

  historyList.prepend(item);
}

async function fetchJson(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    const error = data && data.error ? data.error : 'Request failed.';
    throw new Error(error);
  }
  return data;
}

async function fetchJsonGet(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    const error = data && data.error ? data.error : 'Request failed.';
    throw new Error(error);
  }
  return data;
}

// Fetch preview data and populate the preview card.
async function handlePreview(event) {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  if (!isYouTubeUrl(url)) {
    setStatus('Only YouTube links are supported right now.', 'error');
    return;
  }

  setStatus('Fetching preview...', 'muted');
  setPreviewVisible(false);
  formatNote.textContent = '';

  try {
    const data = await fetchJson('/api/youtube/preview', { url });
    const info = data.info;

    previewTitle.textContent = info.title || 'Untitled';
    previewMeta.textContent = [info.uploader, info.extractor].filter(Boolean).join(' | ');
    if (info.thumbnail) {
      const proxied = `/api/thumbnail?url=${encodeURIComponent(info.thumbnail)}`;
      thumb.style.backgroundImage = `url("${proxied}")`;
    } else {
      thumb.style.backgroundImage = 'none';
    }
    sourceLink.href = info.webpage_url || url;
    lastUrl = url;
    lastInfo = info;
    lastAvatar = info.avatar || '';

    setPreviewVisible(true);
    setStatus('Preview ready. Choose format and download.', 'muted');

    if (!lastAvatar) {
      try {
        const profile = await fetchJsonGet(`/api/youtube/profile?url=${encodeURIComponent(url)}`);
        if (profile.profile && profile.profile.avatar) {
          lastAvatar = profile.profile.avatar;
        }
      } catch (_err) {
        // Ignore: some sources don't expose avatars.
      }
    }
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

// Start a download with cooldown + locked format.
async function handleDownload() {
  const url = lastUrl || urlInput.value.trim();
  if (!url) return;
  if (!isYouTubeUrl(url)) {
    setStatus('Only YouTube links are supported right now.', 'error');
    return;
  }
  if (downloadCooldown) {
    setStatus('Please wait a few seconds before starting another download.', 'error');
    return;
  }

  directBtn.disabled = true;
  directBtn.textContent = 'Preparing...';
  formatNote.textContent = '';
  formatButtons.forEach((btn) => { btn.disabled = true; });
  downloadCooldown = true;

  const formatLocked = selectedFormat;
  try {
    const downloadUrl = buildDownloadUrl(url, formatLocked, (lastInfo && lastInfo.title) || 'download');
    triggerDownload(downloadUrl);

    addHistoryItem(lastInfo, formatLocked);
    setStatus('Download started.', 'muted');
    showToast('Download', 'Download started.');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    directBtn.disabled = false;
    directBtn.textContent = 'Download';
    setTimeout(() => {
      formatButtons.forEach((btn) => { btn.disabled = false; });
      downloadCooldown = false;
    }, 7000);
  }
}

formatButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActiveFormat(btn.dataset.format));
});

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActiveView(btn.dataset.view));
});

if (clearHistoryButton) {
  clearHistoryButton.addEventListener('click', () => {
    historyList.innerHTML = '';
  });
}

// About tab switching (What / Terms / Privacy / FAQ).
aboutTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const key = tab.dataset.about;
    aboutTabs.forEach((btn) => btn.classList.toggle('is-active', btn === tab));
    aboutSections.forEach((section) => {
      section.classList.toggle('is-active', section.dataset.about === key);
    });
  });
});

// Settings: default format toggle.
defaultFormatButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    defaultFormatButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    const format = btn.dataset.defaultFormat;
    if (format) {
      setActiveFormat(format);
    }
    saveSettings();
  });
});

// Settings: quality selection.
qualityButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    qualityButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    selectedQuality = btn.dataset.quality || 'best';
    saveSettings();
  });
});

// Settings: safe filename toggle.
if (safeFilenamesButton) {
  safeFilenamesButton.addEventListener('click', () => {
    const enabled = safeFilenamesButton.getAttribute('aria-pressed') === 'true';
    safeFilenamesButton.setAttribute('aria-pressed', enabled ? 'false' : 'true');
    safeFilenamesButton.textContent = enabled ? 'Disabled' : 'Enabled';
    saveSettings();
  });
}

// Settings: auto-clear history toggle.
if (historyModeButton) {
  historyModeButton.addEventListener('click', () => {
    clearHistoryOnDownload = !clearHistoryOnDownload;
    historyModeButton.setAttribute('aria-pressed', clearHistoryOnDownload ? 'true' : 'false');
    historyModeButton.textContent = clearHistoryOnDownload ? 'Auto-clear' : 'Keep history';
    saveSettings();
  });
}

// Settings: light mode toggle.
if (lightModeButton) {
  lightModeButton.addEventListener('click', () => {
    const enabled = lightModeButton.getAttribute('aria-pressed') === 'true';
    lightModeButton.setAttribute('aria-pressed', enabled ? 'false' : 'true');
    lightModeButton.textContent = enabled ? 'Disabled' : 'Enabled';
    document.body.classList.toggle('theme-light', !enabled);
    saveSettings();
  });
}

// Donate: open preset links and handle custom amount.
donateOptions.forEach((btn) => {
  const stripeUrl = btn.dataset.stripe || '';
  btn.href = stripeUrl || '#';

  btn.addEventListener('click', (event) => {
    const stripeUrl = btn.dataset.stripe || '';
    donateOptions.forEach((b) => b.classList.toggle('is-active', b === btn));
    selectedDonateAmount = btn.dataset.amount || '10';
    if (customDonateInput) {
      customDonateInput.value = '';
    }
    if (!stripeUrl) {
      event.preventDefault();
      showToast('Donate', 'Add a Stripe link for this amount.');
    }
  });
});

if (customDonateInput) {
  customDonateInput.addEventListener('input', () => {
    const value = customDonateInput.value.trim();
    donateOptions.forEach((b) => b.classList.remove('is-active'));
    selectedDonateAmount = value || '10';
  });
}

if (customDonateGo) {
  customDonateGo.addEventListener('click', () => {
    const value = customDonateInput ? customDonateInput.value.trim() : '';
    if (!value) {
      showToast('Donate', 'Enter a custom amount first.');
      return;
    }
    const baseUrl = customDonateGo.dataset.stripeCustom || '';
    if (!baseUrl) {
      showToast('Donate', 'Add a custom Stripe link first.');
      return;
    }
    const targetUrl = baseUrl.replace('{amount}', encodeURIComponent(value));
    window.open(targetUrl, '_blank', 'noopener');
  });
}

// News pagination between update pages.
function setNewsIndex(nextIndex) {
  if (!newsItems.length) return;
  const maxIndex = newsItems.length - 1;
  newsIndex = Math.max(0, Math.min(nextIndex, maxIndex));
  newsItems.forEach((item, idx) => {
    item.classList.toggle('is-active', idx === newsIndex);
  });
  if (newsPagination) {
    newsPagination.textContent = `${newsIndex + 1} / ${newsItems.length}`;
  }
  if (newsPrev) {
    newsPrev.classList.toggle('is-disabled', newsIndex === 0);
    newsPrev.disabled = newsIndex === 0;
  }
  if (newsNext) {
    newsNext.classList.toggle('is-disabled', newsIndex === maxIndex);
    newsNext.disabled = newsIndex === maxIndex;
  }
}

if (newsPrev && newsNext) {
  newsPrev.addEventListener('click', () => setNewsIndex(newsIndex - 1));
  newsNext.addEventListener('click', () => setNewsIndex(newsIndex + 1));
  setNewsIndex(0);
}

form.addEventListener('submit', handlePreview);

directBtn.addEventListener('click', (event) => {
  event.preventDefault();
  handleDownload();
});

setActiveFormat('mp4');
setPreviewVisible(false);
const storedView = (() => {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch (_err) {
    return null;
  }
})();
const initialView = storedView && document.querySelector(`.view[data-view="${storedView}"]`) ? storedView : 'downloader';
setActiveView(initialView);
applySettings();

legalLinks.forEach((link) => {
  link.addEventListener('click', () => {
    const view = link.dataset.view;
    const aboutKey = link.dataset.about;
    if (view) {
      setActiveView(view);
    }
    if (aboutKey) {
      aboutTabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.about === aboutKey));
      aboutSections.forEach((section) => {
        section.classList.toggle('is-active', section.dataset.about === aboutKey);
      });
    }
  });
});



