/* ============================================
   HAKAI MPC 2000 — APP.JS (V4.4 - Mobile Logic Fix)
   YouTube OAuth + Gapless Drum Loop Engine 
   + Ghost Click Lock + Mobile Transport Mappings
   ============================================ */

// ⚠️ WARNING: API key exposed in client-side code!
// For production, move this to a backend proxy to keep it secure.
// See API_KEY_FIX.md for instructions.
const CONFIG = {
    API_KEY: 'AIzaSyAhYhsr-kYUukMZFNAgV6jDg1FGi065wT4', // ⚠️ REPLACE THIS - Currently returning 403
    CLIENT_ID: '564150027983-aero1s5g4ctnm5iihv3c1un23rc2mnk5.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/youtube',
};

let currentPlaylist = [];
let currentVideoIndex = 0;
let pads = new Array(12).fill(null);
let padClearTimes = new Array(12).fill(0);
let player = null;
let playerReady = false;
let currentSpeed = 1.0;

let accessToken = null;
let tokenClient = null;
let userInfo = null;

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recStartTime = 0;
let recTimerInterval = null;

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
// DRUM BREAK ENGINE
// ==========================================
const breakUrls = {
    1: 'BREAK_1_97.mp3',
    2: 'BREAK_2_80.mp3',
    3: 'BREAK_3_70.mp3',
    4: 'BREAK_4_87.mp3'
};

const breakBuffers = {};
let breakSource = null;
let activeBreak = null;
let breakAudioCtx = null;

async function loadBreaks() {
    breakAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    for (let key in breakUrls) {
        try {
            const resp = await fetch(breakUrls[key]);
            const arrBuf = await resp.arrayBuffer();
            const audBuf = await breakAudioCtx.decodeAudioData(arrBuf);
            breakBuffers[key] = audBuf;
        } catch(e) {
            console.error('Failed to load break', key, e);
        }
    }
}

$$('.break-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const breakId = btn.dataset.break;

        if (!breakAudioCtx) {
            showToast('LOADING DRUMS...');
            await loadBreaks();
        }
        if (breakAudioCtx.state === 'suspended') await breakAudioCtx.resume();

        if (activeBreak === breakId) {
            if (breakSource) { breakSource.stop(); breakSource.disconnect(); breakSource = null; }
            btn.classList.remove('active');
            activeBreak = null;
            showToast(`BREAK ${breakId} STOPPED`);
        } else {
            if (breakSource) { breakSource.stop(); breakSource.disconnect(); }
            if (activeBreak) {
                const prevBtn = $(`.break-btn[data-break="${activeBreak}"]`);
                if (prevBtn) prevBtn.classList.remove('active');
            }

            if (breakBuffers[breakId]) {
                breakSource = breakAudioCtx.createBufferSource();
                breakSource.buffer = breakBuffers[breakId];
                breakSource.loop = true; 
                breakSource.connect(breakAudioCtx.destination);
                breakSource.start();

                btn.classList.add('active');
                activeBreak = breakId;
                showToast(`PLAYING BREAK ${breakId}`);
            } else {
                showToast('DRUMS STILL LOADING...');
            }
        }
    });
});

// ==========================================
// INIT
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
    const expiresAt = Date.now() + (resp.expires_in * 1000); 
    localStorage.setItem('hakai_yt_token', accessToken);
    localStorage.setItem('hakai_yt_expires', expiresAt.toString());
    fetchUserProfile();
    authDot.classList.add('connected');
    authLabel.textContent = 'CONNECTED';
    authBtn.classList.add('signed-in');
    showToast('YOUTUBE CONNECTED');
}

function checkExistingLogin() {
    const savedToken = localStorage.getItem('hakai_yt_token');
    const expiresAt = localStorage.getItem('hakai_yt_expires');
    if (savedToken && expiresAt && Date.now() < parseInt(expiresAt)) {
        accessToken = savedToken;
        fetchUserProfile();
        authDot.classList.add('connected');
        authLabel.textContent = 'CONNECTED';
        authBtn.classList.add('signed-in');
    } else {
        localStorage.removeItem('hakai_yt_token');
        localStorage.removeItem('hakai_yt_expires');
    }
}

