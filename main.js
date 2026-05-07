const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function saveData(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2), 'utf-8');
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '小蛋助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- IPC handlers ---
ipcMain.handle('load-conversations', () => loadData('conversations.json') || []);
ipcMain.handle('save-conversations', (_, data) => { saveData('conversations.json', data); return true; });
ipcMain.handle('load-models', () => loadData('models.json') || []);
ipcMain.handle('save-models', (_, data) => { saveData('models.json', data); return true; });
ipcMain.handle('load-settings', () => loadData('settings.json') || []);
ipcMain.handle('save-settings', (_, data) => { saveData('settings.json', data); return true; });

// 窗口控制
ipcMain.handle('window-minimize', () => { if (win) win.minimize(); });
ipcMain.handle('window-maximize', () => { if (win) { win.isMaximized() ? win.unmaximize() : win.maximize(); } });
ipcMain.handle('window-close', () => { if (win) win.close(); });
ipcMain.handle('window-is-maximized', () => win ? win.isMaximized() : false);

// 窗口拖拽（替代 -webkit-app-region: drag，解决输入框失焦问题）
let dragStartPos = null;
let winStartPos = null;

ipcMain.handle('drag-start', (_, mouseScreenPos) => {
  if (!win) return;
  // 如果窗口最大化，先还原再拖
  if (win.isMaximized()) {
    win.unmaximize();
    // 居中还原
    const [w, h] = win.getSize();
    const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    win.setPosition(Math.round((screenW - w) / 2), Math.round((screenH - h) / 2));
  }
  dragStartPos = { x: mouseScreenPos.x, y: mouseScreenPos.y };
  winStartPos = win.getPosition();
});

ipcMain.handle('drag-move', (_, mouseScreenPos) => {
  if (!win || !dragStartPos || !winStartPos) return;
  const dx = mouseScreenPos.x - dragStartPos.x;
  const dy = mouseScreenPos.y - dragStartPos.y;
  win.setPosition(winStartPos[0] + dx, winStartPos[1] + dy);
});

ipcMain.handle('drag-end', () => {
  dragStartPos = null;
  winStartPos = null;
});
