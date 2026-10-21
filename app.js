import * as BLE from './ble.js';

// WARNING: This password matches the hardcoded ESP32 firmware password.
// Note that client-side code is visible in bundles and Web Inspector.
const SCALE_AUTH_PASSWORD = 'sahil1186';

const STORAGE_KEY = 'sahilSmartScaleRecords';
const CUSTOMER_STORAGE_KEY = 'sahilActiveCustomer';

// State
const records = [];
let activeCustomer = '';
let currentTab = 'live';
let audioCtx = null;
let deferredInstallPrompt = null;

// DOM Elements
let liveRowsEl;
let historyRowsEl;
let entriesEl;
let totalEl;
let avgEl;
let lastEl;
let connStatusEl;
let connStatusTextEl;
let hintEl;
let activeCustomerNameEl;
let customerInputEl;
let searchInputEl;
let tabLiveBtn;
let tabHistoryBtn;
let btnInstallApp;
let iosInstallHintEl;

// Utility: HTML escaping to prevent XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Utility: CSV cell escaping (quotes, commas, newlines)
function escapeCsvCell(cell) {
  if (cell === null || cell === undefined) return '""';
  const str = String(cell);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

// Non-blocking toast notifications with optional action button
function showToast(message, type = 'info', duration = 3500, actionText = null, actionCb = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (actionText && typeof actionCb === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action-btn';
    actionBtn.textContent = actionText;
    actionBtn.addEventListener('click', () => {
      actionCb();
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, duration);
}

// LocalStorage helpers with robust try/catch
function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`localStorage read failed for ${key}:`, e);
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`localStorage write failed for ${key}:`, e);
  }
}

function saveRecords() {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(records));
}

function loadRecords() {
  const saved = safeLocalStorageGet(STORAGE_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      records.length = 0;
      parsed.forEach(item => {
        if (item && typeof item.item !== 'undefined') {
          records.push(item);
        }
      });
    }
  } catch (e) {
    console.warn('Failed to parse saved records:', e);
  }
}

function loadActiveCustomer() {
  activeCustomer = safeLocalStorageGet(CUSTOMER_STORAGE_KEY) || '';
  if (activeCustomerNameEl) {
    activeCustomerNameEl.textContent = activeCustomer || 'None';
  }
  if (customerInputEl && activeCustomer) {
    customerInputEl.value = activeCustomer;
  }
}

function saveActiveCustomer(name) {
  activeCustomer = name;
  safeLocalStorageSet(CUSTOMER_STORAGE_KEY, name);
  if (activeCustomerNameEl) {
    activeCustomerNameEl.textContent = name || 'None';
  }
}

// Audio Beep
function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(err => console.warn('Audio resume failed:', err));
  }
  return audioCtx;
}

function playBeep() {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.warn('Beep playback failed:', e);
  }
}

// Tab Switching
function switchTab(tabId) {
  currentTab = tabId;
  const liveTabEl = document.getElementById('liveTab');
  const historyTabEl = document.getElementById('historyTab');

  if (tabId === 'live') {
    tabLiveBtn.classList.add('active');
    tabLiveBtn.setAttribute('aria-selected', 'true');
    tabHistoryBtn.classList.remove('active');
    tabHistoryBtn.setAttribute('aria-selected', 'false');

    liveTabEl.classList.add('active');
    historyTabEl.classList.remove('active');
    renderLiveRows();
  } else {
    tabHistoryBtn.classList.add('active');
    tabHistoryBtn.setAttribute('aria-selected', 'true');
    tabLiveBtn.classList.remove('active');
    tabLiveBtn.setAttribute('aria-selected', 'false');

    historyTabEl.classList.add('active');
    liveTabEl.classList.remove('active');
    renderHistoryRows();
  }
}

// Renderers
function renderLiveRows() {
  const liveRecords = records.filter(r => r.customer === activeCustomer);

  if (!activeCustomer) {
    liveRowsEl.innerHTML = '<tr><td colspan="4" class="empty">Please set an active customer to begin weighing</td></tr>';
    updateSummary(liveRecords);
    return;
  }

  if (!liveRecords.length) {
    liveRowsEl.innerHTML = '<tr><td colspan="4" class="empty">No entries for this customer yet</td></tr>';
    updateSummary(liveRecords);
    return;
  }

  liveRowsEl.innerHTML = liveRecords.map(r => `
    <tr>
      <td data-label="Item #">${escapeHtml(r.item)}</td>
      <td data-label="Weight">${Number(r.weight || 0).toFixed(3)} kg</td>
      <td data-label="Time">${escapeHtml(r.time || '')}</td>
      <td data-label="Date">${escapeHtml(r.date || '')}</td>
    </tr>
  `).join('');

  updateSummary(liveRecords);
}