async function fetchUserProfile() {
    try {
        const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }});
        userInfo = await resp.json();
        if (userInfo.picture) { headerAvatar.src = userInfo.picture; headerAvatar.style.display = 'block'; }
        if (userInfo.name) authLabel.textContent = userInfo.name.toUpperCase();
    } catch (e) {}
}

authBtn.addEventListener('click', () => {
    if (accessToken) {
        accessToken = null; userInfo = null;
        localStorage.removeItem('hakai_yt_token');
        localStorage.removeItem('hakai_yt_expires');
        authDot.classList.remove('connected');
        authLabel.textContent = 'CONNECT YOUTUBE';
        authBtn.classList.remove('signed-in');
        headerAvatar.style.display = 'none';
        showToast('SIGNED OUT'); return;
    }
    tokenClient.requestAccessToken();
});

function onYouTubeIframeAPIReady() {
    initGoogleAuth(); checkExistingLogin(); 
}

function initPlayer(videoId) {
    playerReady = false;
    player = new YT.Player('ytPlayer', {
        width: '100%', height: '100%', videoId: videoId,
        playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, playsinline: 1, fs: 0 },
        events: { onReady: (e) => { playerReady = true; e.target.playVideo(); } }
    });
}

function parseISO8601Duration(duration) {
    if (!duration) return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return ((parseInt(match[1]) || 0) * 3600) + ((parseInt(match[2]) || 0) * 60) + (parseInt(match[3]) || 0);
}

// ==========================================
// SEARCH ENGINE
// ==========================================
const QUERY_SUFFIXES = ['vinyl', 'original', 'rare', 'album track', 'audio', 'HQ', 'remastered', 'single', 'official audio', 'deep cut', 'B side', 'obscure', 'forgotten', 'classic', 'groove', 'original mix', 'studio', 'LP', 'full album', 'underground', 'lost', '45 rpm', 'compilation'];

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

createBtn.addEventListener('click', async () => {
    const keywords = $('#keywords').value.trim();
    if (!keywords) { showToast('ENTER KEYWORDS'); return; }
    
    createBtn.style.display = 'none';
    loadingIndicator.classList.add('show');
    
    let results = [];
    let attempts = 0;
    let lastError = null;
    
    while (attempts < 4 && results.length === 0) {
        try {
            console.log(`Search attempt ${attempts + 1}/4`);
            results = await searchYouTubeRandomized(keywords, yearStartSel.value, yearEndSel.value, $('#maxViews').value, $('#language').value, parseInt($('#playlistLength').value));
            console.log(`Attempt ${attempts + 1} returned ${results.length} results`);
        } catch (err) {
            console.error(`Attempt ${attempts + 1} failed:`, err);
            lastError = err;
        }
        attempts++;
        if (results.length === 0 && attempts < 4) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay between attempts
        }
    }

    if (!results || results.length === 0) {
        console.error('All attempts failed. Last error:', lastError);
        showToast('NO RESULTS — TRY DIFFERENT KEYWORDS');
        createBtn.style.display = ''; loadingIndicator.classList.remove('show'); return;
    }

    console.log('Success! Found', results.length, 'videos');
    currentPlaylist = results; currentVideoIndex = 0; switchToScreen2();
});

