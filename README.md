# MP3 Sample Rate Fixer

A desktop application that fixes MP3 sample rate issues that cause playback problems in Spotify and other music players.

**This was made with the help of AI (claude), mainly for the UI/Electron portion, some code tune up, and any busy work like this README, Directions, Comments, etc.**

![Screenshot](screenshot.png)

## The Problem

Some MP3 files have incorrect sample rates - certain local file songs are set to a sample rate of 48000Hz when they should be 44100Hz for Spotify. This causes spotify to not start the next track in line, once one of these 48K Hz songs finish. I am no audio professional and have no idea why its an issue but im sure theres a good reason, I found it from this [Spotify thread](https://community.spotify.com/t5/Ongoing-Issues/Desktop-Playback-issues-with-local-files/idi-p/7023115) while trying to fix the issue on some of my Juice WRLD unrleased tracks I have downloaded.

## The Solution

This app scans your MP3 files, detects their sample rates, and re-encodes them to the correct rate while preserving all metadata (artist, album, artwork, etc.).

## Features

- Modern dark-themed UI
- Scan folders for MP3 files
- Detect current sample rates
- Convert to standard rates (44100 Hz, 48000 Hz, etc.)
- Select which tracks to fix
- Multiple output options:
  - Save to new folder (keep originals)
  - Replace with backup
  - Replace without backup
- Preserves ID3 tags and metadata
- Progress tracking
- Bundled FFmpeg - no external dependencies

## Download

Download the latest release from the [Releases](../../releases) page.

### Option 1: Portable Folder (Recommended)
1. Download `MP3-Sample-Rate-Fixer-win32-x64.zip`
2. Extract the folder anywhere
3. Run `MP3 Sample Rate Fixer.exe`

### Option 2: Build from Source
See [Building from Source](#building-from-source) below.

## How to Use

1. **Launch the app** - Double-click `MP3 Sample Rate Fixer.exe`

2. **Select a folder** - Click "Browse" and choose a folder containing your MP3 files

3. **Review files** - The app will scan and show all MP3 files with their current sample rates:
   - Files in **orange** need fixing
   - Files in **cyan** are already at the target rate

4. **Choose target rate** - Select your desired sample rate:
   - **44100 Hz** - CD quality, most common (recommended)
   - **48000 Hz** - DVD/professional audio

5. **Select tracks** (optional) - Click "Select Tracks" to choose specific files to fix

6. **Choose output mode**:
   - **Save to new folder** - Creates fixed copies in `mp3_fixed` folder
   - **Replace with backup** - Replaces originals, backs up to `mp3_backup`
   - **Replace (no backup)** - Replaces originals permanently

7. **Click "Fix Files"** - The app will process your files and show progress

## Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)
- npm (comes with Node.js)

### Steps

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/mp3-sample-rate-fixer.git
cd mp3-sample-rate-fixer

# Install dependencies
npm install

# Run in development mode
npm start

# Build for Windows
npm run build
```

The built app will be in the `dist/win-unpacked` folder.

## Tech Stack

- **Electron** - Desktop app framework
- **FFmpeg** - Audio processing (bundled via @ffmpeg-installer/ffmpeg)
- **Node.js** - Runtime

## FAQ

### Why do some MP3s have wrong sample rates?
This often happens when:
- Files are converted with buggy software
- Metadata gets corrupted
- Files are edited with tools that don't update headers properly

### Will this affect audio quality?
The app uses FFmpeg with highest quality settings (`-q:a 0`). Any quality loss is imperceptible for standard listening.

### Are my original files safe?
Yes! By default, the app saves fixed files to a new folder. Your originals are never touched unless you choose "Replace" mode.

### Does this work on Mac/Linux?
Currently Windows only. Mac/Linux support could be added - contributions welcome!

## License

ISC License - feel free to use, modify, and distribute.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Credits

- Built with [Electron](https://www.electronjs.org/)
- Audio processing by [FFmpeg](https://ffmpeg.org/)
- FFmpeg bundling via [@ffmpeg-installer/ffmpeg](https://www.npmjs.com/package/@ffmpeg-installer/ffmpeg)
