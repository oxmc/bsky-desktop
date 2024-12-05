const { Titlebar, TitlebarColor } = require("../app/titlebar");
const path = require("path");

window.addEventListener('DOMContentLoaded', () => {
  // Title bar:
  const options = {
    icon: path.join(__dirname, 'images', 'logo.ico'),
    iconSize: 20,
    backgroundColor: TitlebarColor.fromHex('#283646'),
    titleHorizontalAlignment: 'center',
    tooltips: {
      minimize: 'Minimize',
      maximize: 'Maximize',
      restoreDown: 'Restore',
      close: 'Close'
    },
    removeMenuBar: true
  };
  new Titlebar(options);
});