async function searchYouTubeRandomized(keywords, yearStart, yearEnd, maxViews, language, maxResults) {
    const suffix = QUERY_SUFFIXES[Math.floor(Math.random() * QUERY_SUFFIXES.length)];
    const randomYear = Math.floor(Math.random() * (parseInt(yearEnd) - parseInt(yearStart) + 1)) + parseInt(yearStart);
    const query = `${keywords} ${randomYear} ${suffix} -"type beat" -"sample pack" -tutorial -how -remake -lesson -review -documentary -reaction -vlog -podcast`;

    const params = new URLSearchParams({ part: 'snippet', type: 'video', q: query, maxResults: 50, order: Math.random() > 0.5 ? 'relevance' : 'rating', videoCategoryId: '10', key: CONFIG.API_KEY });
    if (language) params.set('relevanceLanguage', language);

    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!resp.ok) {
        console.error('YouTube API error:', resp.status, await resp.text());
        throw new Error(`YT API ${resp.status}`);
    }
    
    const data = await resp.json();
    console.log('YouTube API response:', data);
    
    if (!data.items || data.items.length === 0) {
        console.log('No items in response');
        return [];
    }
    
    let videos = data.items.filter(i => i.id && i.id.videoId).map(i => ({ videoId: i.id.videoId, title: i.snippet.title }));
    
    const seen = new Set();
    videos = videos.filter(v => { if (seen.has(v.videoId)) return false; seen.add(v.videoId); return true; });

    if (videos.length > 0) {
        const ids = videos.map(v => v.videoId).join(',');
        const statsResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids}&key=${CONFIG.API_KEY}`);
        if (statsResp.ok) {
            const statsData = await statsResp.json();
            const viewMap = {}; const durationMap = {};
            (statsData.items || []).forEach(item => { 
                viewMap[item.id] = parseInt(item.statistics.viewCount) || 0; 
                durationMap[item.id] = parseISO8601Duration(item.contentDetails.duration); 
            });
            
            const maxViewCount = maxViews !== 'any' ? parseInt(maxViews) : Infinity;
            
            // First, try with strict filters
            let filteredVideos = videos.filter(v => {
                const hasViews = viewMap[v.videoId] !== undefined;
                const hasDuration = durationMap[v.videoId] !== undefined;
                if (!hasViews || !hasDuration) return false;
                const viewsOk = viewMap[v.videoId] <= maxViewCount;
                const durationOk = durationMap[v.videoId] >= 75 && durationMap[v.videoId] <= 900;
                return viewsOk && durationOk;
            });
            
            // If strict filters return nothing, relax duration requirement
            if (filteredVideos.length === 0) {
                console.log('No results with strict filters, relaxing duration requirement...');
                filteredVideos = videos.filter(v => {
                    const hasViews = viewMap[v.videoId] !== undefined;
                    const hasDuration = durationMap[v.videoId] !== undefined;
                    if (!hasViews || !hasDuration) return false;
                    const viewsOk = viewMap[v.videoId] <= maxViewCount;
                    const durationOk = durationMap[v.videoId] >= 30; // Relaxed from 75 seconds
                    return viewsOk && durationOk;
                });
            }
            
            // If still nothing, just use view filter
            if (filteredVideos.length === 0 && maxViewCount !== Infinity) {
                console.log('Still no results, using view filter only...');
                filteredVideos = videos.filter(v => {
                    const hasViews = viewMap[v.videoId] !== undefined;
                    if (!hasViews) return false;
                    return viewMap[v.videoId] <= maxViewCount;
                });
            }
            
            // If STILL nothing, just return unfiltered with stats
            if (filteredVideos.length === 0) {
                console.log('No filters working, returning unfiltered results');
                filteredVideos = videos.filter(v => viewMap[v.videoId] !== undefined);
            }
            
            videos = filteredVideos.map(v => ({ 
                ...v, 
                title: v.title + ` [${formatViewCount(viewMap[v.videoId])} views]` 
            }));
        }
    }
    
    console.log('Filtered videos:', videos.length);
    return shuffleArray(videos).slice(0, maxResults);
}

function formatViewCount(n) { return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }

// ==========================================
// YT API
// ==========================================
async function ytApi(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}`, opts);
    if (!resp.ok) throw new Error(`YT API ${resp.status}`);
    return resp.status === 204 ? {} : resp.json();
}

