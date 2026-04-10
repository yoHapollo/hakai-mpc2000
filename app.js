/* ============================================
   HAKAI MPC 2000 — APP.JS (V3.3 - Retry Loop Fix)
   YouTube OAuth + Randomized Crate Digging
   + Pad Chopping + Keyboard MPC + WAV Export
   + 3-Second Skip Grid + Auto-Retry Engine
   ============================================ */

// ==========================================
// ▶▶▶  YOUR CREDENTIALS — EDIT THESE  ◀◀◀
// ==========================================
const CONFIG = {
    API_KEY: 'AIzaSyDaHVAAXKFjOiXc7pw9exh92MJYXIQ4Kvg',
    CLIENT_ID: '564150027983-aero1s5g4ctnm5iihv3c1un23rc2mnk5.apps.googleusercontent.com',
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
    
    // SAVE TO LOCAL STORAGE (Token lasts 1 hour)
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
        console.log('[HAKAI] Restored YouTube session from LocalStorage');
    } else {
        localStorage.removeItem('hakai_yt_token');
        localStorage.removeItem('hakai_yt_expires');
    }
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

// ==========================================
// YOUTUBE IFRAME API
// ==========================================
function onYouTubeIframeAPIReady() {
    console.log('[HAKAI] YouTube IFrame API ready');
    initGoogleAuth();
    checkExistingLogin(); 
}

function initPlayer(videoId) {
    playerReady = false;
    player = new YT.Player('ytPlayer', {
        width: '100%', height: '100%',
        videoId: videoId,
        playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, playsinline: 1, fs: 0 },
        events: { 
            onReady: (e) => { 
                playerReady = true; 
                e.target.playVideo(); 
            }, 
            onStateChange: () => {} 
        }
    });
}

function parseISO8601Duration(duration) {
    if (!duration) return 0;
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    return (hours * 3600) + (minutes * 60) + seconds;
}

// ==========================================
// ★★★ RANDOMIZED SEARCH SYSTEM (WITH RETRY) ★★★
// ==========================================

const QUERY_SUFFIXES = [
    'vinyl', 'original', 'rare', 'album track',
    'audio', 'HQ', 'remastered', 'single', 'official audio',
    'deep cut', 'B side', 'obscure', 'forgotten', 'classic',
    'groove', 'original mix', 'studio', 'LP', 'full album',
    'underground', 'lost', '45 rpm', 'compilation'
];

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

createBtn.addEventListener('click', async () => {
    const keywords = $('#keywords').value.trim();
    if (!keywords) { showToast('ENTER KEYWORDS'); return; }
    
    createBtn.style.display = 'none';
    loadingIndicator.classList.add('show');
    
    let results = [];
    let attempts = 0;
    const maxAttempts = 4; // Auto-retry up to 4 times if the filter gets 0 results

    while (attempts < maxAttempts && results.length === 0) {
        try {
            results = await searchYouTubeRandomized(
                keywords,
                yearStartSel.value,
                yearEndSel.value,
                $('#maxViews').value,
                $('#language').value,
                parseInt($('#playlistLength').value)
            );
        } catch (err) {
            console.error('[HAKAI] Search error on attempt', attempts + 1, err);
        }
        attempts++;
    }

    if (!results || results.length === 0) {
        showToast('NO RESULTS — TRY DIFFERENT KEYWORDS');
        createBtn.style.display = '';
        loadingIndicator.classList.remove('show');
        return;
    }

    currentPlaylist = results;
    currentVideoIndex = 0;
    hakaiPlaylistId = null;
    switchToScreen2();
});

