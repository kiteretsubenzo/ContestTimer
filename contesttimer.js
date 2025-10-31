(() => {
    // ========= 基本DOM =========
    const timeEl = document.getElementById('time');
    const startBtn = document.getElementById('btn-start');
    const stopBtn = document.getElementById('btn-stop');
    const resetBtn = document.getElementById('reset');

    const alarmsWrap = document.getElementById('alarms');
    const addBtn = document.getElementById('add-alarm');
    const template = document.getElementById('alarm-template');

    // ========= 設定 =========
    // 音名リスト（soundfiles.js で定義）
    const NAMES = window.SOUND_FILES || [];
    // 音ファイルの場所（日本語名そのまま -> sounds/<name>.mp3）
    const toUrl = (name) => `sounds/${name}.mp3`;
    // アラーム行の保存キー
    const LS_KEY = 'contesttimer.alarms.v1';
    // タイマー作動中に操作不可になる項目
    const alarmBlock = document.getElementById('alarm-block');

    // ========= 状態 =========
    let running = false;            // 動作中フラグ
    let elapsedSecDisplay = -3;     // 画面表示の整数秒（-3 → 0 → …）

    // ===== 単一クロック（AudioContext.currentTime） =====
    // ・audioStartSec: Start を押した瞬間の currentTime（秒）
    // ・startOffsetSec: Start時点の表示ベース（再開時は当時の表示から）
    let audioCtx = null;
    let audioStartSec = 0;
    let startOffsetSec = -3;

    // 100ms UI更新タイマー
    let uiTimer = null;

    // 読み込み済み AudioBuffer
    const BUFFERS = new Map(); // name -> AudioBuffer

    // 「過去に鳴らした（再発火防止）」管理
    const firedSet = new Set(); // e.g. "ベル1@30"

    // ==== Screen Wake Lock ====
    let wakeLock = null;
    const WAKELOCK_SUPPORTED = ('wakeLock' in navigator);

    /** 画面消灯抑止（取得できたらOK、解除は安全停止に寄せる） */
    async function acquireWakeLock() {
        if (!WAKELOCK_SUPPORTED || wakeLock) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                stop(); // OS都合で切れたら停止（通知なし）
                wakeLock = null;
                console.log('Wake Lock released');
            });
            console.log('Wake Lock acquired');
        } catch (err) {
            console.warn('Wake Lock acquire failed:', err);
        }
    }

    /** 画面消灯抑止の明示解放（冪等） */
    async function releaseWakeLock() {
        if (!wakeLock) return;
        try { await wakeLock.release(); } catch { }
        wakeLock = null;
        console.log('Wake Lock manually released');
    }

    // ========= ユーティリティ =========

    /** 秒（整数）→ mm:ss or -mm:ss */
    const fmt = (n) => {
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    /** 表示の再描画 */
    function render() {
        timeEl.textContent = fmt(elapsedSecDisplay);
    }

    /** ボタンの活性/非活性切り替え */
    function updateControls() {
        startBtn.classList.toggle('d-none', running);
        stopBtn.classList.toggle('d-none', !running);
        resetBtn.disabled = running || elapsedSecDisplay === -3;

        alarmBlock.classList.toggle('is-readonly', running);
    }

    // ========= アラーム行の生成・編集 =========

    /** セレクトに 0..max を注入 */
    function fillSelect(sel, max) {
        sel.innerHTML = '';
        for (let i = 0; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i).padStart(2, '0');
            sel.appendChild(opt);
        }
    }

    /** 音セレクトに NAMES を注入 */
    function fillSoundSelect(sel) {
        sel.innerHTML = '';
        for (const name of NAMES) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        }
        if (NAMES.length > 0) sel.value = NAMES[0];
    }

    /** 行にイベントを付与（保存・削除・試聴） */
    function attachRowHandlers(row) {
        const selSound = row.querySelector('.sound');
        const selMin = row.querySelector('.min');
        const selSec = row.querySelector('.sec');
        const btnDel = row.querySelector('.remove');

        // 値変更で保存
        const onChange = () => saveAlarms();
        selSound.addEventListener('change', onChange);
        selMin.addEventListener('change', onChange);
        selSec.addEventListener('change', onChange);

        // 行削除
        btnDel.addEventListener('click', () => {
            row.remove();
            saveAlarms();
        });

        // --- 試聴：armed + change/blur/focusout のどれか1回で再生 ---
        let armed = false, fired = false;
        const arm = () => { armed = true; fired = false; };

        const previewOnce = async () => {
            if (!armed || fired) return;
            fired = true; armed = false;
            try {
                if (!audioCtx) {
                    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
                }
                try { await audioCtx.resume(); } catch { }
                const name = selSound.value;
                await ensureBuffer(name);
                // iOS の値反映タイミングに合わせる
                requestAnimationFrame(() => playNow(name));
            } catch (e) {
                console.warn('preview failed:', e);
            }
        };

        selSound.addEventListener('pointerdown', arm, { passive: true });
        selSound.addEventListener('focusin', arm);
        selSound.addEventListener('change', previewOnce);
        selSound.addEventListener('blur', previewOnce);
        selSound.addEventListener('focusout', previewOnce);
    }

    /** 新しい行を作成して追加（オプションで初期値あり） */
    function createAlarmRow(values = null) {
        const clone = template.cloneNode(true);
        clone.style.display = '';
        clone.id = '';

        const selSound = clone.querySelector('.sound');
        const selMin = clone.querySelector('.min');
        const selSec = clone.querySelector('.sec');

        fillSoundSelect(selSound);
        fillSelect(selMin, 20);
        fillSelect(selSec, 59);

        if (values) {
            if (values.name) selSound.value = values.name;
            if (typeof values.min === 'number') selMin.value = String(values.min);
            if (typeof values.sec === 'number') selSec.value = String(values.sec);
        }

        attachRowHandlers(clone);
        alarmsWrap.appendChild(clone);
        return clone;
    }

    // ========= 永続化（localStorage） =========

    /** 画面上の行を配列へスナップショット */
    function snapshotAlarms() {
        const list = [];
        alarmsWrap.querySelectorAll('.alarm-row').forEach(row => {
            const selSound = row.querySelector('.sound');
            const selMin = row.querySelector('.min');
            const selSec = row.querySelector('.sec');
            if (!selSound || !selMin || !selSec) return;

            const name = selSound.value;
            const min = parseInt(selMin.value || '0', 10);
            const sec = parseInt(selSec.value || '0', 10);
            if (!name || Number.isNaN(min) || Number.isNaN(sec)) return;

            list.push({ name, min, sec });
        });
        return list;
    }

    /** 保存 */
    function saveAlarms() {
        try {
            const data = snapshotAlarms();
            localStorage.setItem(LS_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('saveAlarms failed:', e);
        }
    }

    /** 読み込み */
    function loadAlarms() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : null;
        } catch {
            return null;
        }
    }

    /** 初期復元（保存がなければデフォルト1行） */
    function restoreAlarmsOrDefault() {
        const data = loadAlarms();
        if (data && data.length) {
            for (const it of data) {
                if (!NAMES.includes(it.name)) continue;
                const min = Math.min(20, Math.max(0, Number(it.min || 0)));
                const sec = Math.min(59, Math.max(0, Number(it.sec || 0)));
                createAlarmRow({ name: it.name, min, sec });
            }
        } else {
            createAlarmRow({ name: NAMES[0] || '', min: 0, sec: 10 });
        }
    }

    // ========= トリガー収集（UI -> [{name, atSec}]） =========

    /** 今ある行から「いつ何を鳴らすか」の配列を得る */
    function collectAlarmTriggers() {
        return Array.from(alarmsWrap.querySelectorAll('.alarm-row'))
            .map(row => {
                const name = row.querySelector('.sound')?.value;
                const min = parseInt(row.querySelector('.min')?.value ?? '0', 10);
                const sec = parseInt(row.querySelector('.sec')?.value ?? '0', 10);
                if (!name || Number.isNaN(min) || Number.isNaN(sec)) return null;
                return { name, atSec: min * 60 + sec };
            })
            .filter(Boolean)
            .sort((a, b) => a.atSec - b.atSec);
    }

    // ========= Audio =========

    /** 指定名の AudioBuffer を用意（SWのオフラインキャッシュ前提） */
    async function ensureBuffer(name) {
        if (BUFFERS.has(name)) return BUFFERS.get(name);
        // NOTE: fetch の cache 指定は行わない（SW が面倒を見る）
        const res = await fetch(toUrl(name));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(arr);
        BUFFERS.set(name, buf);
        return buf;
    }

    /** その場で即時再生（排他/停止は実装しない方針） */
    function playNow(name) {
        const buf = BUFFERS.get(name);
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        try { src.start(0); } catch (e) { console.warn('playNow failed:', name, e); }
    }

    // ========= 単一クロックに基づく「今の整数秒」 =========

    /** 現在の経過秒（整数）＝ startOffsetSec + (currentTime - audioStartSec) */
    function nowElapsedSec() {
        if (!audioCtx) return elapsedSecDisplay;
        const precise = (audioCtx.currentTime - audioStartSec); // 秒
        return Math.floor(startOffsetSec + precise);
    }

    // ========= 100ms ループ（表示＆境界即時発火） =========

    /** 100ms ごとに表示更新＆「prev < at ≤ now」判定で即時鳴動 */
    function loop100ms(triggers) {
        let prev = nowElapsedSec();

        function onTick() {
            if (!running) return;

            const now = nowElapsedSec();

            // 表示更新（整数秒が進んだとき）
            if (now !== elapsedSecDisplay) {
                elapsedSecDisplay = now;
                render();
                updateControls();
            }

            // 境界を跨いだトリガーを即時発火
            if (now > prev && triggers && triggers.length) {
                for (const { name, atSec } of triggers) {
                    if (atSec <= prev || atSec > now) continue;
                    const key = `${name}@${atSec}`;
                    if (firedSet.has(key)) continue; // 再発火防止
                    playNow(name);
                    firedSet.add(key);
                }
            }

            prev = now;
        }

        uiTimer = setInterval(onTick, 100);
    }

    // ========= Start/Stop/Reset =========

    /** Start：AudioContext 作成→基準時刻を確定→必要音をデコード→ループ開始 */
    async function start() {
        if (running) return;
        running = true;
        updateControls();

        acquireWakeLock(); // 非同期

        // AudioContext は毎回作成（端末状態の揺れを避ける）
        if (audioCtx) {
            try { await audioCtx.close(); } catch { }
        }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive'
        });
        try { await audioCtx.resume(); } catch { }

        // 基準確定（再開なら当時の表示から続き）
        startOffsetSec = elapsedSecDisplay;
        audioStartSec = audioCtx.currentTime;

        // トリガー収集 → 必要な音だけまとめて decode
        const triggers = collectAlarmTriggers();
        const uniqueNames = Array.from(new Set(triggers.map(t => t.name)));
        for (const name of uniqueNames) {
            try { await ensureBuffer(name); } catch (e) { console.warn('decode failed:', name, e); }
        }

        // 100ms ループ開始
        loop100ms(triggers);
    }

    /** Stop：ループ停止・WakeLock解放（表示値と firedSet は維持） */
    function stop() {
        if (!running) return;
        clearInterval(uiTimer);
        uiTimer = null;
        running = false;
        updateControls();
        releaseWakeLock();
    }

    /** Reset：ゼロからやり直し（表示=-3、発火履歴クリア） */
    function reset() {
        if (running) return;
        elapsedSecDisplay = -3;
        startOffsetSec = -3;
        firedSet.clear();
        render();
        updateControls();
    }

    // ========= UIイベント =========
    addBtn.addEventListener('click', () => { createAlarmRow(); saveAlarms(); });
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // ===== Wake Lock デバッグ表示（右上 0.5sポーリング） =====
    (() => {
        const el = document.getElementById('wakelock-indicator');
        if (!el) return;
        const icon = el.querySelector('.bi');
        setInterval(() => {
            const active = !!(typeof wakeLock !== 'undefined' && wakeLock && !wakeLock.released);
            icon.className = active ? 'bi bi-lock' : 'bi bi-unlock';
        }, 500);
    })();

    // ========= 初期化 =========
    restoreAlarmsOrDefault();
    render();
    updateControls();
})();
