/* ============================================
   HAKAI MPC 2000 — APP.JS
   YouTube OAuth + Crate Digging + Pad Chopping
   ============================================ */

// ==========================================
// ▶▶▶  YOUR CREDENTIALS — EDIT THESE  ◀◀◀
// ==========================================
const CONFIG = {
    // Your YouTube Data API v3 key (for search when not signed in)
    API_KEY: 'AIzaSyDaHVAAXKFjOiXc7pw9exh92MJYXIQ4Kvg',

    // Your OAuth 2.0 Client ID from Google Cloud Console
    CLIENT_ID: '564150027983-aero1s5g4ctnm5iihv3c1un23rc2mnk5.apps.googleusercontent.com',

    // Scopes needed for playlist creation, like, and rate
    SCOPES: 'https://www.googleapis.com/auth/youtube',
};

// ==========================================
// GLOBAL STATE
// ==========================================
let currentPlaylist = [];
let currentVideoIndex = 0;
let pads = new Array(12).fill(null);
let player = null;
let playerReady = false;
let currentSpeed = 1.0;

// OAuth state
let accessToken = null;
let tokenClient = null;
let userInfo = null;
let hakaiPlaylistId = null; // YouTube playlist ID for "Add to Playlist"

// ==========================================
// DOM REFS
// ==========================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const screen1 = $('#screen1');
const screen2 = $('#screen2');
const createBtn = $('#createPlaylistBtn');
const loadingIndicator = $('#loadingIndicator');
const yearStartSel = $('#yearStart');
const yearEndSel = $('#yearEnd');
const videoTitleEl = $('#videoTitle');
const videoIndexEl = $('#videoIndex');
const authBtn = $('#authBtn');
const authLabel = $('#authLabel');
const authDot = $('#authDot');
const headerAvatar = $('#headerAvatar');

// ==========================================
// INIT: Year dropdowns
// ==========================================
(function initYears() {
    const now = new Date().getFullYear();
    for (let y = now; y >= 1950; y--) {
        yearStartSel.appendChild(new Option(y, y));
        yearEndSel.appendChild(new Option(y, y));
    }
    yearStartSel.value = '1965';
    yearEndSel.value = '1985';
})();

// ==========================================
// GOOGLE OAUTH 2.0 — TOKEN MODEL
// ==========================================
function initGoogleAuth() {
    if (typeof google === 'undefined' || !google.accounts) {
        console.warn('[HAKAI] Google Identity Services not loaded');
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: handleTokenResponse,
    });

    console.log('[HAKAI] OAuth token client ready');
}

function handleTokenResponse(resp) {
    if (resp.error) {
        console.error('[HAKAI] OAuth error:', resp);
        showToast('SIGN IN FAILED');
        return;
    }

    accessToken = resp.access_token;
    console.log('[HAKAI] Signed in — token acquired');

    // Fetch user profile
    fetchUserProfile();

    // Update UI
    authDot.classList.add('connected');
    authLabel.textContent = 'CONNECTED';
    authBtn.classList.add('signed-in');

    showToast('YOUTUBE CONNECTED');
}

async function fetchUserProfile() {
    try {
        const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        userInfo = await resp.json();

        if (userInfo.picture) {
            headerAvatar.src = userInfo.picture;
            headerAvatar.style.display = 'block';
        }

        if (userInfo.name) {
            authLabel.textContent = userInfo.name.toUpperCase();
        }
    } catch (e) {
        console.warn('[HAKAI] Could not fetch profile:', e);
    }
}

// Auth button click
authBtn.addEventListener('click', () => {
    if (CONFIG.CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
        showToast('SET YOUR CLIENT_ID IN APP.JS');
        return;
    }
    if (accessToken) {
        // Already signed in — sign out
        accessToken = null;
        userInfo = null;
        hakaiPlaylistId = null;
        authDot.classList.remove('connected');
        authLabel.textContent = 'CONNECT YOUTUBE';
        authBtn.classList.remove('signed-in');
        headerAvatar.style.display = 'none';
        google.accounts.oauth2.revoke(accessToken);
        showToast('SIGNED OUT');
        return;
    }
    tokenClient.requestAccessToken();
});

