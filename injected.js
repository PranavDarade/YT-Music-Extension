console.log('[YTQueueExt: Main World] Fetch interceptor active.');

const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const requestUrl = args[0] instanceof Request ? args[0].url : args[0];
    
    const response = await originalFetch.apply(this, args);

    // Clone the response 
    if (requestUrl.includes('/youtubei/v1/next')) {
        response.clone().json().then(data => {
            // Send the pristine JSON back to content.js
            window.postMessage({
                type: 'YTQ_RAW_QUEUE_DATA',
                payload: data
            }, '*');
        }).catch(err => console.error('[YTQueueExt] Failed to parse intercepted fetch:', err));
    }

    return response;
};