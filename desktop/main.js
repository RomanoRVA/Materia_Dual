const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let backendProcess;

function getAppPaths() {
  const runningPackaged = app.isPackaged;

  if (runningPackaged) {
    const resourcesRoot = process.resourcesPath;
    return {
      frontendLoginPath: path.join(resourcesRoot, 'frontend', 'login.html'),
      backendExePath: path.join(resourcesRoot, 'backend-dist', 'pos-los-pachecos.exe'),
      backendDir: path.join(resourcesRoot, 'backend-dist'),
      backendServerPath: null,
      runningPackaged,
    };
  }

  const projectRoot = path.resolve(__dirname, '..');
  return {
    frontendLoginPath: path.join(projectRoot, 'frontend', 'login.html'),
    backendExePath: path.join(projectRoot, 'backend', 'dist', 'pos-los-pachecos.exe'),
    backendDir: path.join(projectRoot, 'backend'),
    backendServerPath: path.join(projectRoot, 'backend', 'src', 'server.js'),
    runningPackaged,
  };
}

function startBackend() {
  const paths = getAppPaths();

  // In local/dev mode prefer Node directly. This path is stable with Prisma + RDS.
  if (paths.backendServerPath && fs.existsSync(paths.backendServerPath)) {
    backendProcess = spawn('node', ['src/server.js'], {
      cwd: paths.backendDir,
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }

  if (fs.existsSync(paths.backendExePath)) {
    backendProcess = spawn(paths.backendExePath, [], {
      cwd: path.dirname(paths.backendExePath),
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  backendProcess = spawn(npmCmd, ['run', 'dev'], {
    cwd: paths.backendDir,
    windowsHide: true,
    stdio: 'ignore',
  });
}

function createWindow() {
  const paths = getAppPaths();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    title: 'POS Los Pachecos',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!fs.existsSync(paths.frontendLoginPath)) {
    dialog.showErrorBox('Archivo faltante', `No se encontro la pantalla de login: ${paths.frontendLoginPath}`);
    app.quit();
    return;
  }

  mainWindow.loadFile(paths.frontendLoginPath);
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
