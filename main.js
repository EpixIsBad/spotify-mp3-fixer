const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Get FFmpeg path - handles both dev and packaged scenarios
function getFFmpegPath() {
  // Check for extraResources location (packaged app)
  const extraResourcesPath = path.join(process.resourcesPath || '', 'ffmpeg.exe');
  if (fs.existsSync(extraResourcesPath)) {
    return extraResourcesPath;
  }

  // Fallback to @ffmpeg-installer (dev mode)
  const bundledFfmpegPath = require('@ffmpeg-installer/ffmpeg').path;
  return bundledFfmpegPath;
}

const ffmpegPath = getFFmpegPath();

// Sample rate lookup table
const SAMPLE_RATES = {
  0: [44100, 22050, 11025],
  1: [48000, 24000, 12000],
  2: [32000, 16000, 8000],
  3: [null, null, null]
};

let mainWindow;

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

    const results = [];

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const sampleRate = getMp3SampleRate(filePath);
      const albumArt = extractAlbumArt(filePath);
      results.push({ file, filePath, sampleRate, albumArt });
    }

    return { success: true, files: results };
  } catch (err) {
    return { success: false, error: err.message };
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
        outputPath = filePath + '.tmp';
      }

      // Convert file
      fixMp3(filePath, outputPath, targetRate);

      // Handle replace modes
      if (outputMode === 'backup') {
        const backupPath = path.join(backupFolder, file);
        fs.renameSync(filePath, backupPath);
        fs.renameSync(outputPath, filePath);
      } else if (outputMode === 'replace') {
        fs.unlinkSync(filePath);
        fs.renameSync(outputPath, filePath);
      }

      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push({ file, error: err.message });
      // Clean up temp file if exists
      const tempPath = filePath + '.tmp';
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
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

function getMp3SampleRate(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    const id3Header = Buffer.alloc(10);
    fs.readSync(fd, id3Header, 0, 10, 0);

    if (id3Header.toString('ascii', 0, 3) === 'ID3') {
      const size = (id3Header[6] << 21) | (id3Header[7] << 14) |
                   (id3Header[8] << 7) | id3Header[9];
      offset = size + 10;
    }

    const searchBuffer = Buffer.alloc(4096);
    fs.readSync(fd, searchBuffer, 0, 4096, offset);

    for (let i = 0; i < searchBuffer.length - 4; i++) {
      if (searchBuffer[i] === 0xFF && (searchBuffer[i + 1] & 0xE0) === 0xE0) {
        const b1 = searchBuffer[i + 1];
        const b2 = searchBuffer[i + 2];
        const versionBits = (b1 >> 3) & 0x03;
        const sampleRateIndex = (b2 >> 2) & 0x03;

        let versionIndex;
        if (versionBits === 3) versionIndex = 0;
        else if (versionBits === 2) versionIndex = 1;
        else if (versionBits === 0) versionIndex = 2;
        else continue;

        const sampleRate = SAMPLE_RATES[sampleRateIndex]?.[versionIndex];
        if (sampleRate) return sampleRate;
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function fixMp3(inputPath, outputPath, targetSampleRate) {
  const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ar ${targetSampleRate} -acodec libmp3lame -q:a 0 -map_metadata 0 -id3v2_version 3 "${outputPath}"`;
  execSync(cmd, { stdio: 'ignore', windowsHide: true });
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
