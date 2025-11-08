// Configurations and Constants
const DEBOUNCE_MS = 200;
const MENU_SCAN_DELAY_MS = 120;
const QUEUE_SELECTOR_CANDIDATES = [
    'ytmusic-player-queue',
    'ytmusic-player-queue-renderer',
    '.player-queue'
];
const QUEUE_ITEM_SELECTORS = [
    'ytmusic-player-queue-item',
    '.ytmusic-player-queue-item-renderer',
    '.ytmusic-player-queue-item'
];
const MENU_ITEM_SELECTORS = [
    'ytmusic-menu-service-item-renderer',
    'ytmusic-menu-navigation-item-renderer',
];
const MENU_PLAYNEXT_TEXT = 'play next';
const MENU_ADDTOQUEUE_TEXT = 'add to queue';
const MENU_STARTRADIO_TEXT = 'start radio';

// Internal State
let myQueue = [];
let originalOrder = [];
let shuffledOrder = [];
let isShuffleOn = false;
let lastMenuTarget = null;
let mutationObserver = null;
let menuObserver = null;
let playbackObserver = null;
let currentIndex = 0;

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

function getSongById(id) {
    return myQueue.find(s => s.id === id) || null;
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
            const itemEls = queueEl.querySelectorAll(QUEUE_ITEM_SELECTORS.join(','));
            const seen = new Set();
            const queueList = [];

            itemEls.forEach(itemEl => {
                const song = extractSongDataFromRow(itemEl);
                if (song && song.id && !seen.has(song.id)) {
                    seen.add(song.id);
                    queueList.push(song);
                }
            });
            return queueList;
        }
    }
    return [];
}

// Shuffle Toggle Logic
function toggleShuffle() {
    const currentId = getCurrentPlayingId();
    if (!isShuffleOn) {
        // enable shuffle
        originalOrder = myQueue.map(item => item.id);
        shuffledOrder = fisherYatesShuffle(originalOrder.slice());
        myQueue = rotateFrom(shuffledOrder, currentId).map(id => getSongById(id));
        isShuffleOn = true;
    } else {
        // disable shuffle
        myQueue = rotateFrom(originalOrder, currentId).map(id => getSongById(id));
        isShuffleOn = false;
    }
    applyQueueToPlayer(myQueue);
}

// Current Song Id
function getCurrentPlayingId() {
    const current = myQueue.find(s => s.meta.isPlaying);
    return current ? current.id : null;
}

// Apply Queue to Player (DOM Manipulation)
function applyQueueToPlayer(queue) {
    const queueEl = QUEUE_SELECTOR_CANDIDATES.map(sel => document.querySelector(sel)).find(el => el);
    if (!queueEl) return;

    // Clear existing queue items
    while (queueEl.firstChild) {
        queueEl.removeChild(queueEl.firstChild);
    }
    
    // Append items in new order
    for (const song of queue) {
        queueEl.appendChild(song.meta.elementRef);
    }
}

function installQueueObserver() {
    const container = document.querySelector(QUEUE_SELECTOR_CANDIDATES.join(','));
    if (!container) return;
    const observer = new MutationObserver(debounce( () => {
        myQueue = scrapeQueueFromDOM();
    }, DEBOUNCE_MS));
    observer.observe(container, { childList: true, subtree: true });
    mutationObserver = observer;
}

// Playback Control 
function initPlaybackObserver() {
    const container = document.querySelector('ytmusic-player-bar');
    if (!container) return;
    const observer = new MutationObserver(debounce( () => {
        const previousId = myQueue[currentIndex]?.id || null;
        const currentId = getCurrentPlayingId();
        if (currentId && currentId !== previousId) {
            currentIndex = myQueue.findIndex(s => s.id === currentId);
        }
    }, DEBOUNCE_MS));
    observer.observe(container, {childList: true, subtree: true });
    playbackObserver = observer;
}

function handleNextSong() {
    currentIndex = getCurrentPlayingId();
    const idx = myQueue.findIndex(s => s.id === getCurrentPlayingId());
    const nextIdx = (idx + 1) % myQueue.length;
    const nextSong = myQueue[nextIdx];
    if (nextSong) {
        nextSong.meta.elementRef.querySelector('.play-button').click();
        currentIndex = nextIdx;
    }
}

function handlePrevSong() {
    const idx = currentIndex;
    const prevIdx = (idx - 1 + myQueue.length) % myQueue.length;
    playSong(myQueue[prevIdx]);
    currentIndex = prevIdx;
}

function playSong(song) {
    if (song.meta.elementRef) {
        const playButton = song.meta.elementRef.querySelector("ytmusic-play-button-renderer");
        if (playButton) {
            playButton.click();
        } else {
            song.meta.elementRef.click();
        }
    }
    const updateQueue = myQueue.map(item => ({
        ...item,
        meta: { ...item.meta, isPlaying: item.id === song.id}
    }));
    myQueue = updateQueue;
}

