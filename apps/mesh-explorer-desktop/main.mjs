import { app, BrowserWindow } from 'electron';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMeshGraphServer } from '../mesh-graph-server/src/index.ts';

let closeServer = async () => {};

async function createWindow() {
  const storageDir = await mkdtemp(join(tmpdir(), 'mesh-explorer-desktop-'));
  const server = await startMeshGraphServer({ storageDir, port: 0 });
  closeServer = server.close;

  const win = new BrowserWindow({ width: 1400, height: 900 });
  const webappUrl = process.env.MESH_WEBAPP_URL ?? 'http://127.0.0.1:5173';
  await win.loadURL(webappUrl);

  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`
      const base = document.querySelector('#baseUrl');
      if (base) base.value = ${JSON.stringify(server.url)};
    `);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  await closeServer();
  app.quit();
});
