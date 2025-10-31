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
    const NAMES = window.SOUND_FILES || [];  // 例: ['アラーム','ベル1',...]
    const toUrl = (name) => `sounds/${name}.mp3`; // 日本語名そのまま
    const LS_KEY = 'contesttimer.alarms.v1';       // ← 保存キー

    // ========= 状態 =========
    let running = false;

    // 表示用の整数秒（-3 → 0 → ...）。resetで -3 に戻す
    let elapsedSecDisplay = -3;

    // ===== 単一クロック（AudioContext） =====
    // ・audioStartSec: Startボタンを押した瞬間の audioCtx.currentTime（秒）
    // ・startOffsetSec: Start時点の表示ベース（再開時はその時の elapsedSecDisplay が入る）
    // ・pausedAccumSec: Pause運用があれば加算するが、今回は Stop/Start 方式なので常に 0
    let audioCtx = null;
    let audioStartSec = 0;
    let startOffsetSec = -3;
    let pausedAccumSec = 0;

    // 高速UI更新（100ms）用タイマー
    let uiTimer = null;

    // AudioBuffers
    const BUFFERS = new Map(); // name -> AudioBuffer（このcontextでdecode済み）

    // 発火済イベントの管理（過去発火の再発防止）
    // 例: firedSet.has( "name@sec" )
    const firedSet = new Set();

    // ==== Screen Wake Lock ====
    let wakeLock = null;
    const WAKELOCK_SUPPORTED = ('wakeLock' in navigator);

    async function acquireWakeLock() {
        if (!WAKELOCK_SUPPORTED || wakeLock) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            // OS都合の解除は安全停止（通知なし）
            wakeLock.addEventListener('release', () => {
                stop();
                wakeLock = null;
                console.log('Wake Lock released');
            });
            console.log('Wake Lock acquired');
        } catch (err) {
            console.warn('Wake Lock acquire failed:', err);
        }
    }

    async function releaseWakeLock() {
        if (!wakeLock) return;
        try { await wakeLock.release(); } catch { }
        wakeLock = null;
        console.log('Wake Lock manually released');
    }

    // ========= ユーティリティ =========
    const fmt = (n) => {
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    function render() {
        timeEl.textContent = fmt(elapsedSecDisplay);
    }

    function updateControls() {
        startBtn.classList.toggle('d-none', running);
        stopBtn.classList.toggle('d-none', !running);
        resetBtn.disabled = running || elapsedSecDisplay === -3;
    }

    // ========= リスト行の生成（テンプレート方式） =========
    function fillSelect(sel, max) {
        sel.innerHTML = '';
        for (let i = 0; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i).padStart(2, '0');
            sel.appendChild(opt);
        }
    }

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

    function attachRowHandlers(row) {
        const selSound = row.querySelector('.sound');
        const selMin = row.querySelector('.min');
        const selSec = row.querySelector('.sec');
        const btnDel = row.querySelector('.remove');

        const onChange = () => saveAlarms();
        selSound.addEventListener('change', onChange);
        selMin.addEventListener('change', onChange);
        selSec.addEventListener('change', onChange);

        btnDel.addEventListener('click', () => {
            row.remove();
            saveAlarms();
        });
    }

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

    // ========= localStorage 永続化 =========
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

    function saveAlarms() {
        try {
            const data = snapshotAlarms();
            localStorage.setItem(LS_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('saveAlarms failed:', e);
        }
    }

    function loadAlarms() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return null;
            return data;
        } catch {
            return null;
        }
    }

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

    // ========= アラームの“発火トリガー”収集（UI -> [{name, atSec}]）=========
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

    // ========= Audio 読み込み（同一 context で decode） =========
    async function ensureBuffer(name) {
        if (BUFFERS.has(name)) return BUFFERS.get(name);
        // SWキャッシュにヒットするので offline 前提でもOK
        const res = await fetch(toUrl(name), { cache: 'reload' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(arr);
        BUFFERS.set(name, buf);
        return buf;
    }

    // ========= 即時鳴動（start(0)） =========
    function playNow(name) {
        const buf = BUFFERS.get(name);
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        try { src.start(0); } catch (e) { console.warn('playNow failed:', name, e); }
        // 停止や排他は実装しない（方針通り）
    }

    // ========= 単一クロックに基づく now 秒（整数） =========
    function nowElapsedSec() {
        if (!audioCtx) return elapsedSecDisplay;
        const precise = (audioCtx.currentTime - audioStartSec) - pausedAccumSec; // 秒
        return Math.floor(startOffsetSec + precise);
    }

    // ========= 100ms表示・発火ループ =========
    function loop100ms(scheduleItems) {
        let prev = nowElapsedSec();

        // 内部ループ
        function onTick() {
            if (!running) return;

            const now = nowElapsedSec();

            // 表示更新（整数秒が進んだタイミングだけでもよいが、毎tickでも軽い）
            if (now !== elapsedSecDisplay) {
                elapsedSecDisplay = now;
                render();
                updateControls();
            }

            // 「prev < atSec ≤ now」を満たすイベントを即時発火
            if (now > prev && scheduleItems && scheduleItems.length) {
                for (const { name, atSec } of scheduleItems) {
                    if (atSec <= prev || atSec > now) continue;
                    const key = `${name}@${atSec}`;
                    if (firedSet.has(key)) continue; // 既に一度鳴っていればスキップ
                    playNow(name);
                    firedSet.add(key);
                }
            }

            prev = now;
        }

        // 100msごとに実行
        uiTimer = setInterval(onTick, 100);
    }

    // ========= 開始（Start） =========
    async function start() {
        if (running) return;
        running = true;
        updateControls();

        acquireWakeLock(); // 非同期試行

        // AudioContext をユーザー操作中に新規作成＆resume
        if (audioCtx) {
            try { await audioCtx.close(); } catch { }
        }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: 'interactive' // 小さめの出力バッファを選びやすい
        });
        try { await audioCtx.resume(); } catch { }

        // Start時点のオフセット（再開時は当時の値から続き）
        startOffsetSec = elapsedSecDisplay;
        pausedAccumSec = 0;
        audioStartSec = audioCtx.currentTime;

        // スケジュール生成＆必要音のdecode
        const triggers = collectAlarmTriggers(); // [{name, atSec}, ...]
        const uniqueNames = Array.from(new Set(triggers.map(t => t.name)));

        for (const name of uniqueNames) {
            try { await ensureBuffer(name); } catch (e) { console.warn('decode failed:', name, e); }
        }

        // 100msループ開始（表示＆境界即時発火）
        loop100ms(triggers);
    }

    // ========= 停止（Stop） =========
    function stop() {
        if (!running) return;

        clearInterval(uiTimer);
        uiTimer = null;

        running = false;
        updateControls();

        // Wake Lockは冪等解放
        releaseWakeLock();
        // ここでは elapsedSecDisplay は保持（再開で続きから）
        // firedSet は保持（過去を再発火させないため）
    }

    // ========= リセット =========
    function reset() {
        if (running) return;
        elapsedSecDisplay = -3;
        startOffsetSec = -3;
        pausedAccumSec = 0;
        // 「過去発火の再発防止」を解く（ゼロからやり直し）
        firedSet.clear();
        render();
        updateControls();
    }

    // ========= イベント =========
    addBtn.addEventListener('click', () => {
        createAlarmRow();
        saveAlarms();
    });
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // ===== Wake Lock デバッグ表示（右上・0.5sポーリング） =====
    (() => {
        const el = document.getElementById('wakelock-indicator');
        if (!el) return;
        const icon = el.querySelector('.bi');
        setInterval(() => {
            const active = !!(typeof wakeLock !== 'undefined' && wakeLock && !wakeLock.released);
            icon.className = active ? 'bi bi-lock' : 'bi bi-unlock';
        }, 500);
    })();

    // ========= 初期状態 =========
    restoreAlarmsOrDefault();
    render();
    updateControls();
})();
