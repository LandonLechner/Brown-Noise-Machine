let audioCtx = null;
let noiseSources = [];
let gainNode = null;
let filterNode = null;
let analyserNode = null;

let isPlaying = false;
let channelMode = 'mono'; // 'mono' or 'stereo'
let isVisualizerEnabled = true;
let animationFrameId = null;

// UI Elements
const powerBtn = document.getElementById('powerBtn');
const modeToggle = document.getElementById('modeToggle');
const monoOption = document.getElementById('monoOption');
const stereoOption = document.getElementById('stereoOption');
const filterSlider = document.getElementById('filterSlider');
const filterVal = document.getElementById('filterVal');
const rampSlider = document.getElementById('rampSlider');
const rampVal = document.getElementById('rampVal');
const volumeSlider = document.getElementById('volumeSlider');
const volumeVal = document.getElementById('volumeVal');
const visualizerContainer = document.getElementById('visualizerContainer');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');
const backgroundAudio = document.getElementById('backgroundAudio');

// Load saved state from localStorage (power always starts OFF)
function loadSettings() {
    try {
        if (localStorage.getItem('noise_channelMode')) {
            channelMode = localStorage.getItem('noise_channelMode');
        }
        if (localStorage.getItem('noise_filterFreq')) {
            filterSlider.value = localStorage.getItem('noise_filterFreq');
        }
        if (localStorage.getItem('noise_rampTime')) {
            rampSlider.value = localStorage.getItem('noise_rampTime');
        }
        if (localStorage.getItem('noise_volume')) {
            volumeSlider.value = localStorage.getItem('noise_volume');
        }
        if (localStorage.getItem('noise_visualizerEnabled') !== null) {
            isVisualizerEnabled = localStorage.getItem('noise_visualizerEnabled') === 'true';
        }
    } catch (e) {
        console.warn('Could not load settings from localStorage', e);
    }

    // Apply loaded mode UI
    if (channelMode === 'stereo') {
        modeToggle.classList.add('stereo');
        monoOption.classList.remove('active');
        stereoOption.classList.add('active');
    } else {
        modeToggle.classList.remove('stereo');
        stereoOption.classList.remove('active');
        monoOption.classList.add('active');
    }

    // Apply loaded visualizer UI state
    if (isVisualizerEnabled) {
        visualizerContainer.classList.remove('disabled');
    } else {
        visualizerContainer.classList.add('disabled');
    }

    updateLabels();
}

// Save settings to localStorage
function saveSetting(key, value) {
    try {
        localStorage.setItem(`noise_${key}`, value);
    } catch (e) {
        console.warn('Could not save setting to localStorage', e);
    }
}

// Convert dB to Linear Gain
function dbToGain(db) {
    return Math.pow(10, db / 20);
}

// Update Text Labels
function updateLabels() {
    volumeVal.textContent = `${parseFloat(volumeSlider.value).toFixed(1)} dB`;
    filterVal.textContent = `${Math.round(filterSlider.value)} Hz`;
    const rampSecs = parseFloat(rampSlider.value);
    rampVal.textContent = rampSecs === 0 ? '0 s (Immediate)' : `${rampSecs.toFixed(1)} s`;
}

// Setup Media Session API handlers
function initMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Noise Filter Generator',
            artist: 'Web Audio App',
            album: 'Background Noise'
        });

        navigator.mediaSession.setActionHandler('play', () => {
            if (!isPlaying) togglePower();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            if (isPlaying) togglePower();
        });
    }
}

// Handle background silent audio playback for mobile screens-off support
async function handleBackgroundAudio(start) {
    if (start) {
        try {
            backgroundAudio.currentTime = 0;
            await backgroundAudio.play();
        } catch (e) {
            console.warn('Background audio play blocked:', e);
        }
    } else {
        backgroundAudio.pause();
    }
}

