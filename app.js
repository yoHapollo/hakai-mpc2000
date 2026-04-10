/* ============================================
   HAKAI MPC 2000 — APP.JS
   YouTube OAuth + Randomized Crate Digging
   + Pad Chopping + Keyboard MPC + WAV Export
   ============================================ */

// ==========================================
// ▶▶▶  YOUR CREDENTIALS — EDIT THESE  ◀◀◀
// ==========================================
const CONFIG = {
    API_KEY: 'YOUR_API_KEY_HERE',
    CLIENT_ID: 'YOUR_CLIENT_ID_HERE',
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

// OAuth
let accessToken = null;
let tokenClient = null;
let userInfo = null;
let hakaiPlaylistId = null;
let watchLaterPlaylistId = null;

// Recording
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recStartTime = 0;
let recTimerInterval = null;
let audioContext = null;
let audioStream = null;

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
const recStatus = $('#recStatus');
const saveModal = $('#saveModal');

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
// GOOGLE OAUTH 2.0
// ==========================================
function initGoogleAuth() {
    if (typeof google === 'undefined' || !google.accounts) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: handleTokenResponse,
    });
}

function handleTokenResponse(resp) {
    if (resp.error) { showToast('SIGN IN FAILED'); return; }
    accessToken = resp.access_token;
    fetchUserProfile();
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
        if (userInfo.picture) { headerAvatar.src = userInfo.picture; headerAvatar.style.display = 'block'; }
        if (userInfo.name) authLabel.textContent = userInfo.name.toUpperCase();
    } catch (e) {}
}

authBtn.addEventListener('click', () => {
    if (CONFIG.CLIENT_ID === 'YOUR_CLIENT_ID_HERE') { showToast('SET YOUR CLIENT_ID IN APP.JS'); return; }
    if (accessToken) {
        accessToken = null; userInfo = null; hakaiPlaylistId = null;
        authDot.classList.remove('connected');
        authLabel.textContent = 'CONNECT YOUTUBE';
        authBtn.classList.remove('signed-in');
        headerAvatar.style.display = 'none';
        showToast('SIGNED OUT'); return;
    }
    tokenClient.requestAccessToken();
});

// ==========================================
// YOUTUBE IFRAME API
// ==========================================
function onYouTubeIframeAPIReady() {
    console.log('[HAKAI] YouTube IFrame API ready');
    initGoogleAuth();
}

function initPlayer(videoId) {
    if (player) player.destroy();
    playerReady = false;
    player = new YT.Player('ytPlayer', {
        width: '100%', height: '100%',
        videoId: videoId,
        playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, playsinline: 1, fs: 0 },
        events: { onReady: () => { playerReady = true; }, onStateChange: () => {} }
    });
}

// ==========================================
// ★★★ RANDOMIZED SEARCH SYSTEM ★★★
//
// This is the core innovation of HAKAI.
// Every playlist generation must feel like
// digging through a new crate — never the
// same results, even with identical keywords.
//
// Strategy:
// 1. Vary the search query with random suffixes
//    ("full song", "vinyl", "original", "rare", etc.)
// 2. Randomize the sort order (date, rating, relevance)
// 3. Pick a random sub-window within the year range
// 4. Fetch the max 50 results, then SHUFFLE and
//    randomly select from them
// 5. Filter by view count if set
//
// This ensures two searches for "70s soul sample"
// produce completely different tracklists.
// ==========================================

const QUERY_SUFFIXES = [
    'full song', 'vinyl', 'original', 'rare', 'album track',
    'audio', 'HQ', 'remastered', 'single', 'official audio',
    'deep cut', 'B side', 'obscure', 'forgotten', 'classic',
    'groove', 'original mix', 'studio', 'LP', 'full album',
    'underground', 'lost', 'unreleased', 'session', 'master',
    'analog', '45 rpm', 'compilation', 'anthology', 'disco mix',
];

const SORT_ORDERS = ['date', 'rating', 'relevance', 'viewCount'];

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Parses YouTube's ISO 8601 duration (e.g., "PT3M45S") into total seconds
function parseISO8601Duration(duration) {
    if (!duration) return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    return (hours * 3600) + (minutes * 60) + seconds;
}