async function searchYouTubeRandomized(keywords, yearStart, yearEnd, maxViews, language, maxResults) {
    const suffix = randomPick(QUERY_SUFFIXES);
    const negativeKeywords = '-"type beat" -"sample pack" -tutorial -how -remake -lesson -review -documentary -reaction -vlog -podcast';
    const startY = parseInt(yearStart);
    const endY = parseInt(yearEnd);
    const randomYearInEra = Math.floor(Math.random() * (endY - startY + 1)) + startY;
    const query = `${keywords} ${randomYearInEra} ${suffix} ${negativeKeywords}`;

    const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        q: query,
        maxResults: 50,
        order: randomPick(['relevance', 'rating']),
        videoCategoryId: '10',
        key: CONFIG.API_KEY,
    });
    if (language) params.set('relevanceLanguage', language);

    console.log(`[HAKAI] Digging: "${query}"`);

    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!resp.ok) throw new Error(`YT API ${resp.status}`);
    const data = await resp.json();

    let videos = (data.items || [])
        .filter(item => item.id && item.id.videoId)
        .map(item => ({ videoId: item.id.videoId, title: item.snippet.title }));

    const seen = new Set();
    videos = videos.filter(v => {
        if (seen.has(v.videoId)) return false;
        seen.add(v.videoId);
        return true;
    });

    if (videos.length > 0) {
        const ids = videos.map(v => v.videoId).join(',');
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
                const passesViews = views !== undefined && views <= maxViewCount;
                const passesDuration = durationSecs !== undefined && durationSecs >= 75 && durationSecs <= 900;
                return passesViews && passesDuration;
            });

            videos = videos.map(v => ({
                ...v,
                title: v.title + ` [${formatViewCount(viewMap[v.videoId])} views]`
            }));
        }
    }

    videos = shuffleArray(videos);
    return videos.slice(0, maxResults);
}

function formatViewCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
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

async function addToPlaylist() { /* same as before */ }
async function addToWatchLater() { /* same as before */ }
async function likeVideo() { /* same as before */ }

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
    
    if (!player) {
        initPlayer(video.videoId);
    } else {
        if (playerReady) player.loadVideoById(video.videoId); 
    }
}

// ==========================================
// TRANSPORT CONTROLS & SKIP
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

function doSkip(seconds) {
    if (!player || !playerReady) return;
    const currentTime = player.getCurrentTime();
    player.seekTo(currentTime + seconds, true);
    
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
        player.playVideo();
    }
    
    showToast(seconds > 0 ? '+3 SECONDS' : '-3 SECONDS');
}

$('#btnPlay').addEventListener('click', doPlay);
$('#btnStop').addEventListener('click', doStop);
$('#btnNext').addEventListener('click', doNext);
$('#btnLast').addEventListener('click', doLast);
$('#btnSkipBack').addEventListener('click', () => doSkip(-3));
$('#btnSkipFwd').addEventListener('click', () => doSkip(3));

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
        btn.classList.toggle('active-speed', parseFloat(btn.dataset.speed) === currentSpeed && currentSpeed !== 1.0);
    });
}
function doNormalSpeed() {
    currentSpeed = 1.0;
    if (player && playerReady) player.setPlaybackRate(1.0);
    updateSpeedUI(); showToast('SPEED: 1.0x');
}

// ==========================================
// PAD SYSTEM
// ==========================================
function getPadEl(idx) { return $(`.pad[data-pad="${idx}"]`); }