// ==========================================
// YOUTUBE IFRAME API
// ==========================================
function onYouTubeIframeAPIReady() {
    console.log('[HAKAI] YouTube IFrame API ready');
    // Also init Google Auth once both scripts are loaded
    initGoogleAuth();
}

function initPlayer(videoId) {
    if (player) player.destroy();
    playerReady = false;

    player = new YT.Player('ytPlayer', {
        width: '100%',
        height: '100%',
        videoId: videoId,
        playerVars: {
            autoplay: 1,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            fs: 0
        },
        events: {
            onReady: () => { playerReady = true; },
            onStateChange: () => {}
        }
    });
}

// ==========================================
// SEARCH — Uses API key (no auth needed)
// ==========================================
createBtn.addEventListener('click', async () => {
    const keywords = $('#keywords').value.trim();
    if (!keywords) { showToast('ENTER KEYWORDS'); return; }

    createBtn.style.display = 'none';
    loadingIndicator.classList.add('show');

    try {
        const results = await searchYouTube(
            keywords,
            yearStartSel.value,
            yearEndSel.value,
            $('#maxLength').value,
            $('#language').value,
            parseInt($('#playlistLength').value)
        );

        if (!results.length) {
            showToast('NO RESULTS — TRY DIFFERENT KEYWORDS');
            createBtn.style.display = '';
            loadingIndicator.classList.remove('show');
            return;
        }

        currentPlaylist = results;
        currentVideoIndex = 0;
        hakaiPlaylistId = null; // Reset per session
        switchToScreen2();

    } catch (err) {
        console.error('[HAKAI] Search error:', err);
        showToast('API ERROR — CHECK CONSOLE');
        createBtn.style.display = '';
        loadingIndicator.classList.remove('show');
    }
});

async function searchYouTube(keywords, yearStart, yearEnd, maxLength, language, maxResults) {
    // Demo mode if no API key
    if (CONFIG.API_KEY === 'YOUR_API_KEY_HERE') {
        return getDemoPlaylist(maxResults);
    }

    const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        q: keywords,
        publishedAfter: `${yearStart}-01-01T00:00:00Z`,
        publishedBefore: `${yearEnd}-12-31T23:59:59Z`,
        maxResults: maxResults,
        key: CONFIG.API_KEY,
    });

    if (maxLength !== 'any') params.set('videoDuration', maxLength);
    if (language) params.set('relevanceLanguage', language);

    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!resp.ok) throw new Error(`YT API ${resp.status}`);
    const data = await resp.json();

    return (data.items || []).map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title
    }));
}

function getDemoPlaylist(count) {
    const demos = [
        { videoId: 'dQw4w9WgXcQ', title: 'DEMO: Classic Track 1' },
        { videoId: 'oHg5SJYRHA0', title: 'DEMO: Vintage Soul Sample' },
        { videoId: 'L_jWHffIx5E', title: 'DEMO: All Star Funk' },
        { videoId: '9bZkp7q19f0', title: 'DEMO: International Hit' },
        { videoId: 'kJQP7kiw5Fk', title: 'DEMO: Latin Groove' },
        { videoId: 'RgKAFK5djSk', title: 'DEMO: Smooth Ballad' },
        { videoId: 'JGwWNGJdvx8', title: 'DEMO: Uptown Funk' },
        { videoId: 'YQHsXMglC9A', title: 'DEMO: Hello' },
        { videoId: 'hT_nvWreIhg', title: 'DEMO: Counting Stars' },
        { videoId: 'OPf0YbXqDm0', title: 'DEMO: Uptown Girl' },
    ];
    return demos.slice(0, count);
}

// ==========================================
// YOUTUBE AUTHENTICATED ACTIONS
// ==========================================

// Helper: make an authenticated YouTube API call
async function ytApi(endpoint, method = 'GET', body = null) {
    if (!accessToken) return null;

    const opts = {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, opts);
    if (!resp.ok) {
        const err = await resp.text();
        console.error(`[HAKAI] YT API error (${resp.status}):`, err);
        throw new Error(`YT API ${resp.status}`);
    }
    // Some endpoints return 204 (no content)
    if (resp.status === 204) return {};
    return resp.json();
}

