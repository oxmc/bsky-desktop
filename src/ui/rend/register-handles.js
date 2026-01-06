function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        // If you get "parameter 1 is not of type 'Node'" error, see https://stackoverflow.com/a/77855838/492336
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

// Handle ui:settings
window.ipc.on('ui:settings', (event, settings) => {
    console.log('Received settings:', settings);
});

console.log("Registering notifications...");
// Register IPC listener for notifications
window.ipc.on('ui:notif', (event, other) => {
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
console.log("Notifications registered!");

console.log("Registering badge count...");
// List of possible selectors
const notifSelectors = [
    '#root > div > div > div > div > nav > a:nth-child(5) > div.css-175oi2r > div',
    '#root > div > div > div > div > nav > a:nth-child(4) > div.css-175oi2r > div'
];

// Function to find the first matching element from the list of selectors
function findNotificationElement() {
    for (const selector of notifSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            return element; // Return the first matching element
        }
    }
    return null; // No matching element found
}

// Function to update the badge count
function updateBadgeCount() {
    const badgeElm = findNotificationElement();

    if (badgeElm) {
        const badgeText = badgeElm.innerText.trim();

        if (badgeText && !isNaN(parseInt(badgeText, 10))) {
            const newCount = parseInt(badgeText, 10);
            console.log(`Badge count updated: ${newCount}`);
            window.ipc.send('ui:badgeUpdate', newCount); // Send the new badge count
        } else {
            console.log("Badge element exists but no valid count. Clearing badge count...");
            window.ipc.send('ui:badgeUpdate', 0); // Clear the badge count
        }
    } else {
        console.log("No notification element found. Clearing badge count...");
        window.ipc.send('ui:badgeUpdate', 0); // Clear the badge count
    }
}

// Initial badge count check
updateBadgeCount();

// Create a MutationObserver to watch for changes in the DOM
const observer = new MutationObserver(() => {
    updateBadgeCount(); // Continuously check for badge updates
});

// Observe changes in the entire body to handle dynamic updates
observer.observe(document.body, {
    childList: true,
    subtree: true, // Observe changes in all descendants
});
console.log("Badge count registered!");

// Handle ui:openSettings
window.ipc.on('ui:openSettings', (event, etc) => {
    console.log('Received settings:', event, etc);
    // Head to the settings page
    var page = `/settings${event ? `/${event}` : ''}`;
    window.location.href = page;
});