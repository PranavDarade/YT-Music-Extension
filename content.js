console.log('[YTQueueExt] Content Script Loaded. Injecting spy...');

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
    
}