// F2: ADD TO PLAYLIST
// Creates a "HAKAI CRATE" playlist on your channel if needed,
// then adds the current video to it.
async function addToPlaylist() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;

    if (!accessToken) {
        saveToLocal('hakai_saved_samples', video);
        showToast('SAVED LOCALLY (SIGN IN FOR YT)');
        return;
    }

    try {
        // Create playlist once per session
        if (!hakaiPlaylistId) {
            const playlistName = $('#playlistName').value.trim() || 'HAKAI CRATE';
            const pl = await ytApi('playlists?part=snippet,status', 'POST', {
                snippet: {
                    title: playlistName,
                    description: 'Created by HAKAI MPC 2000 Crate Digging Center'
                },
                status: { privacyStatus: 'private' }
            });
            hakaiPlaylistId = pl.id;
            console.log('[HAKAI] Created playlist:', hakaiPlaylistId);
        }

        // Add video to playlist
        await ytApi('playlistItems?part=snippet', 'POST', {
            snippet: {
                playlistId: hakaiPlaylistId,
                resourceId: {
                    kind: 'youtube#video',
                    videoId: video.videoId
                }
            }
        });

        flashKey('#btnF2');
        showToast('ADDED TO YOUTUBE PLAYLIST');

    } catch (e) {
        console.error('[HAKAI] Add to playlist failed:', e);
        showToast('PLAYLIST ERROR — TRY AGAIN');
    }
}

// F3: WATCH LATER
// Note: YouTube deprecated the Watch Later playlist via API in 2020.
// We save to a "HAKAI — Watch Later" playlist instead.
let watchLaterPlaylistId = null;

async function addToWatchLater() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;

    if (!accessToken) {
        saveToLocal('hakai_watch_later', video);
        showToast('SAVED LOCALLY (SIGN IN FOR YT)');
        return;
    }

    try {
        if (!watchLaterPlaylistId) {
            const pl = await ytApi('playlists?part=snippet,status', 'POST', {
                snippet: {
                    title: 'HAKAI — Watch Later',
                    description: 'Watch Later queue from HAKAI MPC 2000'
                },
                status: { privacyStatus: 'private' }
            });
            watchLaterPlaylistId = pl.id;
        }

        await ytApi('playlistItems?part=snippet', 'POST', {
            snippet: {
                playlistId: watchLaterPlaylistId,
                resourceId: {
                    kind: 'youtube#video',
                    videoId: video.videoId
                }
            }
        });

        flashKey('#btnF3');
        showToast('ADDED TO WATCH LATER');

    } catch (e) {
        console.error('[HAKAI] Watch Later failed:', e);
        showToast('WATCH LATER ERROR');
    }
}

// F4: LIKE
async function likeVideo() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;

    if (!accessToken) {
        saveToLocal('hakai_favorites', video);
        showToast('♥ SAVED LOCALLY (SIGN IN FOR YT)');
        return;
    }

    try {
        await ytApi(`videos/rate?id=${video.videoId}&rating=like`, 'POST');
        flashKey('#btnF4');
        showToast('♥ LIKED ON YOUTUBE');
    } catch (e) {
        console.error('[HAKAI] Like failed:', e);
        showToast('LIKE ERROR');
    }
}

// ==========================================
// SCREEN TRANSITIONS
// ==========================================
function switchToScreen2() {
    screen1.classList.remove('active');
    screen2.classList.add('active');
    loadingIndicator.classList.remove('show');
    createBtn.style.display = '';
    clearAllPads();
    currentSpeed = 1.0;
    updateSpeedUI();
    loadCurrentVideo();
}

function switchToScreen1() {
    if (player && playerReady) player.pauseVideo();
    screen2.classList.remove('active');
    screen1.classList.add('active');
}

function loadCurrentVideo() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;
    videoTitleEl.textContent = video.title;
    videoIndexEl.textContent = `${currentVideoIndex + 1} / ${currentPlaylist.length}`;
    initPlayer(video.videoId);
}