createBtn.addEventListener('click', async () => {
    const keywords = $('#keywords').value.trim();
    if (!keywords) { showToast('ENTER KEYWORDS'); return; }
    createBtn.style.display = 'none';
    loadingIndicator.classList.add('show');
    try {
        const results = await searchYouTubeRandomized(
            keywords,
            yearStartSel.value,
            yearEndSel.value,
            $('#maxViews').value,
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
        hakaiPlaylistId = null;
        switchToScreen2();
    } catch (err) {
        console.error('[HAKAI] Search error:', err);
        showToast('API ERROR — CHECK CONSOLE');
        createBtn.style.display = '';
        loadingIndicator.classList.remove('show');
    }
});

async function searchYouTubeRandomized(keywords, yearStart, yearEnd, maxViews, language, maxResults) {
    if (CONFIG.API_KEY === 'YOUR_API_KEY_HERE') return getDemoPlaylist(maxResults);

    // ---- RANDOMIZATION LAYER 1: Vary the query text ----
    const suffix = randomPick(QUERY_SUFFIXES);
    
    // NEW: The Negative Keyword Hammer
    // This forces YouTube to exclude the most common non-song junk found in the Music category
    const negativeKeywords = '-"type beat" -"sample pack" -tutorial -how -remake -lesson -review -documentary -reaction -vlog -podcast';
    const query = `${keywords} ${suffix} ${negativeKeywords}`;

    // ---- RANDOMIZATION LAYER 2: Random sort order ----
    const order = randomPick(SORT_ORDERS);

    // ---- RANDOMIZATION LAYER 3: Random time sub-window ----
    const startY = parseInt(yearStart);
    const endY = parseInt(yearEnd);
    const span = endY - startY;
    let searchStart, searchEnd;

    if (span > 5) {
        const windowSize = Math.min(span, Math.floor(Math.random() * 8) + 3);
        const offset = Math.floor(Math.random() * (span - windowSize + 1));
        searchStart = startY + offset;
        searchEnd = searchStart + windowSize;
    } else {
        searchStart = startY;
        searchEnd = endY;
    }

    // ---- RANDOMIZATION LAYER 4: Random month offsets ----
    const startMonth = Math.floor(Math.random() * 12) + 1;
    const endMonth = Math.floor(Math.random() * 12) + 1;

    const publishedAfter = `${searchStart}-${String(startMonth).padStart(2, '0')}-01T00:00:00Z`;
    const publishedBefore = `${searchEnd}-${String(endMonth).padStart(2, '0')}-28T23:59:59Z`;

    const fetchCount = 50;

    const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        q: query,
        publishedAfter: publishedAfter,
        publishedBefore: publishedBefore,
        maxResults: fetchCount,
        order: order,
        videoCategoryId: '10', // Strictly the Music category
        key: CONFIG.API_KEY,
    });
    if (language) params.set('relevanceLanguage', language);

    console.log(`[HAKAI] Digging: "${query}" | order: ${order} | years: ${searchStart}-${searchEnd}`);

    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!resp.ok) throw new Error(`YT API ${resp.status}`);
    const data = await resp.json();

    let videos = (data.items || [])
        .filter(item => item.id && item.id.videoId)
        .map(item => ({
            videoId: item.id.videoId,
            title: item.snippet.title
        }));

    // ---- Remove duplicates by videoId ----
    const seen = new Set();
    videos = videos.filter(v => {
        if (seen.has(v.videoId)) return false;
        seen.add(v.videoId);
        return true;
    });

    videos = shuffleArray(videos);

    // ---- NEW: DUAL FILTER (VIEW COUNT + DURATION SIEVE) ----
    if (videos.length > 0) {
        const ids = videos.map(v => v.videoId).join(',');

        // We added 'contentDetails' to the part list to grab the video duration
        const statsResp = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids}&key=${CONFIG.API_KEY}`
        );
        
        if (statsResp.ok) {
            const statsData = await statsResp.json();
            const viewMap = {};
            const durationMap = {};
            
            (statsData.items || []).forEach(item => {
                viewMap[item.id] = parseInt(item.statistics.viewCount) || 0;
                durationMap[item.id] = parseISO8601Duration(item.contentDetails.duration);
            });

            const maxViewCount = maxViews !== 'any' ? parseInt(maxViews) : Infinity;

            videos = videos.filter(v => {
                const views = viewMap[v.videoId];
                const durationSecs = durationMap[v.videoId];
                
                // Filter 1: Must be under the max view count limit
                const passesViews = views !== undefined && views <= maxViewCount;
                
                // Filter 2: The Duration Sieve. 
                // A typical song is between 1m 15s (75 secs) and 15m (900 secs). 
                // This permanently eliminates 1-hour docs and 30-second TikTok loops.
                const passesDuration = durationSecs !== undefined && durationSecs >= 75 && durationSecs <= 900;

                return passesViews && passesDuration;
            });

            videos = videos.map(v => ({
                ...v,
                title: v.title + ` [${formatViewCount(viewMap[v.videoId])} views]`
            }));
        }
    }

    // ---- FINAL: Shuffle once more and take what we need ----
    videos = shuffleArray(videos);
    return videos.slice(0, maxResults);
}

function formatViewCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
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
    return shuffleArray(demos).slice(0, count);
}

// ==========================================
// YOUTUBE AUTHENTICATED ACTIONS
// ==========================================
async function ytApi(endpoint, method = 'GET', body = null) {
    if (!accessToken) return null;
    const opts = { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, opts);
    if (!resp.ok) throw new Error(`YT API ${resp.status}`);
    if (resp.status === 204) return {};
    return resp.json();
}

async function addToPlaylist() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;
    if (!accessToken) { saveToLocal('hakai_saved_samples', video); showToast('SAVED LOCALLY (SIGN IN FOR YT)'); return; }
    try {
        if (!hakaiPlaylistId) {
            const pl = await ytApi('playlists?part=snippet,status', 'POST', {
                snippet: { title: $('#playlistName').value.trim() || 'HAKAI CRATE', description: 'Created by HAKAI MPC 2000' },
                status: { privacyStatus: 'private' }
            });
            hakaiPlaylistId = pl.id;
        }
        await ytApi('playlistItems?part=snippet', 'POST', {
            snippet: { playlistId: hakaiPlaylistId, resourceId: { kind: 'youtube#video', videoId: video.videoId } }
        });
        flashKey('#btnF2');
        showToast('ADDED TO YOUTUBE PLAYLIST');
    } catch (e) { showToast('PLAYLIST ERROR — TRY AGAIN'); }
}

async function addToWatchLater() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;
    if (!accessToken) { saveToLocal('hakai_watch_later', video); showToast('SAVED LOCALLY (SIGN IN FOR YT)'); return; }
    try {
        if (!watchLaterPlaylistId) {
            const pl = await ytApi('playlists?part=snippet,status', 'POST', {
                snippet: { title: 'HAKAI — Watch Later', description: 'Watch Later from HAKAI MPC 2000' },
                status: { privacyStatus: 'private' }
            });
            watchLaterPlaylistId = pl.id;
        }
        await ytApi('playlistItems?part=snippet', 'POST', {
            snippet: { playlistId: watchLaterPlaylistId, resourceId: { kind: 'youtube#video', videoId: video.videoId } }
        });
        flashKey('#btnF3');
        showToast('ADDED TO WATCH LATER');
    } catch (e) { showToast('WATCH LATER ERROR'); }
}

async function likeVideo() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;
    if (!accessToken) { saveToLocal('hakai_favorites', video); showToast('♥ SAVED LOCALLY (SIGN IN FOR YT)'); return; }
    try {
        await ytApi(`videos/rate?id=${video.videoId}&rating=like`, 'POST');
        flashKey('#btnF4');
        showToast('♥ LIKED ON YOUTUBE');
    } catch (e) { showToast('LIKE ERROR'); }
}

// ==========================================
// SCREEN TRANSITIONS
// ==========================================
function switchToScreen2() {
    screen1.classList.remove('active');
    screen2.classList.add('active');
    loadingIndicator.classList.remove('show');
    createBtn.style.display = '';
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI();
    loadCurrentVideo();
}

function switchToScreen1() {
    if (isRecording) stopRecording(true);
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
function doPlay() { if (player && playerReady) { player.playVideo(); showToast('▶ PLAY'); } }
function doStop() { if (player && playerReady) { player.pauseVideo(); showToast('■ STOP'); } }
function doTogglePlayPause() {
    if (!player || !playerReady) return;
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) { doStop(); }
    else { doPlay(); }
}
function doNext() {
    if (!currentPlaylist.length) return;
    if (isRecording) stopRecording(true);
    currentVideoIndex = (currentVideoIndex + 1) % currentPlaylist.length;
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI();
    loadCurrentVideo(); showToast('NEXT ▶▶');
}
function doLast() {
    if (!currentPlaylist.length) return;
    if (isRecording) stopRecording(true);
    currentVideoIndex = (currentVideoIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI();
    loadCurrentVideo(); showToast('◀◀ LAST');
}

$('#btnPlay').addEventListener('click', doPlay);
$('#btnStop').addEventListener('click', doStop);
$('#btnNext').addEventListener('click', doNext);
$('#btnLast').addEventListener('click', doLast);

// 3-second skip
function doBack3() {
    if (!player || !playerReady) return;
    const t = player.getCurrentTime();
    player.seekTo(Math.max(0, t - 3), true);
    showToast('◀ -3 SEC');
}
function doFwd3() {
    if (!player || !playerReady) return;
    const t = player.getCurrentTime();
    player.seekTo(t + 3, true);
    showToast('+3 SEC ▶');
}

$('#btnBack3').addEventListener('click', doBack3);
$('#btnFwd3').addEventListener('click', doFwd3);

// ==========================================
// SPEED CONTROLS
// ==========================================
function setSpeed(targetSpeed) {
    if (currentSpeed === targetSpeed) {
        currentSpeed = 1.0;
        if (player && playerReady) player.setPlaybackRate(1.0);
        showToast('SPEED: 1.0x');
    } else {
        currentSpeed = targetSpeed;
        if (player && playerReady) player.setPlaybackRate(targetSpeed);
        showToast(`SPEED: ${targetSpeed}x`);
    }
    updateSpeedUI();
}

$$('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.speed)));
});

function updateSpeedUI() {
    $$('.speed-btn').forEach(btn => {
        btn.classList.toggle('active-speed',
            parseFloat(btn.dataset.speed) === currentSpeed && currentSpeed !== 1.0);
    });
}

function doNormalSpeed() {
    currentSpeed = 1.0;
    if (player && playerReady) player.setPlaybackRate(1.0);
    updateSpeedUI();
    showToast('SPEED: 1.0x');
}

// ==========================================
// PAD SYSTEM
// ==========================================

// Get pad element by index (0-11)
function getPadEl(idx) {
    return $(`.pad[data-pad="${idx}"]`);
}

function triggerPad(idx) {
    if (!player || !playerReady) return;
    const padEl = getPadEl(idx);
    if (!padEl) return;

    if (pads[idx] === null) {
        // SET marker at current time
        const time = player.getCurrentTime();
        pads[idx] = time;
        padEl.classList.add('active');
        padEl.querySelector('.pad-time').textContent = formatTime(time);
        showToast(`PAD ${idx + 1} SET — ${formatTime(time)}`);
    } else {
        // TRIGGER — seek to saved timestamp
        player.seekTo(pads[idx], true);
        player.playVideo();
        padEl.style.filter = 'brightness(1.5)';
        setTimeout(() => { padEl.style.filter = ''; }, 120);
    }
}

function clearPad(idx) {
    if (pads[idx] !== null) {
        pads[idx] = null;
        const padEl = getPadEl(idx);
        if (padEl) {
            padEl.classList.remove('active');
            padEl.querySelector('.pad-time').textContent = '';
        }
        showToast(`PAD ${idx + 1} CLEARED`);
    }
}

function clearAllPads() {
    pads = new Array(12).fill(null);
    $$('.pad').forEach(p => {
        p.classList.remove('active');
        p.querySelector('.pad-time').textContent = '';
    });
}

// Mouse/touch click on pads
$$('.pad').forEach(padEl => {
    const idx = parseInt(padEl.dataset.pad);

    padEl.addEventListener('click', (e) => {
        // Option+Click (Alt+Click) = clear pad
        if (e.altKey) {
            clearPad(idx);
            return;
        }
        triggerPad(idx);
    });

    // Long press (mobile): clear pad
    let pressTimer;
    padEl.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => clearPad(idx), 600);
    }, { passive: true });
    padEl.addEventListener('touchend', () => clearTimeout(pressTimer));
    padEl.addEventListener('touchmove', () => clearTimeout(pressTimer));
});

// ==========================================
// SOFT KEYS
// ==========================================
function doGenNewPlaylist() { switchToScreen1(); showToast('BACK TO CRATE DIGGING'); }

$('#btnF1').addEventListener('click', doGenNewPlaylist);
$('#btnF2').addEventListener('click', addToPlaylist);
$('#btnF3').addEventListener('click', doNormalSpeed);
$('#btnF4').addEventListener('click', likeVideo);

const fkeyBtns = $$('.fkey-row .hw-btn-small');
fkeyBtns[0]?.addEventListener('click', () => $('#btnF1').click());
fkeyBtns[1]?.addEventListener('click', () => $('#btnF2').click());
fkeyBtns[2]?.addEventListener('click', () => $('#btnF3').click());
fkeyBtns[3]?.addEventListener('click', () => $('#btnF4').click());

// ==========================================
// ★★★ KEYBOARD MAPPING ★★★
//
// PADS:
//   Z=Pad1  X=Pad2  C=Pad3
//   A=Pad4  S=Pad5  D=Pad6
//   Q=Pad7  W=Pad8  E=Pad9
//   1=Pad10 2=Pad11 3=Pad12
//
// TRANSPORT:
//   Left Arrow = Last
//   Right Arrow = Next
//   Space = Play/Pause toggle
//   [ = Back 3 seconds
//   ] = Forward 3 seconds
//
// SPEED:
//   M = 0.5x   , = 0.75x
//   . = 1.25x   / = 1.5x
//
// SOFT KEYS:
//   K = Gen New Playlist
//   L = Add to Playlist
//   ; = Normal Speed (1.0x)
//   ' = Like
//
// RECORD:
//   R = Record
//   T = Stop Recording
//
// DELETE PAD:
//   Option + Mouse Click on pad
// ==========================================

const KEY_TO_PAD = {
    'z': 0, 'x': 1, 'c': 2,
    'a': 3, 's': 4, 'd': 5,
    'q': 6, 'w': 7, 'e': 8,
    '1': 9, '2': 10, '3': 11,
};

const KEY_TO_SPEED = {
    'm': 0.5,
    ',': 0.75,
    '.': 1.25,
    '/': 1.5,
};

document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input/select
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Ignore if save modal is open (let user type filename)
    if (saveModal.classList.contains('show')) return;

    const key = e.key.toLowerCase();

    // --- PADS ---
    if (KEY_TO_PAD.hasOwnProperty(key)) {
        e.preventDefault();
        const idx = KEY_TO_PAD[key];
        triggerPad(idx);
        // Visual feedback: flash the pad button
        const padEl = getPadEl(idx);
        if (padEl) {
            padEl.style.filter = 'brightness(1.3)';
            setTimeout(() => { padEl.style.filter = ''; }, 100);
        }
        return;
    }

    // --- SPEED ---
    if (KEY_TO_SPEED.hasOwnProperty(key)) {
        e.preventDefault();
        setSpeed(KEY_TO_SPEED[key]);
        return;
    }

    // --- TRANSPORT ---
    if (key === 'arrowleft') { e.preventDefault(); doLast(); return; }
    if (key === 'arrowright') { e.preventDefault(); doNext(); return; }
    if (key === ' ') { e.preventDefault(); doTogglePlayPause(); return; }
    if (key === '[') { e.preventDefault(); doBack3(); return; }
    if (key === ']') { e.preventDefault(); doFwd3(); return; }

    // --- SOFT KEYS ---
    if (key === 'k') { e.preventDefault(); doGenNewPlaylist(); return; }
    if (key === 'l') { e.preventDefault(); addToPlaylist(); return; }
    if (key === ';') { e.preventDefault(); doNormalSpeed(); return; }
    if (key === "'") { e.preventDefault(); likeVideo(); return; }

    // --- RECORD ---
    if (key === 'r') { e.preventDefault(); startRecording(); return; }
    if (key === 't') { e.preventDefault(); stopRecording(false); return; }
});

// ==========================================
// AUDIO RECORDING SYSTEM
// Captures browser TAB audio via getDisplayMedia
// ==========================================

$('#btnRec').addEventListener('click', startRecording);
$('#btnStopRec').addEventListener('click', () => stopRecording(false));

async function startRecording() {
    if (isRecording) return;

    try {
        let stream;
        let captureMode = '';

        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
                preferCurrentTab: true,
            });
            stream.getVideoTracks().forEach(t => t.stop());

            if (stream.getAudioTracks().length === 0) {
                throw new Error('No audio track — user may not have checked "Share audio"');
            }
            captureMode = 'TAB AUDIO';
        } catch (displayErr) {
            console.warn('[HAKAI] Tab audio capture failed:', displayErr.message);
            showToast('SHARE TAB AUDIO TO RECORD');
            return;
        }

        audioStream = stream;
        recordedChunks = [];

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';

        mediaRecorder = new MediaRecorder(stream, { mimeType });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
        };

        mediaRecorder.start(100);
        isRecording = true;
        recStartTime = Date.now();

        $('#btnRec').classList.add('recording');
        recStatus.textContent = '● REC 0:00';
        recStatus.classList.add('active');

        recTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            recStatus.textContent = `● REC ${m}:${String(s).padStart(2, '0')}`;
        }, 500);

        showToast(`● RECORDING ${captureMode}`);

    } catch (err) {
        console.error('[HAKAI] Recording error:', err);
        showToast('RECORDING FAILED — SEE CONSOLE');
    }
}

function stopRecording(discard = false) {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    clearInterval(recTimerInterval);
    $('#btnRec').classList.remove('recording');
    recStatus.textContent = '';
    recStatus.classList.remove('active');

    if (discard) {
        mediaRecorder.stop();
        recordedChunks = [];
        showToast('RECORDING DISCARDED');
        return;
    }

    mediaRecorder.stop();

    setTimeout(() => {
        if (recordedChunks.length === 0) {
            showToast('NO AUDIO CAPTURED');
            return;
        }

        const duration = ((Date.now() - recStartTime) / 1000).toFixed(1);
        const video = currentPlaylist[currentVideoIndex];
        const defaultName = (video ? video.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30) : 'sample') + '-chop';

        $('#sampleName').value = defaultName;
        $('#modalInfo').textContent = `DURATION: ${duration}s`;
        saveModal.classList.add('show');
        $('#sampleName').focus();
        $('#sampleName').select();
    }, 300);
}

// ==========================================
// SAVE MODAL
// ==========================================
$('#modalCancel').addEventListener('click', () => {
    saveModal.classList.remove('show');
    recordedChunks = [];
    showToast('CANCELLED');
});

$('#modalSave').addEventListener('click', async () => {
    const filename = $('#sampleName').value.trim() || 'hakai-sample';
    saveModal.classList.remove('show');
    showToast('CONVERTING TO WAV...');

    try {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const wavBlob = await convertToWav(blob);
        downloadBlob(wavBlob, filename + '.wav');
        recordedChunks = [];
        showToast(`SAVED: ${filename}.wav`);
    } catch (err) {
        console.error('[HAKAI] WAV conversion error:', err);
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        downloadBlob(blob, filename + '.webm');
        recordedChunks = [];
        showToast(`SAVED: ${filename}.webm`);
    }
});

// Allow Enter key in modal to save
$('#sampleName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#modalSave').click(); }
    if (e.key === 'Escape') { e.preventDefault(); $('#modalCancel').click(); }
});

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==========================================
// WAV CONVERSION
// ==========================================
async function convertToWav(webmBlob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    const interleaved = new Float32Array(length * numChannels);
    for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            interleaved[i * numChannels + ch] = channelData[i];
        }
    }

    const pcm = new Int16Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
        const s = Math.max(-1, Math.min(1, interleaved[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(wavBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcm.length * 2, true);

    const offset = 44;
    for (let i = 0; i < pcm.length; i++) {
        view.setInt16(offset + i * 2, pcm[i], true);
    }

    ctx.close();
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

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
    } catch (e) {}
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
    const el = $(sel); if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 400);
}

// Prevent zoom on double tap (iOS)
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

console.log('[HAKAI] MPC 2000 Crate Digging Center — Loaded');
console.log('[HAKAI] Keyboard: Z-X-C / A-S-D / Q-W-E / 1-2-3 = Pads');
console.log('[HAKAI] Space=Play/Pause | ←→=Last/Next | []=±3sec | R=Rec T=StopRec');
