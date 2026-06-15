console.log('[YTQueueExt] Content Script Loaded. Injecting spy...');

let myQueue = [];
let currentIndex = 0;
let shadowRoot = null;

// Inject the script into the Main 
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// Hide native queue UI via global CSS
function injectCloak() {
    const style = document.createElement('style');
    style.id = 'ytq-cloak';
    style.textContent = `
        ytmusic-player-queue {
            visibility: hidden !important;
            pointer-events: none !important;
        }
        #ytq-host {
            visibility: visible !important;
            pointer-events: auto !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

// find panel & build shadow DOM host
function buildHost() {
    if (document.getElementById('ytq-host')) return; 

    const panel = document.querySelector('ytmusic-tab-renderer[tab-identifier="QUEUE"]')
                || document.querySelector('ytmusic-player-queue')
                || document.querySelector('#side-panel');
    
    console.log('[YTQueueExt] Panel found:', panel?.tagName ?? 'NULL');
    if (!panel) return;

    const host = document.createElement('div');
    host.id = 'ytq-host';
    panel.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        :host { display: block; height: 100%; }

        #ytq-root {
            font-family: 'YouTube Sans', Roboto, Arial, sans-serif;
            color: #e8eaed;
            background: transparent;
            padding: 4px 0 16px;
            overflow-y: auto;
            height: 100%;
            box-sizing: border-box;
        }

        .ytq-toolbar {
            padding: 8px 16px 12px;
            display: flex;
            gap: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            margin-bottom: 4px;
        }

        .ytq-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(255,255,255,0.08);
            color: #e8eaed;
            border: none;
            border-radius: 20px;
            padding: 6px 14px;
            cursor: pointer;
            font-size: 13px;
            font-family: inherit;
            font-weight: 500;
            letter-spacing: 0.2px;
            transition: background 0.15s;
        }
        .ytq-btn:hover { background: rgba(255,255,255,0.15); }
        .ytq-btn:active { background: rgba(255,255,255,0.2); }

        .ytq-row {
            display: flex;
            align-items: center;
            padding: 6px 16px;
            gap: 12px;
            cursor: pointer;
            border-radius: 0;
            transition: background 0.12s;
            min-height: 52px;
            position: relative;
        }
        .ytq-row:hover { background: rgba(255,255,255,0.07); }
        .ytq-row.active {
            background: rgba(255,255,255,0.10);
        }
        .ytq-row.active::before {
            content: '';
            position: absolute;
            left: 0; top: 0; bottom: 0;
            width: 3px;
            background: #f03;
            border-radius: 0 2px 2px 0;
        }

        .ytq-index {
            font-size: 12px;
            color: #717171;
            width: 16px;
            text-align: center;
            flex-shrink: 0;
        }

        .ytq-playing-icon {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            fill: #f03;
        }

        .ytq-info { flex: 1; overflow: hidden; }

        .ytq-title {
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #e8eaed;
            line-height: 1.4;
        }
        .ytq-row.active .ytq-title { color: #fff; }

        .ytq-artist {
            font-size: 12px;
            color: #aaa;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-top: 2px;
            line-height: 1.3;
        }

        .ytq-duration {
            font-size: 12px;
            color: #717171;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
        }
    `;
    shadowRoot.appendChild(style);

    const root = document.createElement('div');
    root.id = 'ytq-root';

    const toolbar = document.createElement('div');
    toolbar.className = 'ytq-toolbar';

    const shuffleBtn = document.createElement('button');
    shuffleBtn.className = 'ytq-btn';
    shuffleBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
        </svg>
        Shuffle Upcoming`;
    shuffleBtn.addEventListener('click', shuffleUpcoming);
    toolbar.appendChild(shuffleBtn);
    shadowRoot.appendChild(toolbar);
    shadowRoot.appendChild(root);

    console.log('[YTQueueExt] Shadow DOM host mounted.');
}

function renderCustomQueue() {
    if (!shadowRoot) return;
    const root = shadowRoot.getElementById('ytq-root');
    if (!root) return;

    root.innerHTML = '';
    const frag = document.createDocumentFragment();

    myQueue.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'ytq-row' + (song.isPlaying ? ' active' : '');
        row.dataset.index = index;

        const indexEl = document.createElement('div');
        indexEl.className = 'ytq-index';

        if (song.isPlaying) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.classList.add('ytq-playing-icon');
            svg.innerHTML = '<path d="M3 18h2V6H3v12zm4 0h2v-6H7v6zm4 2h2V4h-2v16zm4-6h2v-4h-2v4zm4-8v12h2V6h-2z"/>';
            indexEl.appendChild(svg);
        } else {
            indexEl.textContent = index + 1
        }
        row.appendChild(indexEl);

        const info = document.createElement('div');
        info.className = 'ytq-info';

        const title = document.createElement('div');
        title.className = 'ytq-title';
        title.textContent = song.title;
        
        const artist = document.createElement('div')
        artist.className = 'ytq-artist';
        artist.textContent = song.artist;

        info.appendChild(title);
        info.appendChild(artist);

        const duration = document.createElement('div');
        duration.className = 'ytq-duration';
        duration.textContent = song.duration;

        row.appendChild(info);
        row.appendChild(duration);

        row.addEventListener('click', () => {
            proxyClickNativeItem(index);
        }); 

        frag.appendChild(row);
    });
    
    root.appendChild(frag);

    if (currentIndex >= 0) {
        const activeRow = root.querySelectorAll('.ytq-row')[currentIndex];
        if (activeRow) {
            setTimeout(() => {
                activeRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 50);
        }
    }
}

// Reach outside Shadow DOM, click hidden native row
function proxyClickNativeItem(index) {
    const nativeRows = document.querySelectorAll(
        'ytmusic-player-queue-item, ' + 
        'ytmusic-queue-item, ' +
        '#queue .song-row'
    );

    const target = nativeRows[index];
    if (target) {
        target.click();
        console.log(`[YTQueueExt] Proxy click fired on native row ${index}`);
    } else {
        console.warn(`[YTQueueExt] Native row at index ${index} not found. Selectors may need updating.`);
        
    }
}

const NOT_FOUND = Symbol();
// Recursive helper to find a key anywhere inside a deeply nested object
function findNestKeys(obj, keyToFind) {
    if (!obj || typeof obj !== 'object') return NOT_FOUND;
    if (keyToFind in obj) return obj[keyToFind];

    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const val of values) {
        const found = findNestKeys(val, keyToFind);
        if (found !== NOT_FOUND) return found;
    }
    return NOT_FOUND;
}

// Main Parser
function processQueueData(data) {
    clearPersistedState();
    try {
        console.log('[YTQueueExt] contents keys:', JSON.stringify(Object.keys(data.contents || {})));
        console.log('[YTQueueExt] contents sample:', JSON.stringify(data.contents).slice(0, 500));
        const playlistPanel = findNestKeys(data, 'playlistPanelRenderer');

        if (playlistPanel === NOT_FOUND || !playlistPanel.contents) {
            console.warn('[YTQueueExt] playlistPanelRenderer not found in payload.')
            return;
        }

        const cleanQueue = playlistPanel.contents.map(item => {
            const renderer = item.playlistPanelVideoRenderer;
            if (!renderer) return null;

            return {
                id:        renderer.videoId,
                title:     renderer.title?.runs?.[0]?.text || 'Unknown Title',
                artist:    renderer.longBylineText?.runs?.map(r => r.text).join('') 
                           || 'Unknown Artist',
                duration:  renderer.lengthText?.accessibility?.accessibilityData?.label
                           || renderer.lengthText?.runs?.[0]?.text 
                           || '--:--',
                isPlaying: renderer.selected || false
            };
        }).filter(Boolean);

        console.log('[YTQueueExt] Cleaned Queue:', cleanQueue);

        const seen = new Set();
        myQueue = cleanQueue.filter(song => {
            if (seen.has(song.id)) return false;
            seen.add(song.id);
            return true;
        });
        currentIndex = myQueue.findIndex(s => s.isPlaying);
        renderCustomQueue();
    } catch (e) {
        console.error('[YTQueueExt] Parsing error:', e);
    }
}

// Listen for intercepted fetch data
window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'YTQ_RAW_QUEUE_DATA') {
        const rawData = event.data.payload;
        processQueueData(rawData);
    }
});

// Cloak first, then wait for DOM to be ready to anchor
injectCloak();

function tryMount() {
    buildHost();
    if (!document.getElementById('ytq-host')) {
        // Panel not ready yet (SPA lazy render), retry
        setTimeout(tryMount, 800);
    }
}

// Fisher Yates Shuffle (Custom Shuffle Engine)
function fisherYatesShuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function shuffleUpcoming() {
    if (currentIndex < 0 || myQueue.length === 0) return;

    const past   = myQueue.slice(0, currentIndex + 1);
    const future = myQueue.slice(currentIndex + 1);

    myQueue = [...past, ...fisherYatesShuffle(future)];

    saveQueueState();
    renderCustomQueue();
}

// Persistance Layer
const STORAGE_KEY = 'ytq_state';

function saveQueueState() {
    chrome.storage.local.set({
        [STORAGE_KEY]: JSON.stringify({
            queue:         myQueue,
            currentIndex:  currentIndex,
            shuffleActive: true
        })
    });
}

function loadPersistanceState(onMiss) {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError || !result[STORAGE_KEY]) {
            onMiss();
            return;
        }

        try {
            const saved = JSON.parse(result[STORAGE_KEY]);
            if (saved.queue && saved.queue.length > 0) {
                myQueue      = saved.queue;
                currentIndex = saved.currentIndex ?? 0;
                console.log('[YTQueueExt] Restored persisted queue:', myQueue.length, 'tracks');
                buildHost();
                renderCustomQueue();
                return;
            }
        } catch (e) {
            console.warn('[YTQueueExt] Persisted state corrupt, falling back.', e);
        }

        onMiss();
    });
}

function boot() {
    loadPersistanceState(() => tryMount());
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

// Wipe saved State
function clearPersistedState() {
    chrome.storage.local.remove(STORAGE_KEY);
}