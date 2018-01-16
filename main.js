const {ipcMain, dialog, app, BrowserWindow} = require('electron');
const {ArcWindowsManager} = require('./scripts/main/windows-manager');
const {UpdateStatus} = require('./scripts/main/update-status');
const {ArcMainMenu} = require('./scripts/main/main-menu');
const {ArcIdentity} = require('./scripts/main/oauth2');
const {DriveExport} = require('./scripts/main/drive-export');
const {SessionManager} = require('./scripts/main/session-manager');
const {AppOptions} = require('./scripts/main/app-options');
const log = require('electron-log');

class Arc {
  constructor() {
    this._registerProtocols();
    const startupOptions = this._processArguments();
    this.menu = new ArcMainMenu();
    this.wm = new ArcWindowsManager(startupOptions.getOptions());
    this.us = new UpdateStatus(this.wm, this.menu);
    this.sm = new SessionManager(this.wm);
    this._listenMenu(this.menu);
  }

  attachListeners() {
    app.on('ready', this._readyHandler.bind(this));
    app.on('window-all-closed', this._allClosedHandler.bind(this));
    app.on('activate', this._activateHandler.bind(this));
  }
  /**
   * Registers application protocol and adds a handler.
   * The handler will be called when a user navigate to `protocol://data`
   * url in a browser. This is used when opening / creating a file from
   * Google Drive menu.
   */
  _registerProtocols() {
    log.info('Registering arc-file protocol');
    app.setAsDefaultProtocolClient('arc-file');
    app.on('open-url', (event, url) => {
      log.info('arc-file protocol handles ', url);
      event.preventDefault();
      var fileData = url.substr(11);
      var parts = fileData.split('/');
      switch (parts[0]) {
        case 'drive':
          // arc-file://drive/open/file-id
          // arc-file://drive/create/file-id
          this.wm.open('/request/drive/' + parts[1] + '/' + parts[2]);
        break;
      }
    });
  }
  // processes start arguments
  _processArguments() {
    const startupOptions = new AppOptions();
    startupOptions.parse();
    return startupOptions;
  }

