const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Get FFmpeg path - handles both dev and packaged scenarios
function getFFmpegPath() {
  const extraResourcesPath = path.join(process.resourcesPath || '', 'ffmpeg.exe');

  if (fs.existsSync(extraResourcesPath)) {
    return extraResourcesPath;
  }

  return require('@ffmpeg-installer/ffmpeg').path;
}

function getFFProbePath() {
  const extraResourcesPath = path.join(process.resourcesPath || '', 'ffprobe.exe');

  if (fs.existsSync(extraResourcesPath)) {
    return extraResourcesPath;
  }

  return require('@ffprobe-installer/ffprobe').path;
}

const ffmpegPath = getFFmpegPath();
const ffprobePath = getFFProbePath();

// Sample rate lookup table
const SAMPLE_RATES = {
  0: [44100, 22050, 11025],
  1: [48000, 24000, 12000],
  2: [32000, 16000, 8000],
  3: [null, null, null]
};

let mainWindow;
let activeScanId = 0;

function createWindow() {
  // Get screen dimensions and calculate 90%
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.round(screenWidth * 0.9);
  const windowHeight = Math.round(screenHeight * 0.9);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a2e',
    show: false,
    frame: false,
    titleBarStyle: 'hidden'
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
  try {
    const files = fs.readdirSync(folderPath)
      .filter(file => file.toLowerCase().endsWith('.mp3'));

    const scanId = ++activeScanId;
    const sender = event.sender;

    sender.send('scan-started', { scanId, total: files.length });

    const scanItems = files.map((file, index) => {
      const scannedFile = {
        scanId,
        index,
        file,
        filePath: path.join(folderPath, file),
        sampleRate: null,
        sampleRatePending: true,
        albumArt: null,
        albumArtLoaded: false
      };

      sender.send('scan-file', scannedFile);
      return scannedFile;
    });

    scanSampleRates(scanId, sender, scanItems);

    return { success: true, total: files.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-album-art', async (event, filePath) => {
  try {
    const albumArt = extractAlbumArt(filePath);

    return { success: true, albumArt };
  } catch (err) {
    return { success: false, error: err.message, albumArt: null };
  }
});

ipcMain.handle('fix-files', async (event, { folderPath, files, targetRate, outputMode }) => {
  const results = { success: 0, failed: 0, errors: [] };

  let outputFolder = path.join(folderPath, '..', 'mp3_fixed');
  let backupFolder = path.join(folderPath, '..', 'mp3_backup');

  if (outputMode === 'separate') {
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    }
  } else if (outputMode === 'backup') {
    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }
  }

  for (let i = 0; i < files.length; i++) {
    const { file, filePath } = files[i];

    // Send progress update
    mainWindow.webContents.send('progress', {
      current: i + 1,
      total: files.length,
      file: file
    });

    try {
      let outputPath;
      if (outputMode === 'separate') {
        outputPath = path.join(outputFolder, file);
      } else {
        outputPath = `${filePath}.tmp.mp3`;
      }

      // Convert file
      await fixMp3(filePath, outputPath, targetRate);

      // Handle replace modes
      if (outputMode === 'backup') {
        const backupPath = getAvailablePath(path.join(backupFolder, file));
        fs.renameSync(filePath, backupPath);
        fs.renameSync(outputPath, filePath);
      } else if (outputMode === 'replace') {
        const originalTempPath = `${filePath}.original.tmp`;
        fs.renameSync(filePath, originalTempPath);
        try {
          fs.renameSync(outputPath, filePath);
          fs.unlinkSync(originalTempPath);
        } catch (err) {
          if (fs.existsSync(originalTempPath) && !fs.existsSync(filePath)) {
            fs.renameSync(originalTempPath, filePath);
          }
          throw err;
        }
      }

      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push({ file, error: err.message });
      // Clean up temp file if exists
      const tempPath = `${filePath}.tmp.mp3`;
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      const originalTempPath = `${filePath}.original.tmp`;
      if (fs.existsSync(originalTempPath) && !fs.existsSync(filePath)) {
        fs.renameSync(originalTempPath, filePath);
      }
    }
  }

  results.outputFolder = outputMode === 'separate' ? outputFolder : null;
  results.backupFolder = outputMode === 'backup' ? backupFolder : null;

  return results;
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  const { shell } = require('electron');
  shell.openPath(folderPath);
});

// Window control handlers
ipcMain.handle('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow.close();
});

// MP3 Functions

async function scanSampleRates(scanId, sender, scanItems) {
  const concurrency = 4;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < scanItems.length && scanId === activeScanId) {
      const item = scanItems[nextIndex++];
      const sampleRate = await getMp3SampleRate(item.filePath);

      if (scanId !== activeScanId || sender.isDestroyed()) return;

      sender.send('scan-file-updated', {
        scanId,
        index: item.index,
        sampleRate,
        sampleRatePending: false
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, scanItems.length) }, worker));

  if (scanId === activeScanId && !sender.isDestroyed()) {
    sender.send('scan-complete', { scanId });
  }
}

