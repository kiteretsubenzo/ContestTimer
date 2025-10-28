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
    const NAMES = window.SOUND_FILES || [];  // 例: ['start','警告1','警告2',...]
    const toUrl = (name) => `sounds/${name}.mp3`; // 日本語名そのまま
    const LS_KEY = 'contesttimer.alarms.v1';       // ← 保存キー

    // ========= 状態 =========
    let running = false;
    let elapsed = -3;  // 表示用（-3 → 0 → ...）
    let prev = -3;
    let uiTimer = null;

    // Web Audio
    let audioCtx = null;
    const BUFFERS = new Map(); // name -> AudioBuffer（このcontextでdecode済み）
    let scheduled = [];        // [{src, name, at}]

    // ========= ユーティリティ =========
    const fmt = (n) => {
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    function render() {
        timeEl.textContent = fmt(elapsed);
    }

    function updateControls() {
        startBtn.classList.toggle('d-none', running);
        stopBtn.classList.toggle('d-none', !running);
        resetBtn.disabled = running || elapsed === -3;
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
            opt.value = name;       // 拡張子なし
            opt.textContent = name; // 表示も拡張子なし
            sel.appendChild(opt);
        }
        if (NAMES.length > 0) sel.value = NAMES[0];
    }

    // 追加：行のイベントをひとまとめに付与（変更→保存）
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

    // values: {name, min, sec} を指定すると初期値セット
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
            // 復元
            for (const it of data) {
                // name が現在の SOUND_FILES に無い場合はスキップ
                if (!NAMES.includes(it.name)) continue;
                const min = Math.min(20, Math.max(0, Number(it.min || 0)));
                const sec = Math.min(59, Math.max(0, Number(it.sec || 0)));
                createAlarmRow({ name: it.name, min, sec });
            }
        } else {
            // 初期状態：行がないなら1行だけ用意
            createAlarmRow({ name: NAMES[0] || '', min: 0, sec: 10 });
        }
    }

    // ========= スケジュール収集（予約用） =========
    // 返り値: [{name, atSec}]
    function collectScheduleFromList() {
        const result = [];
        alarmsWrap.querySelectorAll('.alarm-row').forEach(row => {
            const selSound = row.querySelector('.sound');
            const selMin = row.querySelector('.min');
            const selSec = row.querySelector('.sec');
            if (!selSound || !selMin || !selSec) return;

            const name = selSound.value;
            const min = parseInt(selMin.value || '0', 10);
            const sec = parseInt(selSec.value || '0', 10);
            if (!name || Number.isNaN(min) || Number.isNaN(sec)) return;

            result.push({ name, atSec: min * 60 + sec });
        });
        result.sort((a, b) => a.atSec - b.atSec);
        return result;
    }

    // ========= Audio 読み込み（AudioContext 作成後・同一 context で decode） =========
    async function ensureBuffer(name) {
        if (BUFFERS.has(name)) return BUFFERS.get(name);
        const res = await fetch(toUrl(name), { cache: 'reload' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await audioCtx.decodeAudioData(arr);
        BUFFERS.set(name, buf);
        return buf;
    }

    // ========= 絶対時刻で予約再生 =========
    function schedulePlayAt(name, absTime) {
        const buf = BUFFERS.get(name);
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        try {
            src.start(absTime);
            scheduled.push({ src, name, at: absTime });
        } catch (e) {
            console.warn('schedulePlayAt failed:', name, e);
        }
    }

    // ========= タイマー（UI表示のみ） =========
    function tick() {
        prev = elapsed;
        elapsed += 1;
        render();
    }

    // ========= 開始 =========
    async function start() {
        if (running) return;
        running = true;
        updateControls();

        // AudioContext をユーザー操作中に新規作成 & resume
        if (audioCtx) {
            try { await audioCtx.close(); } catch { }
        }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        try { await audioCtx.resume(); } catch { }

        // リストからスケジュールを取得
        const items = collectScheduleFromList(); // [{name, atSec}, ...]
        const now = audioCtx.currentTime;

        // 必要な音を decode
        const uniqueNames = Array.from(new Set(items.map(x => x.name)));
        for (const name of uniqueNames) {
            try { await ensureBuffer(name); } catch (e) { console.warn('decode failed:', name, e); }
        }

        // 予約：再スタートにも対応（elapsed を基準に未来だけ予約）
        scheduled = [];
        for (const { name, atSec } of items) {
            if (!BUFFERS.has(name)) continue;
            const delay = atSec - elapsed;      // 残り秒数（初回は atSec - (-3) = atSec + 3）
            if (delay > 0.02) {
                const when = now + delay;
                schedulePlayAt(name, when);
            }
        }

        // UIタイマー開始（表示のみ）
        prev = elapsed;
        uiTimer = setInterval(tick, 1000);
    }

    // ========= 停止 =========
    function stop() {
        if (!running) return;

        clearInterval(uiTimer);
        uiTimer = null;

        try {
            for (const s of scheduled) {
                s.src.stop(0);
            }
        } catch { }
        scheduled = [];

        running = false;
        updateControls();
    }

    // ========= リセット =========
    function reset() {
        if (running) return;
        elapsed = -3;
        prev = -3;
        render();
        updateControls();
    }

    // ========= イベント =========
    addBtn.addEventListener('click', () => {
        createAlarmRow();
        saveAlarms(); // 追加直後に保存
    });
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // ========= 初期状態 =========
    restoreAlarmsOrDefault(); // ← 復元（無ければ1行）
    render();
    updateControls();
})();