// ==========================================
// TRANSPORT CONTROLS
// ==========================================
$('#btnPlay').addEventListener('click', () => {
    if (player && playerReady) { player.playVideo(); showToast('▶ PLAY'); }
});
$('#btnStop').addEventListener('click', () => {
    if (player && playerReady) { player.pauseVideo(); showToast('■ STOP'); }
});
$('#btnNext').addEventListener('click', () => {
    if (!currentPlaylist.length) return;
    currentVideoIndex = (currentVideoIndex + 1) % currentPlaylist.length;
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI();
    loadCurrentVideo(); showToast('NEXT ▶▶');
});
$('#btnLast').addEventListener('click', () => {
    if (!currentPlaylist.length) return;
    currentVideoIndex = (currentVideoIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI();
    loadCurrentVideo(); showToast('◀◀ LAST');
});

// ==========================================
// SPEED CONTROLS
// ==========================================
$$('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        if (currentSpeed === speed) {
            currentSpeed = 1.0;
            if (player && playerReady) player.setPlaybackRate(1.0);
            showToast('SPEED: 1.0x');
        } else {
            currentSpeed = speed;
            if (player && playerReady) player.setPlaybackRate(speed);
            showToast(`SPEED: ${speed}x`);
        }
        updateSpeedUI();
    });
});

function updateSpeedUI() {
    $$('.speed-btn').forEach(btn => {
        btn.classList.toggle('active-speed',
            parseFloat(btn.dataset.speed) === currentSpeed && currentSpeed !== 1.0);
    });
}

// ==========================================
// PAD SYSTEM
// ==========================================
$$('.pad').forEach(padEl => {
    const idx = parseInt(padEl.dataset.pad);

    padEl.addEventListener('click', () => {
        if (!player || !playerReady) return;
        if (pads[idx] === null) {
            const time = player.getCurrentTime();
            pads[idx] = time;
            padEl.classList.add('active');
            padEl.querySelector('.pad-time').textContent = formatTime(time);
            showToast(`PAD ${idx + 1} SET — ${formatTime(time)}`);
        } else {
            player.seekTo(pads[idx], true);
            player.playVideo();
            padEl.style.filter = 'brightness(1.5)';
            setTimeout(() => { padEl.style.filter = ''; }, 120);
        }
    });

    padEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (pads[idx] !== null) {
            pads[idx] = null;
            padEl.classList.remove('active');
            padEl.querySelector('.pad-time').textContent = '';
            showToast(`PAD ${idx + 1} CLEARED`);
        }
    });

    let pressTimer;
    padEl.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
            if (pads[idx] !== null) {
                pads[idx] = null;
                padEl.classList.remove('active');
                padEl.querySelector('.pad-time').textContent = '';
                showToast(`PAD ${idx + 1} CLEARED`);
            }
        }, 600);
    }, { passive: true });
    padEl.addEventListener('touchend', () => clearTimeout(pressTimer));
    padEl.addEventListener('touchmove', () => clearTimeout(pressTimer));
});

function clearAllPads() {
    pads = new Array(12).fill(null);
    $$('.pad').forEach(p => {
        p.classList.remove('active');
        p.querySelector('.pad-time').textContent = '';
    });
}

// ==========================================
// SOFT KEYS (F1-F4) — wired to real YT actions
// ==========================================
$('#btnF1').addEventListener('click', () => { switchToScreen1(); showToast('BACK TO CRATE DIGGING'); });
$('#btnF2').addEventListener('click', addToPlaylist);
$('#btnF3').addEventListener('click', addToWatchLater);
$('#btnF4').addEventListener('click', likeVideo);

// Hardware F-key buttons
const fkeyBtns = $$('.fkey-row .hw-btn-small');
fkeyBtns[0]?.addEventListener('click', () => $('#btnF1').click());
fkeyBtns[1]?.addEventListener('click', () => $('#btnF2').click());
fkeyBtns[2]?.addEventListener('click', () => $('#btnF3').click());
fkeyBtns[3]?.addEventListener('click', () => $('#btnF4').click());

// ==========================================
// LOCAL STORAGE FALLBACK
// ==========================================
function saveToLocal(key, video) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        if (!list.find(v => v.videoId === video.videoId)) {
            list.push({ videoId: video.videoId, title: video.title, savedAt: Date.now() });
            localStorage.setItem(key, JSON.stringify(list));
        }
    } catch (e) { console.warn('[HAKAI] Storage error:', e); }
}

// ==========================================
// UTILITY
// ==========================================
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

let toastTimeout;
function showToast(msg) {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 1800);
}

function flashKey(sel) {
    const el = $(sel);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 400);
}

// Prevent zoom on double tap (iOS)
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

console.log('[HAKAI] MPC 2000 Crate Digging Center — Loaded');
