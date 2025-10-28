(() => {
    const timeEl = document.getElementById('time');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const resetBtn = document.getElementById('reset');

    const NAMES = window.SOUND_FILES || []; // 例: ['start','警告1','警告2','警告3','爆発1']
    const toUrl = (name) => `sounds/${encodeURIComponent(name)}.mp3`;

    // ====== 状態 ======
    let running = false;
    let elapsed = -3;    // 表示用（-3からカウントアップ）
    let prev = -3;
    let uiTimer = null;

    // Web Audio（iPhone対策）
    let audioCtx = null;
    const BUFFERS = new Map();     // name -> AudioBuffer（この context で decode 済み）
    let scheduled = [];            // [{src, at, name}]
    const FIXED = [{ t: 10, i: 0 }, { t: 20, i: 1 }, { t: 30, i: 2 }]; // t=秒, i=names index

    // ====== 表示系 ======
    const fmt = (n) => {
        const sign = n < 0 ? '-' : '';
        n = Math.abs(n);
        const m = Math.floor(n / 60), s = n % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    const render = () => { timeEl.textContent = fmt(elapsed); };
    const updateControls = () => {
        startBtn.classList.toggle('d-none', running);
        stopBtn.classList.toggle('d-none', !running);
        resetBtn.disabled = running || elapsed === -3;
    };

    // ====== デコード（AudioContext作成後に行う：iOS安定のため） ======
    async function ensureBuffer(name) {
        if (BUFFERS.has(name)) return BUFFERS.get(name);
        const res = await fetch(toUrl(name), { cache: 'reload' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(arr);
        BUFFERS.set(name, buf);
        return buf;
    }

    // ====== 予約再生（AudioContextの絶対時刻で start） ======
    function schedulePlayAt(name, atTime) {
        const buf = BUFFERS.get(name);
        if (!buf) return; // 安全側
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        try {
            src.start(atTime); // ← ここが肝：将来時刻に予約
            scheduled.push({ src, at: atTime, name });
        } catch (e) {
            console.warn('schedule failed:', name, e);
        }
    }

    // ====== スタート ======
    async function start() {
        if (running) return;
        running = true;
        updateControls();

        // iOS要件：ユーザー操作中に context を新規作成 & resume
        audioCtx?.close?.();                 // 前回残っていれば閉じてクリーンに
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state !== 'running') {
            try { await audioCtx.resume(); } catch { }
        }

        // この context で必要音を decode（先頭3つが対象）
        const targetNames = FIXED.map(x => NAMES[x.i]).filter(Boolean);
        for (const name of targetNames) {
            try { await ensureBuffer(name); } catch (e) { console.warn('decode failed:', name, e); }
        }

        // 予約：画面上は -3 から開始なので、0:10 は「スタートから +13秒」
        const now = audioCtx.currentTime;
        scheduled = [];
        for (const { t, i } of FIXED) {
            const name = NAMES[i];
            if (!name || !BUFFERS.get(name)) continue;
            const delayFromStart = t + 3;           // -3 → 0 までの3秒を足す
            const at = now + delayFromStart;
            schedulePlayAt(name, at);
        }

        // 表示カウント（再生は上の予約に任せる）
        prev = elapsed;
        uiTimer = setInterval(() => {
            prev = elapsed;
            elapsed += 1;
            render();
            // 取りこぼし保険（万一予約が失敗した場合に限り、跨ぎ検知で即再生）
            for (const { t, i } of FIXED) {
                const name = NAMES[i];
                if (!name) continue;
                if (prev < t && t <= elapsed) {
                    // すでに予約されているなら何もしない（二重再生防止）
                    // 予約配列に該当が無ければ今すぐ再生（保険）
                    const has = scheduled.some(s => s.name === name && s.at >= audioCtx.currentTime - 0.05);
                    if (!has && BUFFERS.get(name)) {
                        const src = audioCtx.createBufferSource();
                        src.buffer = BUFFERS.get(name);
                        src.connect(audioCtx.destination);
                        try { src.start(0); } catch { }
                    }
                }
            }
        }, 1000);
    }

    // ====== ストップ / リセット ======
    function stop() {
        if (!running) return;
        clearInterval(uiTimer); uiTimer = null;
        // 予約していた音を止める
        try { scheduled.forEach(s => s.src.stop(0)); } catch { }
        scheduled = [];
        running = false;
        updateControls();
    }

    function reset() {
        if (running) return;
        elapsed = -3;
        prev = -3;
        render();
        updateControls();
    }

    // ====== イベント ======
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // 初期表示
    render();
    updateControls();
})();
