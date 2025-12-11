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
      results.push({ file, filePath, sampleRate });
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