function renderHistoryRows() {
  const query = (searchInputEl?.value || '').toLowerCase().trim();
  const filtered = [];

  records.forEach((r, idx) => {
    const cust = (r.customer || '').toLowerCase();
    const itemStr = String(r.item || '');
    if (!query || cust.includes(query) || itemStr.includes(query)) {
      filtered.push({ record: r, originalIndex: idx });
    }
  });

  if (!filtered.length) {
    historyRowsEl.innerHTML = '<tr><td colspan="6" class="empty">No records found matching search</td></tr>';
    updateSummary([]);
    return;
  }

  historyRowsEl.innerHTML = filtered.map(item => `
    <tr>
      <td data-label="Customer">${escapeHtml(item.record.customer || 'Unknown')}</td>
      <td data-label="Item #">${escapeHtml(item.record.item)}</td>
      <td data-label="Weight">${Number(item.record.weight || 0).toFixed(3)} kg</td>
      <td data-label="Time">${escapeHtml(item.record.time || '')}</td>
      <td data-label="Date">${escapeHtml(item.record.date || '')}</td>
      <td data-label="Action">
        <button type="button" class="btn-icon-delete" data-index="${item.originalIndex}" title="Delete record from local display cache" aria-label="Delete Record">🗑️</button>
      </td>
    </tr>
  `).join('');

  // History search: summary stats reflect filtered rows
  const filteredRecords = filtered.map(f => f.record);
  updateSummary(filteredRecords);
}

function updateSummary(list) {
  const count = list.length;
  const total = list.reduce((sum, r) => sum + Number(r.weight || 0), 0);
  const avg = count ? total / count : 0;
  const last = count ? list[count - 1].weight : 0;

  if (entriesEl) entriesEl.textContent = count;
  if (totalEl) totalEl.textContent = `${total.toFixed(3)} kg`;
  if (avgEl) avgEl.textContent = `${avg.toFixed(3)} kg`;
  if (lastEl) lastEl.textContent = `${Number(last || 0).toFixed(3)} kg`;
}

// Connection & BLE Actions
function setConnectedStatus(connected) {
  if (connected) {
    connStatusEl.className = 'status connected';
    connStatusTextEl.textContent = 'Connected';
  } else {
    connStatusEl.className = 'status';
    connStatusTextEl.textContent = 'Waiting for scale';
  }
}

async function triggerAuthentication() {
  if (!BLE.isConnected()) return;
  try {
    hintEl.textContent = 'Authenticating with scale...';
    await BLE.sendText(`AUTH:${SCALE_AUTH_PASSWORD}`);
  } catch (e) {
    console.warn('Authentication write failed:', e);
    hintEl.textContent = 'Authentication handshake failed.';
    showToast('Failed to write authentication handshake', 'error');
  }
}

async function triggerAutoSync() {
  if (!BLE.isConnected()) return;
  try {
    hintEl.textContent = 'Auto-syncing history from scale...';
    await BLE.sendText('GET_ALL_RECORDS');

    if (activeCustomer) {
      setTimeout(async () => {
        try {
          if (BLE.isConnected()) {
            await BLE.sendText(`SET_CUSTOMER:${activeCustomer}`);
            hintEl.textContent = `Scale synced. Active Customer: ${activeCustomer}`;
          }
        } catch (e) {
          console.warn('Customer restore error:', e);
        }
      }, 600);
    }
  } catch (e) {
    console.warn('Auto-sync failed:', e);
  }
}

async function connectToScale() {
  if (!BLE.bleSupported()) {
    const msg = 'Web Bluetooth not supported here. Use Chrome on Android or desktop Chrome/Edge. On iPhone use the Bluefy browser app.';
    hintEl.textContent = msg;
    showToast(msg, 'warn', 6000);
    return;
  }

  try {
    hintEl.textContent = 'Opening scale connection...';
    await BLE.connect();
    setConnectedStatus(true);
    hintEl.textContent = 'Connected. Authenticating...';
    setTimeout(triggerAuthentication, 500);
    showToast('Connected to scale', 'info');
  } catch (err) {
    console.error('Connection failed:', err);
    setConnectedStatus(false);
    const msg = err && err.message ? err.message : 'cancelled';
    hintEl.textContent = `Connection failed: ${msg}`;
    showToast(`Connection failed: ${msg}`, 'error');
  }
}

