(() => {
    const timeEl = document.getElementById('time');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const resetBtn = document.getElementById('reset');

    // 再生対象のファイル名（soundfiles.js で定義）
    const NAMES = window.SOUND_FILES || [];

    // ====== 状態 ======
    let running = false;
    let elapsed = -3; // 表示用タイマー
    let prev = -3;
    let uiTimer = null;

    // ====== Web Audio ======
    let audioCtx = null;
    const BUFFERS = new Map();  // name -> AudioBuffer
    const SCHEDULES = [];       // {src, at, name}
    const FIXED = [
        { t: 10, i: 0 },
        { t: 20, i: 1 },
        { t: 30, i: 2 }
    ];

    // ====== 表示関連 ======
    const fmt = (n) => {
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const render = () => {
        timeEl.textContent = fmt(elapsed);
    };

    const updateControls = () => {
        startBtn.classList.toggle('d-none', running);
        stopBtn.classList.toggle('d-none', !running);
        resetBtn.disabled = running || elapsed === -3;
    };

    // ====== Audio 読み込み ======
    async function loadBuffer(name) {
        if (BUFFERS.has(name)) return BUFFERS.get(name);
        try {
            const res = await fetch(`sounds/${name}.mp3`, { cache: 'reload' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const arr = await res.arrayBuffer();
            const buf = await audioCtx.decodeAudioData(arr);
            BUFFERS.set(name, buf);
            return buf;
        } catch (e) {
            console.warn('loadBuffer failed:', name, e);
            return null;
        }
    }

    // ====== 再生予約 ======
    function schedulePlay(name, delaySeconds) {
        const buf = BUFFERS.get(name);
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);

        const at = audioCtx.currentTime + delaySeconds;
        try {
            src.start(at);
            SCHEDULES.push({ src, at, name });
        } catch (e) {
            console.warn('schedulePlay failed:', name, e);
        }
    }

    // ====== タイマー ======
    function tick() {
        prev = elapsed;
        elapsed += 1;
        render();
    }

    // ====== 開始 ======
    async function start() {
        if (running) return;
        running = true;
        updateControls();

        // AudioContextをユーザー操作で生成＆resume
        if (audioCtx) {
            try {
                await audioCtx.close();
            } catch { }
        }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        try {
            await audioCtx.resume();
        } catch { }

        // 対象音をロード
        const targets = FIXED.map(x => NAMES[x.i]).filter(Boolean);
        for (const name of targets) {
            await loadBuffer(name);
        }

        // スケジュール設定 (-3から始まるので +3秒オフセット)
        const offset = 3;
        for (const { t, i } of FIXED) {
            const name = NAMES[i];
            if (!name || !BUFFERS.has(name)) continue;
            schedulePlay(name, t + offset);
        }

        // UIタイマー開始（表示のみ）
        prev = elapsed;
        uiTimer = setInterval(tick, 1000);
    }

    // ====== 停止 ======
    function stop() {
        if (!running) return;

        clearInterval(uiTimer);
        uiTimer = null;

        try {
            for (const s of SCHEDULES) {
                s.src.stop(0);
            }
        } catch { }

        SCHEDULES.length = 0;
        running = false;
        updateControls();
    }

    // ====== リセット ======
    function reset() {
        if (running) return;
        elapsed = -3;
        prev = -3;
        render();
        updateControls();
    }

    // ====== イベント登録 ======
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // 初期化
    render();
    updateControls();
})();