// Initialize or Rebuild Audio Graph based on mode
function setupAudioGraph(targetMode) {
    const needsRestart = isPlaying && audioCtx;
    
    if (audioCtx) {
        noiseSources.forEach(src => {
            try { src.stop(); } catch(e) {}
        });
        noiseSources = [];
    } else {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }

    const bufferSize = audioCtx.sampleRate * 5;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        channelData[i] = Math.random() * 2 - 1;
    }

    if (!gainNode) {
        gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    }

    if (!filterNode) {
        filterNode = audioCtx.createBiquadFilter();
        filterNode.type = 'lowpass';
        filterNode.frequency.setValueAtTime(parseFloat(filterSlider.value), audioCtx.currentTime);
        filterNode.Q.setValueAtTime(1.0, audioCtx.currentTime);
    }

    if (!analyserNode) {
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
    }

    if (targetMode === 'mono') {
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(filterNode);
        noiseSources.push(src);
    } else {
        const merger = audioCtx.createChannelMerger(2);
        
        const srcLeft = audioCtx.createBufferSource();
        srcLeft.buffer = buffer;
        srcLeft.loop = true;
        
        const srcRight = audioCtx.createBufferSource();
        srcRight.buffer = buffer;
        srcRight.loop = true;
        srcRight.start(audioCtx.currentTime + 0.5);

        srcLeft.connect(merger, 0, 0);
        srcRight.connect(merger, 0, 1);
        merger.connect(filterNode);

        noiseSources.push(srcLeft, srcRight);
    }

    filterNode.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    noiseSources.forEach(src => {
        if (src !== noiseSources[1] || targetMode === 'mono') {
            src.start(now);
        }
    });

    if (needsRestart) {
        const targetGain = dbToGain(parseFloat(volumeSlider.value));
        gainNode.gain.setValueAtTime(targetGain, now);
    }
}

// Toggle Power
async function togglePower() {
    if (!audioCtx) {
        setupAudioGraph(channelMode);
    }

    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    const targetDb = parseFloat(volumeSlider.value);
    const targetGain = dbToGain(targetDb);
    const rampTime = parseFloat(rampSlider.value);
    const now = audioCtx.currentTime;

    gainNode.gain.cancelScheduledValues(now);

    if (!isPlaying) {
        // Turning ON
        isPlaying = true;
        powerBtn.classList.add('active');

        initMediaSession();
        handleBackgroundAudio(true);

        if (rampTime === 0) {
            gainNode.gain.setValueAtTime(targetGain, now);
        } else {
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(targetGain, now + rampTime);
        }
    } else {
        // Turning OFF
        handleBackgroundAudio(false);

        if (rampTime === 0) {
            gainNode.gain.setValueAtTime(0, now);
            isPlaying = false;
            powerBtn.classList.remove('active');
        } else {
            const currentGain = gainNode.gain.value;
            gainNode.gain.setValueAtTime(currentGain, now);
            gainNode.gain.linearRampToValueAtTime(0, now + rampTime);

            setTimeout(() => {
                if (!isPlaying && audioCtx) {
                    powerBtn.classList.remove('active');
                }
            }, 0);

            isPlaying = false;
        }
    }
}

// Event Listeners
powerBtn.addEventListener('click', togglePower);

// Mode Toggle Switch Listener
modeToggle.addEventListener('click', () => {
    if (channelMode === 'mono') {
        channelMode = 'stereo';
        modeToggle.classList.add('stereo');
        monoOption.classList.remove('active');
        stereoOption.classList.add('active');
    } else {
        channelMode = 'mono';
        modeToggle.classList.remove('stereo');
        stereoOption.classList.remove('active');
        monoOption.classList.add('active');
    }

    saveSetting('channelMode', channelMode);

    if (audioCtx) {
        setupAudioGraph(channelMode);
    }
});

filterSlider.addEventListener('input', () => {
    updateLabels();
    saveSetting('filterFreq', filterSlider.value);
    if (audioCtx && filterNode) {
        filterNode.frequency.setValueAtTime(parseFloat(filterSlider.value), audioCtx.currentTime);
    }
});

rampSlider.addEventListener('input', () => {
    updateLabels();
    saveSetting('rampTime', rampSlider.value);
});

volumeSlider.addEventListener('input', () => {
    updateLabels();
    saveSetting('volume', volumeSlider.value);
    if (audioCtx && isPlaying && gainNode) {
        const targetGain = dbToGain(parseFloat(volumeSlider.value));
        gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        gainNode.gain.setValueAtTime(targetGain, audioCtx.currentTime);
    }
});

// Toggle Visualizer Display on Click
visualizerContainer.addEventListener('click', () => {
    isVisualizerEnabled = !isVisualizerEnabled;
    saveSetting('visualizerEnabled', isVisualizerEnabled);

    if (isVisualizerEnabled) {
        visualizerContainer.classList.remove('disabled');
        drawVisualizer();
    } else {
        visualizerContainer.classList.add('disabled');
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
});

// Visualizer Loop
function drawVisualizer() {
    if (!isVisualizerEnabled) return;

    animationFrameId = requestAnimationFrame(drawVisualizer);

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }

    const bufferLength = analyserNode ? analyserNode.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);

    if (analyserNode && isPlaying) {
        analyserNode.getByteFrequencyData(dataArray);
    } else {
        dataArray.fill(0);
    }

    canvasCtx.fillStyle = 'rgba(2, 6, 23, 0.4)';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#0284c7');
        gradient.addColorStop(1, '#38bdf8');

        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
    }
}

// Initialize state on load
loadSettings();
if (isVisualizerEnabled) {
    drawVisualizer();
}