async function setCustomer() {
  const name = customerInputEl.value.trim();
  if (!name) {
    showToast('Please enter a customer name or identifier.', 'warn');
    return;
  }

  saveActiveCustomer(name);

  if (BLE.isConnected()) {
    try {
      hintEl.textContent = `Setting active customer to: ${name}...`;
      await BLE.sendText(`SET_CUSTOMER:${name}`);
      hintEl.textContent = `Active customer set to: ${name}.`;
      showToast(`Scale updated: ${name}`, 'info');
    } catch (e) {
      console.warn('Failed to sync customer name with scale:', e);
      hintEl.textContent = 'Active customer set locally (Scale update failed).';
      showToast('Active customer set locally (Scale update failed)', 'warn');
    }
  } else {
    hintEl.textContent = `Active customer set locally to: ${name} (Scale offline).`;
    showToast(`Active customer set locally: ${name}`, 'info');
  }

  renderLiveRows();
}

async function nextCustomer() {
  if (BLE.isConnected()) {
    try {
      hintEl.textContent = 'Finalizing current customer...';
      await BLE.sendText('NEXT_CUSTOMER');
      hintEl.textContent = 'Ready for next customer.';
      showToast('Scale customer finalized', 'info');
    } catch (e) {
      console.warn('Failed to send NEXT_CUSTOMER command:', e);
    }
  }

  saveActiveCustomer('');
  customerInputEl.value = '';
  renderLiveRows();
}

function clearTable() {
  if (!window.confirm('Clear local browser display cache? (Does not delete data from the scale)')) {
    return;
  }
  records.length = 0;
  saveRecords();
  if (currentTab === 'live') {
    renderLiveRows();
  } else {
    renderHistoryRows();
  }
  showToast('Local display cache cleared', 'info');
}

function deleteRecordLocal(index) {
  const rec = records[index];
  if (!rec) return;
  if (!window.confirm(`Delete record (Item ${rec.item} for customer "${rec.customer || 'Unknown'}") from local display cache?`)) {
    return;
  }
  records.splice(index, 1);
  saveRecords();
  if (currentTab === 'live') {
    renderLiveRows();
  } else {
    renderHistoryRows();
  }
  showToast('Record removed from local display', 'info');
}

async function clearScaleFlash() {
  if (!BLE.isConnected()) {
    showToast('Please connect to the scale first.', 'warn');
    return;
  }
  if (!window.confirm('Erase all customer records stored ON THE SCALE today? This cannot be undone.')) {
    return;
  }
  try {
    hintEl.textContent = 'Requesting flash reset...';
    await BLE.sendText('RESET_ALL');
    hintEl.textContent = 'Scale flash database deleted.';

    // Clear local cache too
    records.length = 0;
    saveRecords();
    if (currentTab === 'live') {
      renderLiveRows();
    } else {
      renderHistoryRows();
    }
    showToast('Scale flash records deleted', 'warn');
  } catch (err) {
    console.error('Clear flash error:', err);
    hintEl.textContent = `Erase failed: ${err.message || err}`;
    showToast(`Erase failed: ${err.message || err}`, 'error');
  }
}

async function syncHistory() {
  if (!BLE.isConnected()) {
    showToast('Please connect to the scale first.', 'warn');
    return;
  }
  try {
    hintEl.textContent = 'Syncing history from scale...';
    await BLE.sendText('GET_ALL_RECORDS');
    showToast('Requested records from scale', 'info');
  } catch (err) {
    console.error('Sync history error:', err);
    hintEl.textContent = `Sync failed: ${err.message || err}`;
    showToast(`Sync failed: ${err.message || err}`, 'error');
  }
}

function exportCsv() {
  if (!records.length) {
    showToast('No records to export.', 'warn');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const filename = `scale-records-${today}.csv`;

  const header = ['Customer', 'Item #', 'Weight', 'Time', 'Date'].map(escapeCsvCell).join(',');
  const csvRows = [header];
  records.forEach(r => {
    csvRows.push([
      escapeCsvCell(r.customer || 'Unknown'),
      escapeCsvCell(r.item),
      escapeCsvCell(r.weight),
      escapeCsvCell(r.time),
      escapeCsvCell(r.date)
    ].join(','));
  });

  csvRows.push('');
  csvRows.push(['Total Weight', escapeCsvCell(totalEl.textContent), '', '', ''].join(','));
  csvRows.push(['Average', escapeCsvCell(avgEl.textContent), '', '', ''].join(','));
  csvRows.push(['Export Time', escapeCsvCell(new Date().toLocaleString()), '', '', ''].join(','));

  const csvContent = csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('CSV downloaded', 'info');
}

// Inbound Notification Handler
function handleInboundBleText(text) {
  if (text === 'AUTH_SUCCESS') {
    hintEl.textContent = 'Authenticated. Syncing history...';
    showToast('Scale authenticated successfully', 'info');
    triggerAutoSync();
    return;
  }

  if (text === 'AUTH_FAIL' || text === 'AUTH_REQUIRED') {
    hintEl.textContent = 'Authentication failed. Data access blocked.';
    showToast('Scale authentication failed! Incorrect password.', 'error');
    return;
  }

  if (text === 'SYNC_COMPLETE') {
    hintEl.textContent = 'Scale data synchronized.';
    showToast('Data sync complete', 'info');
    return;
  }

  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj.item !== 'undefined') {
      if (records.some(r => r.customer === obj.customer && r.item === obj.item)) {
        return;
      }
      records.push(obj);
      saveRecords();
      playBeep();

      if (currentTab === 'live') {
        renderLiveRows();
      } else {
        renderHistoryRows();
      }
    }
  } catch (e) {
    console.warn('Non-JSON BLE message received:', text);
  }
}

