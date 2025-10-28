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
            opt.value = name;      // 拡張子なし
            opt.textContent = name; // 表示も拡張子なし
            sel.appendChild(opt);
        }
        if (NAMES.length > 0) sel.value = NAMES[0];
    }

    function createAlarmRow() {
        const clone = template.cloneNode(true);
        clone.style.display = '';
        clone.id = '';

        const selSound = clone.querySelector('.sound');
        const selMin = clone.querySelector('.min');
        const selSec = clone.querySelector('.sec');
        const btnDel = clone.querySelector('.remove');

        fillSoundSelect(selSound);
        fillSelect(selMin, 20);
        fillSelect(selSec, 59);

        btnDel.addEventListener('click', () => clone.remove());
        alarmsWrap.appendChild(clone);

        return clone;
    }

    // ========= スケジュール収集 =========
    // 返り値: [{name, atSec}]  ※ atSec は 0:00 からの秒（例: 90 = 1分30秒）
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

            const atSec = min * 60 + sec; // 0:00基準
            result.push({ name, atSec });
        });

        // 時間順にソート（同時刻複数はそのまま並列再生）
        result.sort((a, b) => a.atSec - b.atSec);
        return result;
    }

    // ========= Audio 読み込み（AudioContext 作成後に同一 context で decode） =========
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
            src.start(absTime); // ← AudioContext の絶対時刻で予約
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

        // 1) AudioContext をユーザー操作中に新規作成 & resume（iPhone安定の要）
        if (audioCtx) {
            try { await audioCtx.close(); } catch { }
        }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        try { await audioCtx.resume(); } catch { }

        // 2) リストからスケジュール生成
        const items = collectScheduleFromList(); // [{name, atSec}, ...]
        // -3 → 0 までの3秒オフセットを足して予約（表示が -00:03 から始まるため）
        const now = audioCtx.currentTime;

        // 3) 必要な音を decode（同一Context）→ 4) 絶対時刻で予約
        //    同名は1回だけ decode
        const uniqueNames = Array.from(new Set(items.map(x => x.name)));
        for (const name of uniqueNames) {
            try { await ensureBuffer(name); } catch (e) { console.warn('decode failed:', name, e); }
        }

        scheduled = [];
        for (const { name, atSec } of items) {
            if (!BUFFERS.has(name)) continue;
            // 再スタート対応：今の elapsed から見て未来だけ予約
            const delay = atSec - elapsed;   // 残り秒数（初回は atSec - (-3) = atSec + 3）
            if (delay > 0.02) {              // しきい値（20ms）より未来だけ
                const when = now + delay;
                schedulePlayAt(name, when);
            }
        }

        // 5) UIタイマー開始（音はスケジューラ任せ）
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
    addBtn.addEventListener('click', createAlarmRow);
    startBtn.addEventListener('click', start);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', reset);

    // ========= 初期状態 =========
    render();
    updateControls();
})();