async function addToPlaylist() {
    if (!currentPlaylist[currentVideoIndex]) return;
    if (!accessToken) { showToast('SIGN IN TO ADD TO YT PLAYLIST'); return; }
    try {
        await ytApi('playlistItems?part=snippet', 'POST', { snippet: { playlistId: 'PLLVBqHeyUt0DYFxk20wKv495txAKAg9eu', resourceId: { kind: 'youtube#video', videoId: currentPlaylist[currentVideoIndex].videoId } } });
        flashKey('#btnF2'); showToast('ADDED TO TARGET PLAYLIST');
    } catch (e) { showToast('PLAYLIST ERROR'); }
}

async function likeVideo() {
    if (!currentPlaylist[currentVideoIndex]) return;
    if (!accessToken) { showToast('SIGN IN TO LIKE YT VIDEO'); return; }
    try {
        await ytApi(`videos/rate?id=${currentPlaylist[currentVideoIndex].videoId}&rating=like`, 'POST');
        flashKey('#btnF4'); showToast('♥ LIKED ON YOUTUBE');
    } catch (e) { showToast('LIKE ERROR'); }
}

// ==========================================
// SCREEN 2 CONTROLS
// ==========================================
function switchToScreen2() {
    screen1.classList.remove('active'); screen2.classList.add('active');
    loadingIndicator.classList.remove('show'); createBtn.style.display = '';
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI(); loadCurrentVideo();
}

function switchToScreen1() {
    if (isRecording) stopRecording(true);
    if (player && playerReady) player.pauseVideo();
    if (breakSource) { breakSource.stop(); breakSource.disconnect(); breakSource = null; }
    if (activeBreak) { $(`.break-btn[data-break="${activeBreak}"]`)?.classList.remove('active'); activeBreak = null; }
    screen2.classList.remove('active'); screen1.classList.add('active');
}

function loadCurrentVideo() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;
    videoTitleEl.textContent = video.title; videoIndexEl.textContent = `${currentVideoIndex + 1} / ${currentPlaylist.length}`;
    if (!player) initPlayer(video.videoId); else if (playerReady) player.loadVideoById(video.videoId); 
}

function doPlay() { if (playerReady) { player.playVideo(); showToast('▶ PLAY'); } }
function doStop() { if (playerReady) { player.pauseVideo(); showToast('■ STOP'); } }
function doTogglePlayPause() { if (playerReady) player.getPlayerState() === YT.PlayerState.PLAYING ? doStop() : doPlay(); }
function doNext() {
    if (!currentPlaylist.length) return;
    if (isRecording) stopRecording(true);
    currentVideoIndex = (currentVideoIndex + 1) % currentPlaylist.length;
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI(); loadCurrentVideo(); showToast('NEXT ▶▶');
}
function doLast() {
    if (!currentPlaylist.length) return;
    if (isRecording) stopRecording(true);
    currentVideoIndex = (currentVideoIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    clearAllPads(); currentSpeed = 1.0; updateSpeedUI(); loadCurrentVideo(); showToast('◀◀ LAST');
}
function doSkip(secs) {
    if (playerReady) { player.seekTo(player.getCurrentTime() + secs, true); if (player.getPlayerState() !== YT.PlayerState.PLAYING) player.playVideo(); }
    showToast(secs > 0 ? '+3 SECONDS' : '-3 SECONDS');
}

$('#btnPlay').addEventListener('click', doPlay); $('#btnStop').addEventListener('click', doStop);
$('#btnNext').addEventListener('click', doNext); $('#btnLast').addEventListener('click', doLast);
$('#btnSkipBack').addEventListener('click', () => doSkip(-3)); $('#btnSkipFwd').addEventListener('click', () => doSkip(3));

function setSpeed(targetSpeed) {
    currentSpeed = currentSpeed === targetSpeed ? 1.0 : targetSpeed;
    if (playerReady) player.setPlaybackRate(currentSpeed);
    updateSpeedUI(); showToast(`SPEED: ${currentSpeed}x`);
}
$$('.speed-btn').forEach(btn => btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.speed))));
function updateSpeedUI() { $$('.speed-btn').forEach(b => b.classList.toggle('active-speed', parseFloat(b.dataset.speed) === currentSpeed && currentSpeed !== 1.0)); }

