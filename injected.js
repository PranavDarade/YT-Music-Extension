console.log('[YTQueueExt: Main World] Fetch interceptor active.');

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const requestUrl = args[0] instanceof Request ? args[0].url : args[0];

    const response = await originalFetch.apply(this, args);

    // Clone the response
    if (requestUrl.includes('/youtubei/v1/next')) {
        response.clone().json().then(data => {
            // Only Forward payload that is like queue data
            const str = JSON.stringify(data);
            if (str.includes('playlistPanelRenderer') || str.includes('playlistPanelVideoRenderer')) {
                window.postMessage({
                    type:    'YTQ_RAW_QUEUE_DATA',
                    payload: data
                }, '*');
            }
        })
    }

    return response;
};


(function () {
    let featureEnabled = true;   // auto-scatter on add
    let busy = false;            // ignore store/DOM changes we cause ourselves
    let prevIds = null;          // baseline queue (stable ids) to diff against
    let debounceTimer = null;

    function getStore() {
        const app = document.querySelector('ytmusic-app');
        return app ? (app.inst || app.polymerController || null) : null;
    }
    function getQueueEl() { return document.querySelector('ytmusic-player-queue'); }
    function getContents() {
        const q = getQueueEl();
        return q ? q.querySelector('#contents') : null;
    }

    // Stable per slot id. playlistSetVideoId is unique per queue entry; fall back
    // to videoId so duplicates of the same track are still distinguishable enough.
    function rendererOf(data) {
        if (!data) return null;
        return data.primaryRenderer?.playlistPanelVideoRenderer
            || data.playlistPanelVideoRenderer
            || data;
    }
    function itemId(item) {
        const r = rendererOf(Object.values(item)[0]);
        return r ? (r.playlistSetVideoId || '') + '::' + (r.videoId || '') : '';
    }
    function nodeId(node) {
        const r = rendererOf(node.data);
        return r ? (r.playlistSetVideoId || '') + '::' + (r.videoId || '') : null;
    }

    function currentIds() {
        const store = getStore();
        if (!store) return null;
        return (store.getState().queue.items || []).map(itemId);
    }

    // Fresh view of the upcoming region. Returns null if the DOM and store are
    // out of sync (e.g. the panel hasn't rendered every item) so we never risk
    // dropping items via onDrop. MUST be re-read after every move, because each
    // onDrop re-renders #contents and replaces the nodes.
    function upcomingView() {
        const store = getStore(), contents = getContents();
        if (!store || !contents) return null;
        const st = store.getState().queue;
        const items = st.items || [];
        const data = [...contents.children].filter(c => c.data);
        if (data.length !== items.length) return null; // virtualized / mid-render
        return { contents, upcoming: data.slice(st.selectedItemIndex + 1) };
    }

    function randInt(n) { return Math.floor(Math.random() * n); }

    // Move a single DOM node to `pos` within the upcoming region (relative to the
    // current `upcoming` snapshot), then have YT sync its store to the new order.
    // Only ONE item moves per onDrop — the rest snap back to store order so all
    // reordering is done as a sequence of single moves.
    function moveOne(view, node, pos) {
        const up = view.upcoming;
        const n = up.length;
        if (!node || n === 0) return;
        if (pos >= n) {
            const last = up[n - 1];
            if (node === last) return;
            view.contents.insertBefore(node, last.nextSibling);
        } else {
            const ref = up[pos];
            if (node === ref) return;
            view.contents.insertBefore(node, ref);
        }
        try {
            getQueueEl().onDrop({ detail: { dragEl: node }, preventDefault() {}, stopPropagation() {} });
        } catch (e) {
            console.warn('[YTQueueExt] onDrop failed:', e);
        }
    }

    // Scatter the just-added items into random positions across the upcoming
    // region (existing upcoming order is otherwise preserved).
    function scatter(newIdSet) {
        let moved = 0;
        for (const id of newIdSet) {
            const view = upcomingView();
            if (!view || view.upcoming.length === 0) break;
            const node = view.upcoming.find(c => nodeId(c) === id);
            if (!node) continue;
            moveOne(view, node, randInt(view.upcoming.length));
            moved++;
        }
        if (moved) console.log('[YTQueueExt] Scattered', moved, 'added item(s) into upcoming queue.');
    }

    // Fisher–Yates shuffle of the whole upcoming portion (manual button), applied
    // as a sequence of single moves into the desired order.
    function shuffleUpcoming() {
        const first = upcomingView();
        if (!first || first.upcoming.length < 2) return;
        const desired = first.upcoming.map(nodeId);
        for (let i = desired.length - 1; i > 0; i--) {
            const j = randInt(i + 1);
            [desired[i], desired[j]] = [desired[j], desired[i]];
        }
        for (let k = 0; k < desired.length; k++) {
            const view = upcomingView();
            if (!view || view.upcoming.length <= k) break;
            if (nodeId(view.upcoming[k]) === desired[k]) continue; // already in place
            const node = view.upcoming.find(c => nodeId(c) === desired[k]);
            if (node) moveOne(view, node, k);
        }
        console.log('[YTQueueExt] Shuffled upcoming queue.');
    }

    // React to queue changes. Only additions (growth in length with brand-new
    // ids) trigger a scatter; advance/removal/our-own-reorders just rebaseline.
    function processChange() {
        if (busy || !featureEnabled) return;
        const ids = currentIds();
        if (!ids) return;

        if (prevIds === null) { prevIds = ids; return; } // first run = baseline only

        const prevSet = new Set(prevIds);
        const newIds = ids.filter(id => !prevSet.has(id));

        if (newIds.length > 0 && ids.length > prevIds.length) {
            busy = true;
            try { scatter(new Set(newIds)); } finally { busy = false; }
        }
        prevIds = currentIds(); // rebaseline to the post-scatter order
    }

    function scheduleProcess() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processChange, 500);
    }

    // Watch the queue contents for added/reordered nodes. Re-acquires the
    // contents element if YT Music rebuilds the queue (SPA re-render).
    let observed = null;
    const observer = new MutationObserver(scheduleProcess);
    function ensureObserving() {
        const contents = getContents();
        if (contents && contents !== observed) {
            observer.disconnect();
            observer.observe(contents, { childList: true });
            observed = contents;
            prevIds = currentIds(); // fresh queue — rebaseline
        }
    }

    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data || e.data.type !== 'YTQ_CMD') return;
        if (e.data.action === 'shuffleUpcoming') {
            busy = true;
            try { shuffleUpcoming(); } finally { busy = false; prevIds = currentIds(); }
        } else if (e.data.action === 'setEnabled') {
            featureEnabled = !!e.data.value;
        }
    });

    function init() {
        if (!getStore() || !getContents()) { setTimeout(init, 500); return; }
        ensureObserving();
        // Keep an eye out for the queue element being rebuilt.
        setInterval(ensureObserving, 1500);
        console.log('[YTQueueExt] Queue engine ready (auto-scatter on add).');
    }
    init();
})();
