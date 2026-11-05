'use strict';

// Loaded on first use: the websocket transport needs the optional 'ws' package
module.exports = {
  get ipc() { return require('./ipc'); },
  get websocket() { return require('./websocket'); },
};