// ==========================================
// PADS
// ==========================================
function getPadEl(idx) { return $(`.pad[data-pad="${idx}"]`); }

function triggerPad(idx) {
    if (!playerReady) return;
    if (Date.now() - padClearTimes[idx] < 500) return; 

    const padEl = getPadEl(idx);
    if (!padEl) return;

    if (pads[idx] === null) {
        pads[idx] = player.getCurrentTime();
        padEl.classList.add('active'); padEl.querySelector('.pad-time').textContent = formatTime(pads[idx]);
        showToast(`PAD ${idx + 1} SET`);
    } else {
        player.seekTo(pads[idx], true); player.playVideo();
        padEl.style.filter = 'brightness(1.5)'; setTimeout(() => { padEl.style.filter = ''; }, 120);
    }
}

function clearPad(idx) {
    if (pads[idx] !== null) {
        pads[idx] = null; getPadEl(idx).classList.remove('active'); getPadEl(idx).querySelector('.pad-time').textContent = '';
        padClearTimes[idx] = Date.now();
        showToast(`PAD ${idx + 1} CLEARED`);
    }
}
function clearAllPads() { pads.fill(null); $$('.pad').forEach(p => { p.classList.remove('active'); p.querySelector('.pad-time').textContent = ''; }); }

$$('.pad').forEach(padEl => {
    const idx = parseInt(padEl.dataset.pad);
    padEl.addEventListener('click', (e) => { if (e.altKey) clearPad(idx); else triggerPad(idx); });
    let pt; padEl.addEventListener('touchstart', () => { pt = setTimeout(() => clearPad(idx), 600); }, { passive: true });
    padEl.addEventListener('touchend', () => clearTimeout(pt)); padEl.addEventListener('touchcancel', () => clearTimeout(pt)); padEl.addEventListener('touchmove', () => clearTimeout(pt));
});

// ==========================================
// F-KEYS / NEW MOBILE BUTTONS MAPPING
// ==========================================
$('#btnF1')?.addEventListener('click', doGenNewPlaylist);
$('#btnF2')?.addEventListener('click', addToPlaylist);
$('#btnF3')?.addEventListener('click', doScreenshot);
$('#btnF4')?.addEventListener('click', likeVideo);

// Bind the new mobile transport buttons to the exact same functions
$('#btnMobAdd')?.addEventListener('click', addToPlaylist);
$('#btnMobShot')?.addEventListener('click', doScreenshot);