  _readyHandler() {
    log.info('Application is now ready');
    this.wm.open();
    this.us.start();
    this.menu.build();
    this.sm.start();
  }
  // Quits when all windows are closed.
  _allClosedHandler() {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  _activateHandler() {
    if (!this.wm.hasWindow) {
      this.wm.open();
    }
  }

  _listenMenu(menu) {
    menu.on('menu-action', this._menuHandler.bind(this));
  }

  _menuHandler(action, win) {
    if (action.indexOf('application') === 0) {
      return this._handleApplicationAction(action.substr(12), win);
    }
    if (action.indexOf('request') === 0) {
      return win.webContents.send('request-action', action.substr(8));
    }
  }

  _handleApplicationAction(action, win) {
    var windowCommand = 'command';
    switch (action) {
      case 'install-update':
        this.us.installUpdate();
      break;
      case 'check-for-update':
        this.us.check({
          notify: true
        });
      break;
      case 'quit':
        app.quit();
      break;
      case 'open-saved':
      case 'open-history':
      case 'open-drive':
      case 'open-messages':
      case 'show-settings':
      case 'about':
      case 'open-license':
      case 'import-data':
      case 'export-data':
      case 'find':
      case 'login-external-webservice':
      case 'open-cookie-manager':
      case 'open-hosts-editor':
        win.webContents.send(windowCommand, action);
      break;
      case 'new-window':
        this.wm.open();
      break;
      case 'open-privacy-policy':
      case 'open-documentation':
      case 'open-faq':
      case 'open-discussions':
      case 'report-issue':
      case 'search-issues':
      case 'web-session-help':
        let {HelpManager} = require('./scripts/main/help-manager');
        HelpManager.helpWith(action);
      break;
      case 'task-manager':
        this.wm.openTaskManager();
      break;
    }
  }
  /**
   * Returns focused, first available or newly created window (in that order).
   * New window is started when there's no winow opened.
   *
   * @return {Promise} Promise resolved to a BrowserWindow object.
   */
  getActiveWindow() {
    log.info('Getting active window...');
    var win = BrowserWindow.getFocusedWindow();
    if (win) {
      return Promise.resolve(win);
    }
    log.info('Focused window not found. Getting any first window.');
    var wins = BrowserWindow.getAllWindows();
    if (wins && wins.length) {
      return Promise.resolve(wins[0]);
    }
    log.info('No windows found. Creating a window.');
    return this.wm.open();
  }
  /**
   * Allows to update a request object in active window and specific tab.
   * By defaulty currently selected tab is used.
   * If there's no winowd new one is be created. If any window isn't focused
   * first window is used.
   *
   * @param {Object} requestObj ARC request object (url, method, headers, payload)
   * @param {?Number} tab Tab index in the window.
   * @return {Promise} Promise resolved when the command was sent to the window.
   */
  updateRequest(requestObj, tab) {
    return this.getActiveWindow()
    .then(win => {
      log.info('Updating request in active window. Update tab is', tab);
      win.webContents.send('request-action', 'update-request', requestObj, tab);
    });
  }

  /**
   * Opens a new tab currently focused window or first window of the list of
   * opened windows, or creates a new window if can't determine current window.
   *
   * @return {Promise} Promise resolved when command was sent to window
   */
  newTab() {
    return this.getActiveWindow()
    .then(win => {
      win.webContents.send('request-action', 'new-tab');
    });
  }
}

const arcApp = new Arc();
arcApp.attachListeners();

// Unit testing
if (process.env.NODE_ENV === 'test') {
  const testInterface = require('./scripts/main/test-interface');
  testInterface(app, arcApp);
}

// TODO: // move this to seperate file that is responsible for IPC
ipcMain.on('save-dialog', function(event, args) {
  args = args || {};
  const options = {
    title: 'Save to file'
  };
  if (args.file) {
    options.defaultPath = args.file;
  }
  dialog.showSaveDialog(options, function(filename) {
    event.sender.send('saved-file', filename);
  });
});

ipcMain.on('new-window', function() {
  arcApp.wm.open();
});

ipcMain.on('toggle-devtools', (event) => {
  event.sender.webContents.toggleDevTools();
});

ipcMain.on('oauth-2-get-token', (event, options) => {
  ArcIdentity.getAuthToken(options)
  .then(token => {
    event.sender.send('oauth-2-token-ready', token);
  })
  .catch(cause => {
    event.sender.send('oauth-2-token-error', cause);
  });
});
ipcMain.on('oauth-2-launch-web-flow', (event, options) => {
  ArcIdentity.launchWebAuthFlow(options)
  .then(token => {
    event.sender.send('oauth-2-token-ready', token);
  })
  .catch(cause => {
    event.sender.send('oauth-2-token-error', cause);
  });
});
ipcMain.on('check-for-update', () => {
  arcApp.us.check({
    notify: false
  });
});
ipcMain.on('install-update', () => {
  arcApp.us.installUpdate();
});

ipcMain.on('google-drive-data-save', (event, requestId, content, type, fileName) => {
  var config = {
    resource: {
      name: fileName,
      description: 'Advanced REST client data export file.'
    },
    media: {
      mimeType: type || 'application/json',
      body: content
    }
  };
  const drive = new DriveExport();
  drive.create(config)
  .then(result => {
    event.sender.send('google-drive-data-save-result', requestId, result);
  })
  .catch(cause => {
    event.sender.send('google-drive-data-save-error', requestId, cause);
  });
});

ipcMain.on('drive-request-save', (event, requestId, request, fileName) => {
  var driveId;
  if (request.driveId) {
    driveId = request.driveId;
    delete request.driveId;
  }
  var config = {
    resource: {
      name: fileName + '.arc',
    },
    media: {
      mimeType: 'application/json',
      body: request
    }
  };
  const drive = new DriveExport();
  var promise;
  if (driveId) {
    promise = drive.update(driveId, config);
  } else {
    config.resource.description = request.description || 'Advanced REST client export file.';
    promise = drive.create(config);
  }

  promise
  .then(result => {
    event.sender.send('drive-request-save-result', requestId, result);
  })
  .catch(cause => {
    var result = {
      message: cause.message || 'Unknown Goodle Drive save error',
      stack: cause.stack || ''
    };
    event.sender.send('drive-request-save-error', requestId, result);
  });
});

ipcMain.on('open-web-url', (event, url, purpose) => {
  switch (purpose) {
    case 'web-session': arcApp.sm.openWebBrowser(url); break;
  }
});

ipcMain.on('cookies-session', (event, data) => {
  arcApp.sm.handleRequest(event.sender, data);
});
