// Configurations and Constants
const DEBOUNCE_MS = 200;
const MENU_SCAN_DELAY_MS = 120;
const QUEUE_SELECTOR_CANDITATES = [
    'ytmusic-player-queue',
    'ytmusic-player-queue-renderer',
    '.player-queue'
];
const QUEUE_ITEM_SELECTORS = [
    'ytmusic-player-queue-item',
    '.ytmusic-player-queue-item-renderer',
];
const MENU_ITEM_SELECTORS = [
    'ytmusic-menu-service-item-renderer',
    'ytmusic-menu-navigation-item-renderer',
];
const MENU_PLAYNEXT_TEXT = 'play next';
const MENU_ADDTOQUEUE_TEXT = 'add to queue';

// Internal State
let myQueue = [];
let originalOrder = null;
let shuffledOrder = null;
let isShuffleOn = false;
let lastMenuTarget = null;
let mutationObserver = null;
let menuObserver = null;

// Utility Helpers (Conceptual)
function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// Rotate list so that startId becomes the first element (Preserves order)
function rotateFrom(list, startId) {
    const idx = list.indexOf(startId);
    if (idx === -1) return list.slice(); // Not found or already first 
    return list.slice(idx).concat(list.slice(0, idx));
}

// Fisher-Yates Shuffle
function fisherYatesShuffle(arr) {
    const array = arr.slice();
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (1 + i));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// dedupe keep-first-occurrence
function dedupeKeepFirstOccurrence(idList) {
    const seen = new Set();
    const out = [];
    for (const id of idList) {
        if (!id) continue;
        if (!seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}

// Safe extract string id from URL 
function parseVideoIdFromHref(href) {
    if(!href) return null;
    const url = new URL(href, window.location.origin);
    return url.searchParams.get('v');
}

// Id (Meta Extraction)
function extractSongDataFromRow(rowEl) {
    if (!rowEl) return null;
    const queueItem = {
        dataId : rowEl.getAttribute('data-id'),
        dataVideoId : rowEl.getAttribute('data-video-id'),
        videoId : rowEl.getAttribute('video-id'),
        title : rowEl.querySelector('.yt-formatted-string.title')?.textContent || null,
        artist : rowEl.querySelector('.yt-simple-endpoint.style-scope.yt-formatted-string')?.textContent || null,
        duration : rowEl.querySelector('.time-status.style-scope.ytmusic-player-queue-item')?.textContent || null,
        index : rowEl.querySelector('.index.style-scope.ytmusic-player-queue-item')?.textContent || null,
        sourceContext : rowEl.querySelector('.source-content.style-scope.ytmusic-player-queue-item')?.textContent || null,
        isPlaying : rowEl.classList.contains('playing'),
        elementRef : rowEl
    };
    return {
        id : queueItem.dataId || queueItem.dataVideoId || queueItem.videoId,
        meta : {
            title : queueItem.title,
            artist : queueItem.artist,
            duration : queueItem.duration,
            index : queueItem.index,
            sourceContext : queueItem.sourceContext,
            isPlaying : queueItem.isPlaying,
            elementRef : queueItem.elementRef
        }
    }
}
    
// Scraping queue from DOM and returning array of song objects
function scrapeQueueFromDOM() {
    for (const queueSelector of QUEUE_SELECTOR_CANDIDATES) {
        const queueEl = document.querySelector(queueSelector);
        if (queueEl) {
            //extractSongDataFromRow(queueEl);
            const itemEls = queueEl.querySelectorAll(QUEUE_ITEM_SELECTORS.join(','));
            const idList = [];
            itemEls.forEach(itemEl => {
                const songId = extractSongDataFromRow(itemEl);
                if (songId) {
                    idList.push(songId);
                }
            });
            return idList;
        }
    }
    return [];
}