// ==========================================
// SCREENSHOT ENGINE 
// ==========================================
async function doScreenshot() {
    const video = currentPlaylist[currentVideoIndex];
    if (!video) return;
    showToast('GENERATING SCREENSHOT...');
    try {
        let channelName = "Unknown Channel", publishedAt = "Unknown Date", viewCount = "0";
        const statsResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${video.videoId}&key=${CONFIG.API_KEY}`);
        if (statsResp.ok) {
            const items = (await statsResp.json()).items;
            if (items && items.length > 0) {
                channelName = items[0].snippet.channelTitle; publishedAt = new Date(items[0].snippet.publishedAt).toLocaleDateString(); viewCount = formatViewCount(items[0].statistics.viewCount);
            }
        }
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 1280, 720);
        
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = `https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`;
        img.onload = () => drawAndSave(img);
        img.onerror = () => { const fImg = new Image(); fImg.crossOrigin = "anonymous"; fImg.src = `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`; fImg.onload = () => drawAndSave(fImg); fImg.onerror = () => drawAndSave(null); };

        function drawAndSave(loadedImg) {
            if (loadedImg) ctx.drawImage(loadedImg, 0, 0, 1280, 720);
            const grad = ctx.createLinearGradient(0, 0, 0, 720); grad.addColorStop(0, 'rgba(0,0,0,0.1)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.6)'); grad.addColorStop(1, 'rgba(0,0,0,0.95)');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, 1280, 720);
            ctx.fillStyle = '#44cc44'; ctx.font = 'bold 30px "Courier New", monospace'; ctx.fillText('MPC 2000 CRATE DIGGING CENTER', 50, 60);

            let rawTitle = video.title.replace(/\[.*?views\]/g, '').trim();
            ctx.font = 'bold 50px "Courier New", monospace';
            let words = rawTitle.split(' '), lines = [], currentLine = '';
            for(let n = 0; n < words.length; n++) {
                let testLine = currentLine + words[n] + ' ';
                if (ctx.measureText(testLine).width > 1180 && n > 0) { lines.push(currentLine); currentLine = words[n] + ' '; } else currentLine = testLine;
            }
            lines.push(currentLine);

            ctx.font = '35px "Courier New", monospace'; ctx.fillStyle = '#ccc';
            ctx.fillText(`RELEASED: ${publishedAt}  |  VIEWS: ${viewCount}`, 50, 680); ctx.fillText(`CHANNEL: ${channelName.toUpperCase()}`, 50, 630);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 50px "Courier New", monospace';
            let titleY = 570 - ((lines.length - 1) * 55); 
            for(let i=0; i<lines.length; i++) ctx.fillText(lines[i].trim(), 50, titleY + (i * 55));

            try {
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/jpeg', 0.9);
                a.download = `${rawTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-") || "Crate-Dig-Sample"}.jpg`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                flashKey('#btnF3'); showToast('SCREENSHOT SAVED');
            } catch (err) { showToast('CORS ERROR'); }
        }
    } catch(e) { showToast('ERROR CAPTURING'); }
}

// ==========================================
// RECORDING & HOTKEYS
// ==========================================
const KEY_TO_PAD = { 'z': 0, 'x': 1, 'c': 2, 'a': 3, 's': 4, 'd': 5, 'q': 6, 'w': 7, 'e': 8, '1': 9, '2': 10, '3': 11 };
const KEY_TO_SPEED = { 'm': 0.5, ',': 0.75, '.': 1.25, '/': 1.5 };

document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || saveModal.classList.contains('show')) return;
    const key = e.key.toLowerCase();

    if (KEY_TO_PAD.hasOwnProperty(key)) { e.preventDefault(); triggerPad(KEY_TO_PAD[key]); const p = getPadEl(KEY_TO_PAD[key]); if (p) { p.style.filter = 'brightness(1.3)'; setTimeout(() => { p.style.filter = ''; }, 100); } return; }
    if (KEY_TO_SPEED.hasOwnProperty(key)) { e.preventDefault(); setSpeed(KEY_TO_SPEED[key]); return; }
    if (key === 'arrowleft') { e.preventDefault(); doLast(); return; }
    if (key === 'arrowright') { e.preventDefault(); doNext(); return; }
    if (key === ' ') { e.preventDefault(); doTogglePlayPause(); return; }
    if (key === '[') { e.preventDefault(); doSkip(-3); return; }
    if (key === ']') { e.preventDefault(); doSkip(3); return; }
    if (key === 'k') { e.preventDefault(); doGenNewPlaylist(); return; }
    if (key === 'l') { e.preventDefault(); addToPlaylist(); return; }
    if (key === ';') { e.preventDefault(); doScreenshot(); return; }
    if (key === "'") { e.preventDefault(); likeVideo(); return; }
    if (key === 'r') { e.preventDefault(); startRecording(); return; }
    if (key === 't') { e.preventDefault(); stopRecording(false); return; }
});

$('#btnRec')?.addEventListener('click', startRecording);
$('#btnStopRec')?.addEventListener('click', () => stopRecording(false));

