const { ipcRenderer } = require("electron");
const { Titlebar, TitlebarColor } = require("../app/module/titlebar");
const path = require("path");

// On Linux the view extends below the 30px bar, hidden under PageView (see updateViewBounds
// in main.js). Only PageView's rounded top corners show that strip, so main.js paints it
// with the page's own background colors to keep the seam looking square.
function setSeamColors(left, right) {
  // Everything in this page is absolutely positioned, so <html> would be 0px tall and the
  // gradient sized to nothing (leaving the white canvas): stretch it to the view.
  document.documentElement.style.minHeight = '100%';
  document.documentElement.style.background = `linear-gradient(to right, ${left} 50%, ${right} 50%)`;
}

window.addEventListener('DOMContentLoaded', () => {
  const options = {
    icon: path.join(__dirname, 'img', 'logo.ico'),
    iconSize: 20,
    backgroundColor: TitlebarColor.fromHex('#283646'),
    titleHorizontalAlignment: 'center',
    tooltips: {
      minimize: 'Minimize',
      maximize: 'Maximize',
      restoreDown: 'Restore',
      close: 'Close'
    },
    removeMenuBar: true,
    unfocusEffect: false
  };
  const titlebar = new Titlebar(options);
  window.titlebar = titlebar;

  ipcRenderer.on('titlebar:setTitle', (event, title) => {
    if (window.titlebar) window.titlebar.updateTitle(title);
  });

  ipcRenderer.on('titlebar:setSeamColors', (event, left, right) => setSeamColors(left, right));

  ipcRenderer.on('titlebar:setColor', (event, color) => {
    if (window.titlebar) window.titlebar.updateBackground(TitlebarColor.fromHex(color));
  });
});
