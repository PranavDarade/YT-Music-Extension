console.log('[YTQueueExt] content script loaded');

// Page Content script bridge
window.addEventListener('message', (ev) => {
    try {
        if (!ev.data || ev.data.source !== 'YTQ_PAGE') return;
        if (ev.data.type === 'REQUEST_STATE') {
            const payload = {
                myQueue: (myQueue || []).map(s => ({
                    id: s.id,
                    title: s.meta?.title || null,
                    artist: s.meta?.artist || null,
                    isPlaying: s.meta?.isPlaying 
                })),
                isShuffleOn: !!isShuffleOn,
                currentIndex: currentIndex || 0
            };
            window.postMessage({ source: 'YTQ_EXT', type: 'RESPONSE_STATE', payload}, '*');
            } else if (ev.data.type === 'REQUEST_RELINK') {
                relinkElementRefs();
                window.postMessage({ source: 'YTQ_EXT', type: 'RESPONSE_RELINK_DONE'}, '*');
            }
        } catch (e) {
            console.warn('[YTQ bridge] error handling message', e);
        }
});

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

function serializeQueue() {
  return myQueue.map(s => ({
    id: s.id,
    title: s.meta.title,
    artist: s.meta.artist,
    duration: s.meta.duration
  }));
}

function randomBetween(min, max) {
    if (max <= min) return min;
    const rand = Math.floor(Math.random() * (max - min + 1)) + min;
    return Math.max(min, Math.min(rand, max));
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
    try {
        const url = new URL(href, window.location.origin);
        return url.searchParams.get('v');
    } catch (e) {
        return null;
    }
}