async function startRecording() {
    if (isRecording) return;
    try {
        let stream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: true });
            stream.getVideoTracks().forEach(t => t.stop());
            if (stream.getAudioTracks().length === 0) throw new Error('No audio track');
        } catch (displayErr) { showToast('SHARE TAB AUDIO TO RECORD'); return; }

        audioStream = stream; recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => { if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; } };

        mediaRecorder.start(100); isRecording = true; recStartTime = Date.now();
        $('#btnRec').classList.add('recording'); recStatus.textContent = '● REC 0:00'; recStatus.classList.add('active');

        recTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
            recStatus.textContent = `● REC ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
        }, 500);
        showToast(`● RECORDING TAB AUDIO`);
    } catch (err) { showToast('RECORDING FAILED — SEE CONSOLE'); }
}

function stopRecording(discard = false) {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false; clearInterval(recTimerInterval);
    $('#btnRec').classList.remove('recording'); recStatus.textContent = ''; recStatus.classList.remove('active');

    if (discard) { mediaRecorder.stop(); recordedChunks = []; showToast('RECORDING DISCARDED'); return; }
    mediaRecorder.stop();

    setTimeout(() => {
        if (recordedChunks.length === 0) { showToast('NO AUDIO CAPTURED'); return; }
        const duration = ((Date.now() - recStartTime) / 1000).toFixed(1);
        $('#sampleName').value = (currentPlaylist[currentVideoIndex] ? currentPlaylist[currentVideoIndex].title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30) : 'sample') + '-chop';
        $('#modalInfo').textContent = `DURATION: ${duration}s`;
        saveModal.classList.add('show'); $('#sampleName').focus(); $('#sampleName').select();
    }, 300);
}

$('#modalCancel').addEventListener('click', () => { saveModal.classList.remove('show'); recordedChunks = []; showToast('CANCELLED'); });
$('#modalSave').addEventListener('click', async () => {
    const filename = $('#sampleName').value.trim() || 'hakai-sample';
    saveModal.classList.remove('show'); showToast('CONVERTING TO WAV...');
    try {
        const wavBlob = await convertToWav(new Blob(recordedChunks, { type: 'audio/webm' }));
        downloadBlob(wavBlob, filename + '.wav');
        recordedChunks = []; showToast(`SAVED: ${filename}.wav`);
    } catch (err) {
        downloadBlob(new Blob(recordedChunks, { type: 'audio/webm' }), filename + '.webm'); 
        recordedChunks = []; showToast(`SAVED: ${filename}.webm`);
    }
});
$('#sampleName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#modalSave').click(); } if (e.key === 'Escape') { e.preventDefault(); $('#modalCancel').click(); } });

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function convertToWav(webmBlob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await ctx.decodeAudioData(await webmBlob.arrayBuffer());
    const interleaved = new Float32Array(audioBuffer.length * audioBuffer.numberOfChannels);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < audioBuffer.length; i++) interleaved[i * audioBuffer.numberOfChannels + ch] = channelData[i];
    }
    const pcm = new Int16Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
        const s = Math.max(-1, Math.min(1, interleaved[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const wavBuffer = new ArrayBuffer(44 + pcm.length * 2); const view = new DataView(wavBuffer);
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, audioBuffer.numberOfChannels, true); view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * audioBuffer.numberOfChannels * 2, true); view.setUint16(32, audioBuffer.numberOfChannels * 2, true); view.setUint16(34, 16, true);
    writeString(view, 36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
    ctx.close(); return new Blob([wavBuffer], { type: 'audio/wav' });
}
function writeString(view, offset, string) { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); }
function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${String(Math.floor((seconds % 1) * 100)).padStart(2, '0')}`; }

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
let toastTimeout;
function showToast(msg) { 
    const toast = $('#toast'); 
    toast.textContent = msg; 
    toast.classList.add('show'); 
    clearTimeout(toastTimeout); 
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 1800); 
}

function flashKey(selector) {
    const el = $(selector);
    if (!el) return;
    el.style.filter = 'brightness(1.5)';
    setTimeout(() => { el.style.filter = ''; }, 200);
}

function doGenNewPlaylist() {
    if (confirm('Generate a new playlist? Current playlist will be lost.')) {
        switchToScreen1();
        showToast('RETURNING TO SEARCH');
    }
}

document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
console.log('[HAKAI] MPC 2000 Crate Digging Center — Loaded v4.5');