function onTrackEndDetected() {
    handleNextSong();
}

function simulateClick(el) {
    if (el) {
        el.click();
    }
}

function observePlayingState() {
    const container = QUEUE_SELECTOR_CANDIDATES.map(sel => document.querySelector(sel)).find(el => el) || 
    document.querySelector('ytmusic-player-bar') || null;
    const observer = new MutationObserver(debounce( () => {
        const currentId = myQueue.find(s => s.meta.isPlaying)?.id || null;
        if (!currentId) {
            onTrackEndDetected();
        }
    }, DEBOUNCE_MS));
    if (container) {
        observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
}

// Context Menu Interception
document.addEventListener('contextmenu', (event) => {
    const row = event.target.closest(QUEUE_ITEM_SELECTORS.join(','));
    if (row) {
        lastMenuTarget = row;
    }
})

function installMenuObserver() {
    const container = document.querySelector('ytmusic-menu-popup-renderer');
    if (!container) return;
    const observer = new MutationObserver(debounce( () => {
        const menuItems = container.querySelectorAll(MENU_ITEM_SELECTORS.join(','));
        menuItems.forEach(item => {
            const textEl = item.querySelector('.title.style-scope.ytmusic-menu-service-item-renderer, .title.style-scope.ytmusic-menu-navigation-item-renderer');
            const text = (item.querySelector('.title.style-scope.ytmusic-menu-service-item-renderer, .title.style-scope.ytmusic-menu-navigation-item-renderer')?.textContent || '').trim().toLowerCase();
            if (text.includes(MENU_PLAYNEXT_TEXT)) {
                item.addEventListener('click', () => handlePlayNext(lastMenuTarget), { once: true});
            } else if (text.includes(MENU_ADDTOQUEUE_TEXT)) {
                item.addEventListener('click', () => handleAddToQueue(lastMenuTarget), { once: true});
            } else if (text.includes(MENU_STARTRADIO_TEXT)) {
                item.addEventListener('click', () => handleStartRadio(lastMenuTarget), { once: true});
            }
        })
    }, MENU_SCAN_DELAY_MS));
    observer.observe(container, { childList: true, subtree: true });
    menuObserver = observer; 
}

// Detection Logic
function onMenuChanged() {
    const menuItems = document.querySelectorAll(MENU_ITEM_SELECTORS.join(','));
    menuItems.forEach(item => {
        const textEl = item.innerText.toLowerCase();
        if (textEl.includes(MENU_PLAYNEXT_TEXT)) {
            handlePlayNext(lastMenuTarget);
        } else if (textEl.includes(MENU_ADDTOQUEUE_TEXT)) {
            handleAddToQueue(lastMenuTarget);
        } else if (textEl.includes(MENU_STARTRADIO_TEXT)) {
            handleStartRadio(lastMenuTarget);
        }
    })
}

// Handlers for Menu Actions
function handlePlayNext(targetRow) {
    const song = extractSongDataFromRow(targetRow);
    if (!song || !song.id) return;
    const currentId = getCurrentPlayingId();
    const currentIdx = findIndex(myQueue.find(s => s.id === currentId));
    const insertionIdx = currentIdx + 1;
    myQueue = myQueue.filter(s => s.id !== song.id); // Remove if already in queue
    myQueue.splice(insertionIdx, 0, song); // Insert after current
    applyQueueToPlayer(myQueue);
}

function handleAddToQueue(targetRow) {
    const song = extractSongDataFromRow(targetRow);
    if (!song || !song.id) return;
    myQueue = myQueue.filter(s => s.id !== song.id);
    const insertionIdx = randomBetween(currentIndex + 2, myQueue.length);
    myQueue.splice(insertionIdx, 0, song); // Insert at random position after current
    applyQueueToPlayer(myQueue);
}

async function handleStartRadio(targetRow) {
    console.log("Start Radio clicked - resetting extension state");
    resetInternalState();

    await new Promise(resolve => setTimeout(resolve, 1000));
    myQueue = scrapeQueueFromDOM() || [];
    if (myQueue.length > 0) {
        currentIndex = myQueue.findIndex(s => s.meta.isPlaying);
    } else {
        currentIndex = 0;
    }
}

function resetInternalState() {
    myQueue = [];
    originalOrder = [];
    shuffledOrder = [];
    isShuffleOn = false;
    currentIndex = 0;
}

// Initialization
function init() {
    myQueue = scrapeQueueFromDOM();
    installQueueObserver();
    observePlayingState();
    installMenuObserver();

    const shuffleBtn = document.querySelector('button[aria-label*="Shuffle"]');
    shuffleBtn?.addEventListener('click', () => {
        toggleShuffle();
    })

    const nextBtn = document.querySelector('button[aria-label*="Next"]');
    nextBtn?.addEventListener('click', () => {
        handleNextSong();
    })
    const prevBtn = document.querySelector('button[aria-label*="Previous"]');
    prevBtn?.addEventListener('click', () => {
        handlePrevSong();
    })
}