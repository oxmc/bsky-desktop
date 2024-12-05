const { ipcRenderer } = require('electron');

function percentify(num) {
    return (num * 100).toFixed(2) + "%";
};

document.addEventListener('DOMContentLoaded', () => {
    const infotext = document.getElementById('progress-text');
    const progtext = document.getElementById('download-progress-text');
    const progbar = document.getElementById('progbar');
    const progbardiv = document.getElementById('progbardiv');

    // Handle ipc events:
    ipcRenderer.on('ui:notif', (event, other) => {
        console.log(`Displaying notification: ${JSON.stringify(event)}`);
        try {
            console.log('Displaying notification:', event.title, event.message);
            iziToast.show({
                title: event.title,
                message: event.message,
                position: 'topRight',
                timeout: 5000,
                ...event.options,
            });
        } catch (error) {
            console.error('Failed to display notification:', error);
        }
    });
    ipcRenderer.on('ui:progbar', (event, other) => {
        console.log('Updating progress bar:', percentify(other.prog));
        progbardiv.style.display = '';
        if (other.reason === 'update') {
            progbar.style.width = `${percentify(other.prog)}`;
        };
    });
    ipcRenderer.on('ui:progtext', (event, other) => {
        console.log('Updating progress text:', other);
        infotext.innerText = other.title;
        progtext.innerText = other.subtitle;
    });
});