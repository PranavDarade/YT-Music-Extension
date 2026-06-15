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
    `;
    (document.head || document.documentElement).appendChild(style);
}

// find panel & build shadow DOM host
function buildHost() {
    if (document.getElementById('ytq-host')) return; 

    const panel = document.querySelector('ytmusic-tab-renderer[tab-identifier="QUEUE"]')
                || document.querySelector('ytmusic-player-queue')
                || document.querySelector('#side-panel');
    
    if (!panel) return;

    const host = document.createElement('div');
    host.id = 'ytq-host';
    panel.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        :host { dispay: block }
        #ytq-root {
            font-family: 'Youtube', Roboto, sans-serif;
            color: #e8eaed;
            background: #212121;
            padding: 8px 0;
            overflow-y: auto;
            max-height: 100%;
        }
        .ytq-row {
            display: flex;
            align-items: center;
            padding: 6px 16px;
            gap; 10px;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.15s;
        }
        .ytq-row:hover { background: rgba(255,255,255,0.08); }
        .ytq-row.active { background: rgba(255,255,255,0.13); }
        .ytq-info { flex: 1; overflow: hidden; }
        .ytq-title {
            font-size: 13px;
            font-weight: 500;
            white-space: nowarp;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ytq-artist {
            font-size: 11px;
            color: #aaa;
            white-space: nowarp;
            overflow: hidden
            text-overflow: ellipsis;
        }
        .ytq-duration {
            font-sizr: 11px;
            color: #aaa;
            flex-shrink: 0;
        }
        .ytq-playing-icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
            fill: #1ed760:
        }
    `;
    shadowRoot.appendChild(style);

    const root = document.createElement('div');
    root.id = 'ytq-root';
    shadowRoot.appendChild(root);

    console.log('[YTQueueExt} Shadow DOM host mounted.');
}

function renderCustomQueue() {
    if (!shadowRoot) return;
    const root = shadowRoot.getElementById('ytq-root');
    if (!root) return;

    root.innerHTML = '';
    const frag = document.createDocumentFragment();

    myQueue.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'ytq-row' + (song.isPlaying ? 'active' : '');
        row.dataset.index = index;

        if (song.isPlaying) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.classList.add('ytq-playing-icon');
            svg.innerHTML = '<path d="M3 18h2V6H3v12zm4 0h2v-6H7v6zm4 2h2V4h-2v16zm4-6h2v-4h-2v4zm4-8v12h2V6h-2z"/>';
            row.appendChild(svg);
        }

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

// Recursive helper to find a key anywhere inside a deeply nested object
function findNestKeys(obj, keyToFind) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj[keyToFind] !== undefined) return obj[keyToFind];

    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const val of values) {
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

        myQueue = cleanQueue;
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMount);
} else {
    tryMount();
}