// PWA Install Handling
function setupPwaInstall() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (isStandalone) {
    if (btnInstallApp) btnInstallApp.style.display = 'none';
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallApp) {
      btnInstallApp.style.display = 'inline-flex';
    }
  });

  if (btnInstallApp) {
    btnInstallApp.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        btnInstallApp.style.display = 'none';
        showToast('App installed!', 'info');
      }
      deferredInstallPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (btnInstallApp) btnInstallApp.style.display = 'none';
    showToast('Smart Weighing Scale is installed!', 'info');
  });

  // Detect iOS Safari for manual Add to Home Screen hint
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  if (isIos && !isStandalone && iosInstallHintEl) {
    iosInstallHintEl.style.display = 'block';
  }
}

// Service Worker Registration & Update Handling
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('Update available! Reload to update.', 'info', 10000, 'Reload', () => {
                  newWorker.postMessage('SKIP_WAITING');
                  window.location.reload();
                });
              }
            });
          }
        });
      } catch (err) {
        console.warn('Service worker registration failed:', err);
      }
    });
  }
}

// Initialization
function initApp() {
  liveRowsEl = document.getElementById('liveRows');
  historyRowsEl = document.getElementById('historyRows');
  entriesEl = document.getElementById('entries');
  totalEl = document.getElementById('total');
  avgEl = document.getElementById('avg');
  lastEl = document.getElementById('last');
  connStatusEl = document.getElementById('connStatus');
  connStatusTextEl = document.getElementById('connStatusText');
  hintEl = document.getElementById('hint');
  activeCustomerNameEl = document.getElementById('activeCustomerName');
  customerInputEl = document.getElementById('customerInput');
  searchInputEl = document.getElementById('searchInput');
  tabLiveBtn = document.getElementById('tabLiveBtn');
  tabHistoryBtn = document.getElementById('tabHistoryBtn');
  btnInstallApp = document.getElementById('btnInstallApp');
  iosInstallHintEl = document.getElementById('iosInstallHint');

  // Load persisted state
  loadRecords();
  loadActiveCustomer();

  // Attach button event listeners
  tabLiveBtn.addEventListener('click', () => switchTab('live'));
  tabHistoryBtn.addEventListener('click', () => switchTab('history'));
  document.getElementById('btnConnect').addEventListener('click', connectToScale);
  document.getElementById('btnSetCustomer').addEventListener('click', setCustomer);
  document.getElementById('btnNextCustomer').addEventListener('click', nextCustomer);
  document.getElementById('btnSyncHistory').addEventListener('click', syncHistory);
  document.getElementById('btnClearTable').addEventListener('click', clearTable);
  document.getElementById('btnClearFlash').addEventListener('click', clearScaleFlash);
  document.getElementById('btnExportCsv').addEventListener('click', exportCsv);
  searchInputEl.addEventListener('input', renderHistoryRows);

  customerInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setCustomer();
  });

  // Delegated delete handler for history table
  historyRowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (btn) {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (!isNaN(idx)) {
        deleteRecordLocal(idx);
      }
    }
  });

  // Subscribe to BLE abstraction events
  BLE.onText(handleInboundBleText);
  BLE.onDisconnect(() => {
    setConnectedStatus(false);
    hintEl.textContent = 'Scale disconnected, reconnecting...';
    showToast('Scale disconnected', 'warn');
  });
  BLE.onConnect(() => {
    setConnectedStatus(true);
    hintEl.textContent = 'Reconnected. Authenticating...';
    setTimeout(triggerAuthentication, 500);
  });

  // Render initial view
  if (currentTab === 'live') {
    renderLiveRows();
  } else {
    renderHistoryRows();
  }

  // Setup PWA install & SW registration
  setupPwaInstall();
  registerServiceWorker();
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
