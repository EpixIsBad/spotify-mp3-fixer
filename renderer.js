// Window Control Buttons
document.getElementById('minimizeBtn').addEventListener('click', () => window.api.windowMinimize());
document.getElementById('maximizeBtn').addEventListener('click', () => window.api.windowMaximize());
document.getElementById('closeBtn').addEventListener('click', () => window.api.windowClose());

// DOM Elements
const folderPathEl = document.getElementById('folderPath');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const fileListEl = document.getElementById('fileList');
const statsEl = document.getElementById('stats');
const totalFilesEl = document.getElementById('totalFiles');
const needsFixEl = document.getElementById('needsFix');
const alreadyOkEl = document.getElementById('alreadyOk');
const targetRateEl = document.getElementById('targetRate');
const outputModeEl = document.getElementById('outputMode');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const statusMessage = document.getElementById('statusMessage');
const refreshBtn = document.getElementById('refreshBtn');
const fixBtn = document.getElementById('fixBtn');
const selectTracksBtn = document.getElementById('selectTracksBtn');

// Modal Elements
const selectionModal = document.getElementById('selectionModal');
const selectionList = document.getElementById('selectionList');
const selectionInfo = document.getElementById('selectionInfo');
const closeModalBtn = document.getElementById('closeModalBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const selectNeedsFixBtn = document.getElementById('selectNeedsFixBtn');
const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
const applySelectionBtn = document.getElementById('applySelectionBtn');

// State
let currentFolder = null;
let scannedFiles = [];
let selectedFiles = new Set(); // Track selected file indices
let tempSelection = new Set(); // Temporary selection while modal is open
const albumArtCache = new Map();
let albumArtObserver = null;
let currentScanId = null;

const musicIconSvg = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
  </svg>
`;

// Event Listeners
selectFolderBtn.addEventListener('click', selectFolder);
refreshBtn.addEventListener('click', () => scanFolder(currentFolder));
fixBtn.addEventListener('click', fixFiles);
targetRateEl.addEventListener('change', updateFileList);
selectTracksBtn.addEventListener('click', openSelectionModal);

// Modal Event Listeners
closeModalBtn.addEventListener('click', closeModal);
cancelSelectionBtn.addEventListener('click', closeModal);
applySelectionBtn.addEventListener('click', applySelection);
selectAllBtn.addEventListener('click', () => selectAllTracks(true));
deselectAllBtn.addEventListener('click', () => selectAllTracks(false));
selectNeedsFixBtn.addEventListener('click', selectNeedsFixOnly);
selectionModal.addEventListener('click', (e) => {
  if (e.target === selectionModal) closeModal();
});

// Progress listener
window.api.onProgress((data) => {
  const percent = Math.round((data.current / data.total) * 100);
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressStatus.textContent = `Processing: ${data.file}`;
});

window.api.onScanStarted((data) => {
  currentScanId = data.scanId;
  scannedFiles = [];
  selectedFiles.clear();
  albumArtCache.clear();
  resetAlbumArtObserver();

  fileListEl.innerHTML = '';
  totalFilesEl.textContent = data.total;
  needsFixEl.textContent = 0;
  alreadyOkEl.textContent = 0;
  statsEl.style.display = data.total > 0 ? 'flex' : 'none';
  selectTracksBtn.disabled = true;
  fixBtn.disabled = true;
  fixBtn.textContent = 'Fix Files';

  if (data.total === 0) {
    showEmptyFileList('No MP3 files found in this folder');
  }
});

window.api.onScanFile((file) => {
  if (file.scanId !== currentScanId) return;

  scannedFiles[file.index] = file;
  appendFileRow(file);
  updateStatsAndActions();
});

window.api.onScanFileUpdated((data) => {
  if (data.scanId !== currentScanId || !scannedFiles[data.index]) return;

  Object.assign(scannedFiles[data.index], data);
  updateFileRow(data.index);
  updateStatsAndActions();
});

window.api.onScanComplete(() => {
  refreshBtn.disabled = false;
  selectFolderBtn.disabled = false;
  selectTracksBtn.disabled = scannedFiles.length === 0;
  updateStatsAndActions();
});

async function selectFolder() {
  const folder = await window.api.selectFolder();
  if (folder) {
    currentFolder = folder;
    folderPathEl.textContent = folder;
    folderPathEl.classList.remove('placeholder');
    await scanFolder(folder);
  }
}

async function scanFolder(folder) {
  if (!folder) return;

  // Show loading state
  fileListEl.innerHTML = '<div class="empty-state"><p>Scanning...</p></div>';
  refreshBtn.disabled = true;
  fixBtn.disabled = true;
  selectTracksBtn.disabled = true;
  selectFolderBtn.disabled = true;

  const result = await window.api.scanFolder(folder);

  if (!result.success) {
    showStatus(`Error: ${result.error}`, 'error');
    refreshBtn.disabled = false;
    selectFolderBtn.disabled = false;
    return;
  }
}

function updateFileList() {
  const targetRate = parseInt(targetRateEl.value);

  if (scannedFiles.length === 0) {
    showEmptyFileList('No MP3 files found in this folder');
    statsEl.style.display = 'none';
    fixBtn.disabled = true;
    selectTracksBtn.disabled = true;
    return;
  }

  // Update selection based on new target rate
  selectedFiles.clear();
  scannedFiles.forEach((file, index) => {
    if (!file.sampleRatePending && file.sampleRate !== targetRate) {
      selectedFiles.add(index);
    }
  });

  // Build file list HTML
  let html = '';
  let needsFix = 0;
  let alreadyOk = 0;

  for (let i = 0; i < scannedFiles.length; i++) {
    const file = scannedFiles[i];
    let rateClass = '';
    let rateText = '';

    if (file.sampleRatePending) {
      rateClass = 'unknown';
      rateText = 'Checking...';
    } else if (file.sampleRate === null) {
      rateClass = 'unknown';
      rateText = 'Unknown';
      needsFix++;
    } else if (file.sampleRate !== targetRate) {
      rateClass = 'needs-fix';
      rateText = `${file.sampleRate} Hz`;
      needsFix++;
    } else {
      rateText = `${file.sampleRate} Hz`;
      alreadyOk++;
    }

    html += `
      <div class="file-item">
        <div class="file-album-art" data-art-index="${i}">${musicIconSvg}</div>
        <div class="file-name" title="${escapeHtml(file.file)}">${escapeHtml(file.file)}</div>
        <div class="file-rate ${rateClass}">${rateText}</div>
      </div>
    `;
  }

  fileListEl.innerHTML = html;
  observeAlbumArt(fileListEl, '.file-album-art[data-art-index]', fileListEl);

  // Update stats
  totalFilesEl.textContent = scannedFiles.length;
  needsFixEl.textContent = needsFix;
  alreadyOkEl.textContent = alreadyOk;
  statsEl.style.display = 'flex';

  // Enable/disable buttons
  selectTracksBtn.disabled = scannedFiles.length === 0;
  fixBtn.disabled = selectedFiles.size === 0;

  // Update fix button text to show count
  if (selectedFiles.size > 0) {
    fixBtn.textContent = `Fix ${selectedFiles.size} File${selectedFiles.size > 1 ? 's' : ''}`;
  } else {
    fixBtn.textContent = 'Fix Files';
  }

  // Hide any previous status
  hideStatus();
}

// Modal Functions
function openSelectionModal() {
  const targetRate = parseInt(targetRateEl.value);

  // Copy current selection to temp
  tempSelection = new Set(selectedFiles);

  // Build selection list
  let html = '';
  for (let i = 0; i < scannedFiles.length; i++) {
    const file = scannedFiles[i];
    const isSelected = tempSelection.has(i);
    const needsFixing = !file.sampleRatePending && file.sampleRate !== targetRate;
    const rateClass = needsFixing ? 'needs-fix' : '';
    const rateText = getRateText(file);
    const statusText = file.sampleRatePending
      ? rateText
      : needsFixing
        ? `${rateText} → ${targetRate} Hz`
        : `${rateText} (OK)`;

    html += `
      <li class="selection-item ${isSelected ? '' : 'excluded'}" data-index="${i}">
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <div class="album-art" data-art-index="${i}">${musicIconSvg}</div>
        <div class="file-info">
          <div class="name">${escapeHtml(file.file)}</div>
          <div class="rate ${rateClass}">${statusText}</div>
        </div>
      </li>
    `;
  }

  selectionList.innerHTML = html;
  updateSelectionInfo();

  // Add click handlers to list items
  selectionList.querySelectorAll('.selection-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox.checked = !checkbox.checked;
      }
      toggleSelection(parseInt(item.dataset.index));
    });
  });

  selectionModal.classList.add('active');
  observeAlbumArt(selectionList, '.album-art[data-art-index]', selectionModal);
}

function closeModal() {
  selectionModal.classList.remove('active');
}

function toggleSelection(index) {
  if (tempSelection.has(index)) {
    tempSelection.delete(index);
  } else {
    tempSelection.add(index);
  }

  // Update UI
  const item = selectionList.querySelector(`[data-index="${index}"]`);
  if (item) {
    item.classList.toggle('excluded', !tempSelection.has(index));
  }

  updateSelectionInfo();
}

function selectAllTracks(select) {
  tempSelection.clear();
  if (select) {
    scannedFiles.forEach((_, index) => tempSelection.add(index));
  }

  // Update all checkboxes
  selectionList.querySelectorAll('.selection-item').forEach(item => {
    const index = parseInt(item.dataset.index);
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.checked = select;
    item.classList.toggle('excluded', !select);
  });

  updateSelectionInfo();
}

function selectNeedsFixOnly() {
  const targetRate = parseInt(targetRateEl.value);
  tempSelection.clear();

  scannedFiles.forEach((file, index) => {
    if (!file.sampleRatePending && file.sampleRate !== targetRate) {
      tempSelection.add(index);
    }
  });

  // Update all checkboxes
  selectionList.querySelectorAll('.selection-item').forEach(item => {
    const index = parseInt(item.dataset.index);
    const isSelected = tempSelection.has(index);
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.checked = isSelected;
    item.classList.toggle('excluded', !isSelected);
  });

  updateSelectionInfo();
}

function updateSelectionInfo() {
  selectionInfo.textContent = `${tempSelection.size} of ${scannedFiles.length} selected`;
}

function applySelection() {
  selectedFiles = new Set(tempSelection);
  closeModal();

  // Update fix button
  fixBtn.disabled = selectedFiles.size === 0;
  if (selectedFiles.size > 0) {
    fixBtn.textContent = `Fix ${selectedFiles.size} File${selectedFiles.size > 1 ? 's' : ''}`;
  } else {
    fixBtn.textContent = 'Fix Files';
  }

  showStatus(`${selectedFiles.size} track${selectedFiles.size !== 1 ? 's' : ''} selected for fixing`, 'info');
}

async function fixFiles() {
  const targetRate = parseInt(targetRateEl.value);
  const outputMode = outputModeEl.value;

  // Get selected files only
  const filesToFix = scannedFiles.filter((_, index) => selectedFiles.has(index));

  if (filesToFix.length === 0) {
    showStatus('No files selected! Use "Select Tracks" to choose files.', 'info');
    return;
  }

  // Confirm if replacing without backup
  if (outputMode === 'replace') {
    if (!confirm('Are you sure you want to replace files WITHOUT backup? This cannot be undone!')) {
      return;
    }
  }

  // Show progress
  progressContainer.classList.add('active');
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressStatus.textContent = 'Starting...';
  fixBtn.disabled = true;
  refreshBtn.disabled = true;
  selectFolderBtn.disabled = true;
  selectTracksBtn.disabled = true;

  try {
    const result = await window.api.fixFiles({
      folderPath: currentFolder,
      files: filesToFix,
      targetRate,
      outputMode
    });

    // Hide progress
    progressContainer.classList.remove('active');

    // Show result
    let message = `Done! ${result.success} files fixed`;
    if (result.failed > 0) {
      message += `, ${result.failed} failed`;
    }

    if (result.outputFolder) {
      message += `. Files saved to: ${result.outputFolder}`;
      showStatus(message, 'success');

      // Offer to open folder
      if (confirm('Would you like to open the output folder?')) {
        window.api.openFolder(result.outputFolder);
      }
    } else if (result.backupFolder) {
      message += `. Originals backed up to: ${result.backupFolder}`;
      showStatus(message, 'success');
    } else {
      showStatus(message, 'success');
    }

    // Refresh file list
    await scanFolder(currentFolder);
    showStatus(message, result.failed > 0 ? 'error' : 'success');

  } catch (err) {
    progressContainer.classList.remove('active');
    showStatus(`Error: ${err.message}`, 'error');
  }

  fixBtn.disabled = false;
  refreshBtn.disabled = false;
  selectFolderBtn.disabled = false;
  selectTracksBtn.disabled = false;
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = 'status-message ' + type;
}

function hideStatus() {
  statusMessage.className = 'status-message';
}

function appendFileRow(file) {
  if (fileListEl.querySelector('.empty-state')) {
    fileListEl.innerHTML = '';
  }

  const row = document.createElement('div');
  row.className = 'file-item';
  row.dataset.index = file.index;

  const art = document.createElement('div');
  art.className = 'file-album-art';
  art.dataset.artIndex = file.index;
  art.innerHTML = musicIconSvg;

  const name = document.createElement('div');
  name.className = 'file-name';
  name.title = file.file;
  name.textContent = file.file;

  const rate = document.createElement('div');
  rate.className = 'file-rate unknown';
  rate.textContent = getRateText(file);

  row.append(art, name, rate);
  fileListEl.appendChild(row);
  observeAlbumArtElement(art, fileListEl);
}

function updateFileRow(index) {
  const file = scannedFiles[index];
  const row = fileListEl.querySelector(`.file-item[data-index="${index}"]`);
  if (!file || !row) return;

  const rate = row.querySelector('.file-rate');
  const meta = getRateMeta(file);
  rate.className = `file-rate ${meta.rateClass}`;
  rate.textContent = meta.rateText;
}

function updateStatsAndActions() {
  const targetRate = parseInt(targetRateEl.value);
  let needsFix = 0;
  let alreadyOk = 0;

  selectedFiles.clear();

  scannedFiles.forEach((file, index) => {
    if (!file || file.sampleRatePending) return;

    if (file.sampleRate !== targetRate) {
      needsFix++;
      selectedFiles.add(index);
    } else {
      alreadyOk++;
    }
  });

  totalFilesEl.textContent = scannedFiles.length;
  needsFixEl.textContent = needsFix;
  alreadyOkEl.textContent = alreadyOk;
  statsEl.style.display = scannedFiles.length > 0 ? 'flex' : 'none';
  selectTracksBtn.disabled = scannedFiles.length === 0;
  fixBtn.disabled = selectedFiles.size === 0;
  fixBtn.textContent = selectedFiles.size > 0
    ? `Fix ${selectedFiles.size} File${selectedFiles.size > 1 ? 's' : ''}`
    : 'Fix Files';
}

function getRateMeta(file) {
  const targetRate = parseInt(targetRateEl.value);

  if (file.sampleRatePending) {
    return { rateClass: 'unknown', rateText: 'Checking...' };
  }

  if (file.sampleRate === null) {
    return { rateClass: 'unknown', rateText: 'Unknown' };
  }

  if (file.sampleRate !== targetRate) {
    return { rateClass: 'needs-fix', rateText: `${file.sampleRate} Hz` };
  }

  return { rateClass: '', rateText: `${file.sampleRate} Hz` };
}

function getRateText(file) {
  return getRateMeta(file).rateText;
}

function showEmptyFileList(message) {
  fileListEl.innerHTML = `
    <div class="empty-state">
      ${musicIconSvg}
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function resetAlbumArtObserver() {
  if (albumArtObserver) {
    albumArtObserver.disconnect();
    albumArtObserver = null;
  }
}

function observeAlbumArt(container, selector, root) {
  resetAlbumArtObserver();

  if (!window.api.getAlbumArt || !('IntersectionObserver' in window)) {
    container.querySelectorAll(selector).forEach(el => {
      loadAlbumArt(Number(el.dataset.artIndex), el);
    });
    return;
  }

  createAlbumArtObserver(root);

  container.querySelectorAll(selector).forEach(el => albumArtObserver.observe(el));
}

function observeAlbumArtElement(artEl, root) {
  if (!window.api.getAlbumArt || !('IntersectionObserver' in window)) {
    loadAlbumArt(Number(artEl.dataset.artIndex), artEl);
    return;
  }

  createAlbumArtObserver(root);
  albumArtObserver.observe(artEl);
}

function createAlbumArtObserver(root) {
  if (albumArtObserver) return;

  albumArtObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const artEl = entry.target;
      albumArtObserver.unobserve(artEl);
      loadAlbumArt(Number(artEl.dataset.artIndex), artEl);
    });
  }, {
    root,
    rootMargin: '120px'
  });
}

async function loadAlbumArt(index, artEl) {
  const file = scannedFiles[index];
  if (!file || !artEl) return;

  if (albumArtCache.has(file.filePath)) {
    renderAlbumArt(artEl, albumArtCache.get(file.filePath));
    return;
  }

  albumArtCache.set(file.filePath, null);

  const result = await window.api.getAlbumArt(file.filePath);
  const albumArt = result.success ? result.albumArt : null;

  albumArtCache.set(file.filePath, albumArt);
  file.albumArt = albumArt;
  file.albumArtLoaded = true;

  renderAlbumArt(artEl, albumArt);
}

function renderAlbumArt(artEl, albumArt) {
  if (!albumArt) return;

  artEl.innerHTML = '';
  const img = document.createElement('img');
  img.src = albumArt;
  img.alt = 'Album art';
  artEl.appendChild(img);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
