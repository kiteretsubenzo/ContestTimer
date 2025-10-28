(() => {
    const timeEl = document.getElementById('time');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const resetBtn = document.getElementById('reset');

    const NAMES = window.SOUND_FILES || []; // 例: ['start','警告1','警告2','警告3','爆発1']
    const toUrl = (name) => `sounds/${encodeURIComponent(name)}.mp3`;

    // ===== 高精度＆確実再生のため Web Audio を使用 =====
    let audioCtx = null;
    const BUFFERS = new Map(); // name -> AudioBuffer（完全デコード済み）

    // ページロード時に全部取りに行ってデコードしておく
    (async function preloadAll() {
        for (const name of NAMES) {
            if (!name || BUFFERS.has(name)) continue;
            try {
                const res = await fetch(toUrl(name), { cache: 'reload' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const arr = await res.arrayBuffer();
                // decodeAudioData は AudioContext が要るが、未作成でも作ってOK（後で resume すれば再生可）
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const buf = await audioCtx.decodeAudioData(arr);
                BUFFERS.set(name, buf);
            } catch (e) {
                console.warn('preload failed:', name, e);
            }
        }
        try { audioCtx && audioCtx.suspend && audioCtx.state === 'running' && audioCtx.suspend(); } catch { }
    })();

    // 再生（decode 済み buffer を使って即時再生）
    function playBuffer(name) {
        const buf = BUFFERS.get(name);
        if (!buf || !audioCtx) return;
        try {
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(audioCtx.destination);
            src.start(0);
        } catch (e) {
            console.warn('play failed:', name, e);
        }
    }

    // ===== 表示・制御 =====
    let running = false;
    let elapsed = -3;
    let prev = -3;
    let timerId = null;

    const fmt = (n) => {
        const sign = n < 0 ? '-' : '';
        n = Math.abs(n);
        const m = Math.floor(n / 60);
        const s = n % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    const render = () => { timeEl.textContent = fmt(elapsed); };
    const updateControls = () => {
        startBtn.classList.toggle('d-none', running);
        stopBtn.classList.toggle('d-none', !running);
        resetBtn.disabled = running || elapsed === -3;
    };

    // 固定スケジュール 10/20/30 秒
    let FIXED = [];
    let fired = new Set();
    function buildFixed() {
        FIXED = [];
        fired = new Set();
        if (NAMES[0]) FIXED.push({ t: 10, name: NAMES[0] });
        if (NAMES[1]) FIXED.push({ t: 20, name: NAMES[1] });
        if (NAMES[2]) FIXED.push({ t: 30, name: NAMES[2] });
    }

    // タイマーは 250ms 刻みにしてドリフトを抑えつつ跨ぎ検知
    function tick() {
        prev = elapsed;
        elapsed += 1;
        render();
        for (const it of FIXED) {
            if (fired.has(it.name)) continue;
            if (prev < it.t && it.t <= elapsed) {
                fired.add(it.name);
                playBuffer(it.name);
            }
        }
    }

    async function start() {
        if (running) return;

        // AudioContext をユーザー操作中に resume（iOS対策）
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state !== 'running') {
            try { await audioCtx.resume(); } catch { }
        }

        // まだ decode 中だった可能性に保険（未デコード分をここで同期完了させる）
        for (const name of NAMES) {
            if (!BUFFERS.get(name)) {
                try {
                    const res = await fetch(toUrl(name), { cache: 'reload' });
                    const arr = await res.arrayBuffer();
                    const buf = await audioCtx.decodeAudioData(arr);
                    BUFFERS.set(name, buf);
                } catch (e) {
                    console.warn('late decode failed:', name, e);
                }
            }
        }

        buildFixed();
        running = true;
        updateControls();

        // 1秒刻みの UI 更新＋判定（跨ぎ検知で取りこぼしなし）
        timerId = setInterval(tick, 1000);
    }

    function stop() {
        if (!running) return;
        clearInterval(timerId);
        timerId = null;
        running = false;
        updateControls();
    }

    function reset() {
        if (running) return;
        elapsed = -3;
        prev = -3;
        render(); updateControls();
    }

    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    render(); updateControls();
})();