function triggerPad(idx) {
    if (!player || !playerReady) return;
    const padEl = getPadEl(idx);
    if (!padEl) return;

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

$$('.pad').forEach(padEl => {
    const idx = parseInt(padEl.dataset.pad);
    padEl.addEventListener('click', (e) => {
        if (e.altKey) { clearPad(idx); return; }
        triggerPad(idx);
    });
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

// ==========================================
// ★★★ KEYBOARD MAPPING ★★★
// ==========================================
const KEY_TO_PAD = {
    'z': 0, 'x': 1, 'c': 2, 'a': 3, 's': 4, 'd': 5,
    'q': 6, 'w': 7, 'e': 8, '1': 9, '2': 10, '3': 11,
};
const KEY_TO_SPEED = { 'm': 0.5, ',': 0.75, '.': 1.25, '/': 1.5 };

document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (saveModal.classList.contains('show')) return;

    const key = e.key.toLowerCase();

    if (KEY_TO_PAD.hasOwnProperty(key)) {
        e.preventDefault();
        const idx = KEY_TO_PAD[key];
        triggerPad(idx);
        const padEl = getPadEl(idx);
        if (padEl) {
            padEl.style.filter = 'brightness(1.3)';
            setTimeout(() => { padEl.style.filter = ''; }, 100);
        }
        return;
    }

    if (KEY_TO_SPEED.hasOwnProperty(key)) {
        e.preventDefault();
        setSpeed(KEY_TO_SPEED[key]);
        return;
    }

    if (key === 'arrowleft') { e.preventDefault(); doLast(); return; }
    if (key === 'arrowright') { e.preventDefault(); doNext(); return; }
    if (key === ' ') { e.preventDefault(); doTogglePlayPause(); return; }

    if (key === '[') { e.preventDefault(); doSkip(-3); return; }
    if (key === ']') { e.preventDefault(); doSkip(3); return; }

    if (key === 'k') { e.preventDefault(); doGenNewPlaylist(); return; }
    if (key === 'l') { e.preventDefault(); addToPlaylist(); return; }
    if (key === ';') { e.preventDefault(); doNormalSpeed(); return; }
    if (key === "'") { e.preventDefault(); likeVideo(); return; }

    if (key === 'r') { e.preventDefault(); startRecording(); return; }
    if (key === 't') { e.preventDefault(); stopRecording(false); return; }
});

// ==========================================
// AUDIO RECORDING & WAV LOGIC (Untouched)
// ==========================================
$('#btnRec').addEventListener('click', startRecording);
$('#btnStopRec').addEventListener('click', () => stopRecording(false));

async function startRecording() {
    if (isRecording) return;
    try {
        let stream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: true });
            stream.getVideoTracks().forEach(t => t.stop());
            if (stream.getAudioTracks().length === 0) throw new Error('No audio track');
        } catch (displayErr) {
            showToast('SHARE TAB AUDIO TO RECORD'); return;
        }

        audioStream = stream; recordedChunks = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        mediaRecorder = new MediaRecorder(stream, { mimeType });

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => { if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; } };

        mediaRecorder.start(100); isRecording = true; recStartTime = Date.now();
        $('#btnRec').classList.add('recording');
        recStatus.textContent = '● REC 0:00'; recStatus.classList.add('active');

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
        const video = currentPlaylist[currentVideoIndex];
        $('#sampleName').value = (video ? video.title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30) : 'sample') + '-chop';
        $('#modalInfo').textContent = `DURATION: ${duration}s`;
        saveModal.classList.add('show'); $('#sampleName').focus(); $('#sampleName').select();
    }, 300);
}

$('#modalCancel').addEventListener('click', () => { saveModal.classList.remove('show'); recordedChunks = []; showToast('CANCELLED'); });
$('#modalSave').addEventListener('click', async () => {
    const filename = $('#sampleName').value.trim() || 'hakai-sample';
    saveModal.classList.remove('show'); showToast('CONVERTING TO WAV...');
    try {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const wavBlob = await convertToWav(blob);
        downloadBlob(wavBlob, filename + '.wav');
        recordedChunks = []; showToast(`SAVED: ${filename}.wav`);
    } catch (err) {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        downloadBlob(blob, filename + '.webm'); recordedChunks = []; showToast(`SAVED: ${filename}.webm`);
    }
});
$('#sampleName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#modalSave').click(); }
    if (e.key === 'Escape') { e.preventDefault(); $('#modalCancel').click(); }
});

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function convertToWav(webmBlob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const numChannels = audioBuffer.numberOfChannels; const sampleRate = audioBuffer.sampleRate; const length = audioBuffer.length;
    const interleaved = new Float32Array(length * numChannels);
    for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < length; i++) interleaved[i * numChannels + ch] = channelData[i];
    }
    const pcm = new Int16Array(interleaved.length);
    for (let i = 0; i < interleaved.length; i++) {
        const s = Math.max(-1, Math.min(1, interleaved[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const wavBuffer = new ArrayBuffer(44 + pcm.length * 2); const view = new DataView(wavBuffer);
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true);
    writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true); view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true); writeString(view, 36, 'data'); view.setUint32(40, pcm.length * 2, true);
    const offset = 44; for (let i = 0; i < pcm.length; i++) view.setInt16(offset + i * 2, pcm[i], true);
    ctx.close(); return new Blob([wavBuffer], { type: 'audio/wav' });
}
function writeString(view, offset, string) { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); }

function formatTime(seconds) {
    const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); const ms = Math.floor((seconds % 1) * 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
let toastTimeout;
function showToast(msg) {
    const toast = $('#toast'); toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove('show'), 1800);
}
document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
console.log('[HAKAI] MPC 2000 Crate Digging Center — Loaded v3.3');