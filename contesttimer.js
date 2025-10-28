(() => {
    const timeEl = document.getElementById('time');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const resetBtn = document.getElementById('reset');

    const SOUND_FILES = window.SOUND_FILES || []; // 例: ['start','警告1','警告2','警告3','爆発1']
    const toUrl = (name) => `sounds/${name}.mp3`;

    let running = false;
    let elapsed = -3;
    let prev = -3;
    let timerId = null;

    // ===== プリロード & アンロック =====
    const PRELOADED = new Map(); // name -> HTMLAudioElement（ロード済み）
    const PRIMED = new Map(); // name -> HTMLAudioElement（ユーザー操作でアンロック済み）

    // ページロード時に全音源を読み込む（メモリは気にしない前提）
    function preloadAllAudios() {
        for (const name of SOUND_FILES) {
            if (!name || PRELOADED.has(name)) continue;
            const a = new Audio(toUrl(name));
            a.preload = 'auto';
            a.playsInline = true; // iOS Safari
            try { a.load(); } catch { }
            PRELOADED.set(name, a);
        }
    }

    // スタート時（ユーザー操作中）に必要な音源を“無音ワンタップ→停止”してアンロック
    async function primeAudios(names) {
        for (const name of names) {
            if (!name || PRIMED.has(name)) continue;
            const a = PRELOADED.get(name) || new Audio(toUrl(name));
            a.preload = 'auto';
            a.playsInline = true;
            try {
                a.muted = true;
                await a.play();      // ← 再生権限を獲得
                a.pause();
                a.currentTime = 0;
            } catch (_) {
                // まれにここで例外でも後続の再生でフォールバックする
            } finally {
                a.muted = false;
            }
            PRIMED.set(name, a);
            PRELOADED.set(name, a);
        }
    }

    // 可能な限りアンロック済み（or プリロード済み）を使って再生
    function playPrimed(name) {
        if (!name) return;
        const el = PRIMED.get(name) || PRELOADED.get(name) || new Audio(toUrl(name));
        try {
            el.currentTime = 0;
            el.play().catch(() => { });
        } catch { }
        // 一度使ったら保持（次回以降も即再生できる）
        PRELOADED.set(name, el);
    }

    // ===== 表示関係 =====
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

    // ===== 固定スケジュール（0:10 / 0:20 / 0:30）=====
    let FIXED_SCHEDULE = [];    // [{t:10,name:'start'}, ...]
    let firedNames = new Set(); // 鳴らしたものを記録（一度だけ）

    function buildFixedSchedule() {
        FIXED_SCHEDULE = [];
        firedNames = new Set();
        if (SOUND_FILES[0]) FIXED_SCHEDULE.push({ t: 10, name: SOUND_FILES[2] });
        if (SOUND_FILES[1]) FIXED_SCHEDULE.push({ t: 20, name: SOUND_FILES[1] });
        if (SOUND_FILES[2]) FIXED_SCHEDULE.push({ t: 30, name: SOUND_FILES[0] });
    }

    // ===== タイマー =====
    function tick() {
        prev = elapsed;
        elapsed += 1;
        render();

        // 跨ぎ検知 prev < t <= elapsed
        for (const item of FIXED_SCHEDULE) {
            if (firedNames.has(item.name)) continue;
            if (prev < item.t && item.t <= elapsed) {
                firedNames.add(item.name);
                playPrimed(item.name);
            }
        }
    }

    // ===== ボタン動作 =====
    async function start() {
        if (running) return;

        buildFixedSchedule();

        // スタート時に全音をアンロック（プリロード済みを即アンロック）
        await primeAudios(SOUND_FILES);

        running = true;
        updateControls();
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
        render();
        updateControls();
    }

    // ===== イベント =====
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // 初期処理：全音プリロード → 表示更新
    preloadAllAudios();
    render();
    updateControls();
})();
