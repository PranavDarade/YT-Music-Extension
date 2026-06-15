console.log('[YTQueueExt] Content Script Loaded. Injecting spy...');

let myQueue = [];
let currentIndex = 0;

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

        // TODO
        processQueueData(rawData);
    }
});

function processQueueData(data) {
    try {
        // Navigate the deep tree to find the array of queue items
        const tabs = rawData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedRenderer?.tabs;
        if (!tabs) return;

        const upNextTab = tabs[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents;

        if (!upNextTab) {
            console.warn('[YTQueueExt] Could not find queue contents in JSON.');
            return;
        }

        // Clean JSON into state object
        const cleanQueue = upNextTab.map(item => {
            const renderer = item.playlistPanelRenderer;
            if (!renderer) return null;

            return {
                id: renderer.videoId,
                title: renderer.title?.runs?.[0]?.text || 'Unknown Title',
                artist: renderer.longBylineText?.runs?.map(r => r.text).join('') || 'Unknown Artist',
                duration: renderer.lengthText?.runs?.[0]?.text || '--:--',
                isPLaying: renderer.selected || false
            };
        }).filter(Boolean);

        console.log('[YTQueueExt] Cleaned Queue State:', cleanQueue);
        myQueue = cleanQueue;
        currentIndex = myQueue.findIndex(s => s.isPLaying);
    } catch (e) {
        console.error('[YTQueueExt] Error parsing queue JSON:', e);
    }
}