// Id (Meta Extraction)
function extractSongDataFromRow(rowEl) {
    if (!rowEl) return null;
    const queueItem = {
        dataId : rowEl.getAttribute('data-id'),
        dataVideoId : rowEl.getAttribute('data-video-id'),
        videoId : rowEl.getAttribute('video-id'),
        title: rowEl.querySelector('.title')?.textContent?.trim() || rowEl.querySelector('.yt-formatted-string')?.textContent?.trim() || null,
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
    console.warn("Queue container not found in DOM.");
    return [];
}

// Shuffle Toggle Logic
function toggleShuffle() {
    const currentId = getCurrentPlayingId();
    if (!isShuffleOn) {
        // enable shuffle
        originalOrder = myQueue.map(item => item.id);
        shuffledOrder = fisherYatesShuffle(originalOrder.slice());
        myQueue = rotateFrom(shuffledOrder, currentId).map(id => getSongById(id)).filter(Boolean); // remove nulls
        isShuffleOn = true;
    } else {
        // disable shuffle
        myQueue = rotateFrom(originalOrder, currentId).map(id => getSongById(id)).filter(Boolean);
        isShuffleOn = false;
    }
    applyQueueToPlayer(myQueue);
    saveQueueState();
}

// Current Song Id
function getCurrentPlayingId() {
    const current = myQueue.find(s => s.meta.isPlaying);
    return current ? current.id : null;
}

// Apply Queue to Player (DOM Manipulation)
function applyQueueToPlayer(queue) {
    const queueEl = findQueueContainer();
    if (!queueEl) return;

    // Clear existing queue items
    while (queueEl.firstChild) queueEl.removeChild(queueEl.firstChild);
    
    const frag = document.createDocumentFragment(); // Build new order in a fragment for performance

    // Process each song
    for (const song of queue) {
        // Attempt to relink if elementRef missing/stale
        if (!song.meta.elementRef || !document.contains(song.meta.elementRef)) {
            const relink = document.querySelector(
                `[data-video-id="${song.id}"], [video-id="${song.id}"], [data-id="${song.id}"]`
            );
            if (relink) {
                song.meta.elementRef = relink;
            } else {
                console.warn(`Skipping song '${song.meta.title}' — missing or stale elementRef.`);
                continue;
            }
        }

        // Try to find the live DOM node or fallback to stored ref
        const node = document.querySelector(
            `[data-video-id="${song.id}"], [video-id="${song.id}"], [data-id="${song.id}"]`
        ) || song.meta.elementRef;
    
        if (node && document.contains(node)) {
            // Refresh ref if we found a newer node
            if (node !== song.meta.elementRef) song.meta.elementRef = node;
            
            // Append if not already in the container
            if (!queueEl.contains(node)) frag.appendChild(node);
        }
    }

    // Apply all updates at once
    queueEl.appendChild(frag);
}

function findQueueContainer() {
    for (const selector of QUEUE_SELECTOR_CANDIDATES) {
        const el = document.querySelector(selector);
        if (el) return el;
    }
    return null;
}

function installQueueObserver() {
    if (mutationObserver) mutationObserver.disconnect();

    const observer = new MutationObserver(debounce(() => {
        const container = findQueueContainer();
        if (container) myQueue = scrapeQueueFromDOM();
    }, DEBOUNCE_MS));

    const container = findQueueContainer();
    if (container) observer.observe(container, { childList: true, subtree: true });
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
    const currentId = getCurrentPlayingId();
    const idx = myQueue.findIndex(s => s.id === currentId);
    if (idx === -1) return;
    const nextIdx = (idx + 1) % myQueue.length;
    const nextSong = myQueue[nextIdx];
    if (nextSong?.meta?.elementRef) {
        nextSong.meta.elementRef.querySelector('.play-button, ytmusic-play-button-renderer')?.click();
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
    const container = findQueueContainer() || document.querySelector('ytmusic-player-bar');
    if (!container) return;

    let lastPlayingId = getCurrentPlayingId();

    const observer = new MutationObserver(debounce(() => {
        const currentId = getCurrentPlayingId();

        if (currentId && currentId !== lastPlayingId) {
            // Song changed → update currentIndex
            currentIndex = myQueue.findIndex(s => s.id === currentId);
            lastPlayingId = currentId;
        } 
        else if (!currentId && lastPlayingId) {
            // Nothing playing anymore → end of track or queue
            onTrackEndDetected();
            lastPlayingId = null;
        }
    }, DEBOUNCE_MS));

    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    playbackObserver = observer;
}


// Context Menu Interception
document.addEventListener('contextmenu', (event) => {
    const row = event.target.closest(QUEUE_ITEM_SELECTORS.join(','));
    if (row) {
        lastMenuTarget = row;
    }
})

function installMenuObserver() {
    const observer = new MutationObserver(debounce(() => {
        const container = document.querySelector('ytmusic-menu-popup-renderer');
        if (!container) return;

        const menuItems = container.querySelectorAll(MENU_ITEM_SELECTORS.join(','));
        menuItems.forEach(item => {
            const text = (item.querySelector('.title')?.textContent.trim().toLowerCase()) || '';

            // Reset old handlers before re-binding
            const cleanItem = item.cloneNode(true);
            item.replaceWith(cleanItem);

            if (text.includes(MENU_PLAYNEXT_TEXT)) {
                cleanItem.addEventListener('click', () => handlePlayNext(lastMenuTarget), { once: true });
            } 
            else if (text.includes(MENU_ADDTOQUEUE_TEXT)) {
                cleanItem.addEventListener('click', () => handleAddToQueue(lastMenuTarget), { once: true });
            } 
            else if (text.includes(MENU_STARTRADIO_TEXT)) {
                cleanItem.addEventListener('click', () => handleStartRadio(lastMenuTarget), { once: true });
            }
        });
    }, MENU_SCAN_DELAY_MS));

    observer.observe(document.body, { childList: true, subtree: true });
    menuObserver = observer;
}

// Handlers for Menu Actions
function handlePlayNext(targetRow) {
    const song = extractSongDataFromRow(targetRow);
    if (!song || !song.id) return;
    const currentId = getCurrentPlayingId();
    const currentIdx = myQueue.findIndex(s => s.id === currentId);
    const insertionIdx = currentIdx + 1;
    myQueue = myQueue.filter(s => s.id !== song.id); // Remove if already in queue
    myQueue.splice(insertionIdx, 0, song);
    applyQueueToPlayer(myQueue);
    saveQueueState();

}

function handleAddToQueue(targetRow) {
    const song = extractSongDataFromRow(targetRow);
    if (!song || !song.id) return;
    myQueue = myQueue.filter(s => s.id !== song.id);
    const insertionIdx = randomBetween(currentIndex + 2, myQueue.length);
    if (insertionIdx <= currentIndex) currentIndex++; // Adjust current index if needed
    myQueue.splice(insertionIdx, 0, song);
    applyQueueToPlayer(myQueue);
    saveQueueState();
}

async function handleStartRadio(targetRow) {
    console.log("Start Radio clicked - resetting extension state");
    resetInternalState();

    await new Promise(resolve => setTimeout(resolve, 1000));
    myQueue = scrapeQueueFromDOM() || [];
    if (myQueue.length > 0) {
        currentIndex = myQueue.findIndex(s => s.meta.isPlaying);
    }
    saveQueueState();
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
    loadQueueState(); // repopulates myQueue minimally and attempts to re-link
    if (!myQueue || myQueue.length === 0) myQueue = scrapeQueueFromDOM();
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
    applyQueueToPlayer(myQueue);
}

// Persist Extension State
function saveQueueState() {
  const simpleQueue = serializeQueue();
  localStorage.setItem('ytmQueueState', JSON.stringify({
    queue: simpleQueue,
    isShuffleOn,
    currentIndex
  }));
}

function loadQueueState() {
  const data = JSON.parse(localStorage.getItem('ytmQueueState') || '{}');
  if (!data.queue) return;
  // Recreate minimal myQueue entries (no elementRef)
  myQueue = data.queue.map(q => ({ id: q.id, meta: { title: q.title, artist: q.artist, duration: q.duration } }));
  isShuffleOn = data.isShuffleOn || false;
  currentIndex = data.currentIndex || 0;

  // Attempt to re-link elementRef to live DOM nodes when possible:
  myQueue.forEach(item => {
    const node = document.querySelector(`[data-video-id="${item.id}"], [video-id="${item.id}"], [data-id="${item.id}"]`);
    if (node) item.meta.elementRef = node;
  });
}

// relink elementRefs on demand
function relinkElementRefs() {
    myQueue.forEach(item =>{
        if (!item.meta) item.meta = {};
        if (!item.meta.elementRef) {
            const node = document.querySelector(`[data-video-id="${item.id}"], [video-id="${item.id}"], [data-id="${item.id}"]`);
            if (node) item.meta.elementRef = node;
        }
    });
}

// Autostart 
function waitForYTMusic() {
  const player = document.querySelector('ytmusic-player-bar');
  if (player) {
    console.log('[YTQueueExt] YT Music detected → initializing...');
    init();
  } else {
    console.log('[YTQueueExt] waiting for YT Music to load...');
    setTimeout(waitForYTMusic, 1000);
  }
}
waitForYTMusic();
