// Configurations and Constants
const DEBOUNCE_MS = 200;
const MENU_SCAN_DELAY_MS = 120;
const QUEUE_SELECTOR_CANDITATES = [
    'ytmusic-player-queue',
    'ytmusic-player-queue-renderer',
    '.player-queue'
];
const QUEUE_ITEM_SELECTOR = [
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
    // Try data-id attribute first
    const dataId = rowEl.getAttribute('data-id');
    if (dataId) return dataId;
    // Try data-video-id attribute
    const dataVideoId = rowEl.getAttribute('data-video-id');
    if (dataVideoId) return dataVideoId;
    // Try video-id attribute
    const videoId = rowEl.getAttribute('video-id');
    if (videoId) return videoId;
    // Fallback to href parsing
    const anchor = rowEl.querySelector('a[href*="watch"]');
    if (anchor) {
        return parseVideoIdFromHref(anchor.getAttribute('href'));
    }
    return null;
}