function getMp3SampleRate(filePath) {
  return new Promise((resolve) => {
    const cmd = spawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=sample_rate',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], {
      windowsHide: true
    });

    let stdout = '';

    cmd.stdout.on('data', data => {
      stdout += data.toString();
    });

    cmd.on('error', () => resolve(null));

    cmd.on('close', code => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const sampleRate = parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(sampleRate) ? sampleRate : null);
    });
  });
}

function fixMp3(inputPath, outputPath, targetSampleRate) {
  return new Promise((resolve, reject) => {
    const cmd = spawn(ffmpegPath, [
      '-y', 
      '-i', 
      inputPath, 
      '-ar', String(targetSampleRate), 
      '-acodec', 'libmp3lame',
      '-q:a', '0',
      '-map_metadata', '0', 
      '-id3v2_version', '3', 
      '-f', 'mp3',
      outputPath
    ], {
      windowsHide: true
    });

    let stderr = '';

    cmd.stderr.on('data', data => {
      stderr += data.toString();
    });

    cmd.on('error', reject);

    cmd.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `FFmpeg failed with code ${code}`));
      }
    });
  });
}

function getAvailablePath(filePath) {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  let counter = 1;
  let candidate;

  do {
    candidate = path.join(parsed.dir, `${parsed.name} (${counter})${parsed.ext}`);
    counter++;
  } while (fs.existsSync(candidate));

  return candidate;
}

// Extract album art from ID3v2 tags - returns base64 data URL or null
function extractAlbumArt(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(10);
      fs.readSync(fd, header, 0, 10, 0);

      // Check for ID3v2 tag
      if (header.toString('ascii', 0, 3) !== 'ID3') {
        return null;
      }

      const tagSize = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
      const tagData = Buffer.alloc(tagSize);
      fs.readSync(fd, tagData, 0, tagSize, 10);

      let offset = 0;
      const version = header[3]; // ID3v2.3 or ID3v2.4

      while (offset < tagSize - 10) {
        const frameId = tagData.toString('ascii', offset, offset + 4);
        if (frameId === '\x00\x00\x00\x00' || frameId.charCodeAt(0) === 0) break;

        let frameSize;
        if (version === 4) {
          // ID3v2.4 uses syncsafe integers
          frameSize = (tagData[offset + 4] << 21) | (tagData[offset + 5] << 14) |
                      (tagData[offset + 6] << 7) | tagData[offset + 7];
        } else {
          // ID3v2.3 uses regular integers
          frameSize = (tagData[offset + 4] << 24) | (tagData[offset + 5] << 16) |
                      (tagData[offset + 6] << 8) | tagData[offset + 7];
        }

        if (frameSize <= 0 || frameSize > tagSize - offset) break;

        // APIC = Attached Picture
        if (frameId === 'APIC') {
          const frameData = tagData.slice(offset + 10, offset + 10 + frameSize);

          // Parse APIC frame
          let pos = 0;
          const textEncoding = frameData[pos++];

          // Read MIME type (null-terminated)
          let mimeType = '';
          while (pos < frameData.length && frameData[pos] !== 0) {
            mimeType += String.fromCharCode(frameData[pos++]);
          }
          pos++; // Skip null terminator

          // Skip picture type byte
          pos++;

          // Skip description (null-terminated, possibly UTF-16)
          if (textEncoding === 1 || textEncoding === 2) {
            // UTF-16, look for double null
            while (pos < frameData.length - 1) {
              if (frameData[pos] === 0 && frameData[pos + 1] === 0) {
                pos += 2;
                break;
              }
              pos++;
            }
          } else {
            // UTF-8 or Latin-1, single null
            while (pos < frameData.length && frameData[pos] !== 0) {
              pos++;
            }
            pos++;
          }

          // Rest is image data
          const imageData = frameData.slice(pos);
          if (imageData.length > 0) {
            // Determine MIME type if not specified
            if (!mimeType || mimeType === 'image/') {
              if (imageData[0] === 0xFF && imageData[1] === 0xD8) {
                mimeType = 'image/jpeg';
              } else if (imageData[0] === 0x89 && imageData[1] === 0x50) {
                mimeType = 'image/png';
              } else {
                mimeType = 'image/jpeg'; // Default
              }
            }
            const base64 = imageData.toString('base64');
            return `data:${mimeType};base64,${base64}`;
          }
        }

        offset += 10 + frameSize;
      }

      return null;
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return null;
  }
}
