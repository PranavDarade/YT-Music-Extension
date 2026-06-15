console.log('[YTQueueExt] Content Script Loaded. Injecting spy...');

let myQueue = [];
let currentIndex = 0;
let customQueueContainer = null;

// Inject the script into the Main 
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
    this.remove();    // clean up the DOM after injection
};
(document.head || document.documentElement).appendChild(script);

// Listen for the raw data coming from injected script
window.addEventListener('message', (event) => {
    // Security check: only accept messages from own window
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'YTQ_RAW_QUEUE_DATA') {
        const rawData = event.data.payload;
        console.log('[YTQueueExt] Jackpot! Raw Queue Data received:', rawData);

        processQueueData(rawData);
    }
});

// Recursive helper to find a key anywhere inside a deeply nested object
function findNestKeys(obj, keyToFind) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj[keyToFind]) return obj[keyToFind];

    const items = Array.isArray(obj) ? obj : Object.values(obj);
    for (const val of items) {
        const found = findNestKeys(val, keyToFind);
        if (found) return found;
    }
    return null;
}

// Main Parser
function processQueueData(data) {
    try {
        const playlistPanel = findNestKeys(data, 'playlistPanelRenderer');

        if (!playlistPanel || !playlistPanel.contents) {
            console.warn('[YTQueueExt] Scanned JSON but could not find a playlistPanelRenderer with contents.');
            return;
        }

        console.log('[YTQueueExt] Dynamic scanner successfully found the playlist target');

        const cleanQueue = playlistPanel.contents.map(item => {
            const renderer = item.playlistPanelVideoRenderer;
            if (!renderer) return null;

            return {
                id: renderer.videoId,
                title: renderer.title?.runs?.[0]?.text 
                || 'Unknown Title',
                artist: renderer.longBylineText?.runs?.map(r => r.text).join('') 
                || 'Unknown Artist',
                duration: renderer.lengthText?.accessibility?.accessibilityData?.label
                || renderer.lengthText?.runs?.[0]?.text 
                || '--:--',
                isPlaying: renderer.selected || false
            };
        }).filter(Boolean);

        console.log('[YTQueueExt] SUCCESS! Cleaned Queue State:', cleanQueue);

        myQueue = cleanQueue;
        currentIndex = myQueue.findIndex(s => s.isPlaying);
        
        if (typeof renderCustomQueue === 'function') {
            renderCustomQueue();
        }
    } catch (e) {
        console.error('[YTQueueExt] Critical error during dynamic parsing:', e);
    }
}