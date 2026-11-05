// Settings page logic. Talks to the main process through window.appSettings
// (src/ui/preload-settings.js).
const api = window.appSettings;

const INSTALL_TYPES = {
    appimage: 'AppImage',
    deb: 'Debian package (.deb)',
    rpm: 'RPM package',
    pacman: 'Arch package',
    zip: 'Portable (zip)',
    nsis: 'Installer',
    mac: 'macOS app',
    dev: 'Development build',
};

const SANDBOX_STATES = {
    ok: 'Enabled',
    'needs-profile': 'Disabled (needs AppArmor profile)',
    unavailable: 'Disabled (not supported by this system)',
};

document.body.classList.add(`platform-${new URLSearchParams(location.search).get('platform')}`);

// Sidebar navigation
function showPage(name) {
    for (const item of document.querySelectorAll('.nav-item')) {
        item.classList.toggle('selected', item.dataset.page === name);
    }
    for (const page of document.querySelectorAll('.page')) {
        page.hidden = page.dataset.page !== name;
    }
    const item = document.querySelector(`.nav-item[data-page="${name}"]`);
    document.getElementById('page-title').textContent = item.dataset.title || item.textContent.trim();
}

for (const item of document.querySelectorAll('.nav-item')) {
    item.addEventListener('click', () => showPage(item.dataset.page));
}

document.getElementById('close-window').addEventListener('click', () => api.windowAction('close'));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') api.windowAction('close');
});

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function setRows(container, rows) {
    container.replaceChildren(...rows.map(([title, value]) => {
        const row = el('div', 'row');
        row.append(el('div', 'row-title', title), el('div', 'row-value', value));
        return row;
    }));
}

async function renderUserstyles() {
    const list = document.getElementById('userstyle-list');
    const styles = await api.userstyles.list();
    if (!styles.length) {
        list.replaceChildren(el('div', 'row row-empty', 'No userstyles installed'));
        return;
    }
    list.replaceChildren(...styles.map((style) => {
        const row = el('div', 'row');
        const text = el('div', 'row-text');
        text.append(el('div', 'row-title', style.name));
        const details = style.error || [style.version && `Version ${style.version}`, style.author, style.description].filter(Boolean).join(' · ');
        if (details) text.append(el('div', `row-subtitle${style.error ? ' error' : ''}`, details));

        const remove = el('button', 'icon-button');
        remove.title = 'Move to Trash';
        remove.append(el('i', 'fa-solid fa-trash-can'));
        remove.addEventListener('click', async () => {
            await api.userstyles.remove(style.file);
            renderUserstyles();
        });

        const toggle = el('label', 'switch');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = style.enabled;
        input.disabled = !!style.error;
        input.addEventListener('change', () => api.userstyles.setEnabled(style.file, input.checked));
        toggle.append(input, el('span'));

        row.append(text, remove, toggle);
        return row;
    }));
}

async function init() {
    const [values, info] = await Promise.all([api.getAll(), api.info()]);

    // Switches
    for (const input of document.querySelectorAll('input[data-setting]')) {
        input.checked = !!values[input.dataset.setting];
        input.addEventListener('change', () => api.set(input.dataset.setting, input.checked));
    }
    // Menus
    for (const select of document.querySelectorAll('select[data-select-setting]')) {
        select.value = values[select.dataset.selectSetting];
        select.addEventListener('change', () => api.set(select.dataset.selectSetting, select.value));
    }

    // GTK theme colors (Linux only)
    if (info.platform === 'linux') {
        document.getElementById('gtk-theme-group').hidden = false;
        const refreshGtkDetail = async () => {
            const current = await api.info();
            document.getElementById('gtk-theme-detail').textContent = current.gtkTheme
                ? `The titlebar and light/dark mode follow ${current.gtkTheme}`
                : 'The titlebar and light/dark mode follow your desktop theme';
        };
        refreshGtkDetail();
        document.querySelector('input[data-setting="appearance.useGtkTheme"]').addEventListener('change', () => setTimeout(refreshGtkDetail, 200));
    }

    // Userstyles
    if (info.site) {
        document.getElementById('userstyles-note').textContent =
            `UserCSS (.user.css) files for ${info.site}, applied on top of the page. LESS and Stylus userstyles are supported.`;
    }
    document.getElementById('add-userstyle').addEventListener('click', async () => {
        await api.userstyles.add();
        renderUserstyles();
    });
    document.getElementById('open-userstyles').addEventListener('click', () => api.userstyles.openFolder());
    window.addEventListener('focus', renderUserstyles); // pick up files dropped into the folder
    renderUserstyles();

    // Software Update
    const appName = info.productName || info.name;
    const status = document.getElementById('update-status');
    document.getElementById('update-name').textContent = appName;
    status.textContent = `Version ${info.version}`;
    document.getElementById('install-note').textContent = info.installType === 'dev'
        ? 'Updates are not installed in development builds.'
        : `Installed as ${INSTALL_TYPES[info.installType] || info.installType}.`;

    const checkButton = document.getElementById('check-updates');
    checkButton.addEventListener('click', async () => {
        checkButton.disabled = true;
        status.textContent = 'Checking for updates…';
        const result = await api.checkForUpdates();
        checkButton.disabled = false;
        status.textContent = {
            'update-available': `Version ${result.info?.latest} is available`,
            'no-update': `${appName} ${info.version} is up to date`,
            'check-failed': 'Could not check for updates',
        }[result.code] || result.msg || '';
    });

    // About
    document.getElementById('about-name').textContent = appName;
    document.getElementById('about-version').textContent = `Version ${info.version}`;
    setRows(document.getElementById('about-details'), [
        ['Installed as', INSTALL_TYPES[info.installType] || info.installType],
        ...(info.platform === 'linux' ? [['Sandbox', SANDBOX_STATES[info.sandbox] || info.sandbox]] : []),
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['License', info.license],
    ]);
    if (info.homepage) {
        document.getElementById('open-website').addEventListener('click', () => api.openExternal(info.homepage));
    } else {
        document.getElementById('website-group').hidden = true;
    }
}

init().catch((error) => console.error('Failed to load settings', error));
