(() => {
    'use strict';

    const timeEl = document.getElementById('time');
    const alarmsWrap = document.getElementById('alarms');
    const addBtn = document.getElementById('add-alarm');
    const toggleBtn = document.getElementById('toggle');
    const resetBtn = document.getElementById('reset');

    const SOUND_FILES = [
        'start.mp3',
        '警告1.mp3',
        '警告2.mp3',
        '警告3.mp3',
        '爆発1.mp3'
    ];

    const CONFIG = { DEFAULT_START: -3, TICK_MS: 1000 };
    const STORAGE_KEY = 'contesttimer.v1';

    const STATE = {
        elapsed: CONFIG.DEFAULT_START,
        running: false,
        starting: false,     // ← 連打/再入ガード
        timerId: null,
        fired: new Set(),
        canReset: false,
        alarms: []
    };

    // ===== Web Audio =====
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    const BUFFERS = new Map(); // url -> AudioBuffer

    async function decodeArrayBuffer(arrBuf) {
        // Safari 旧版対策：Promise/Callback両対応
        if (audioCtx.decodeAudioData.length === 1) {
            return await audioCtx.decodeAudioData(arrBuf);
        }
        return await new Promise((resolve, reject) => {
            audioCtx.decodeAudioData(arrBuf, resolve, reject);
        });
    }

    async function loadSound(url) {
        if (BUFFERS.has(url)) return BUFFERS.get(url);
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        const arrBuf = await res.arrayBuffer();
        const buf = await decodeArrayBuffer(arrBuf);
        BUFFERS.set(url, buf);
        return buf;
    }

    function playSound(url) {
        const buf = BUFFERS.get(url);
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        try { src.start(0); } catch { /* iOS一部で二重start回避 */ }
    }

    function formatMMSS(n) {
        const m = Math.floor(n / 60);
        const s = n % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function render() {
        timeEl.textContent = formatMMSS(STATE.elapsed);
    }

    function updateControls() {
        toggleBtn.textContent = STATE.running ? 'ストップ' : 'スタート';
        resetBtn.disabled = STATE.running || !STATE.canReset;
    }

    function getSelectedSoundUrls() {
        const set = new Set();
        for (const a of STATE.alarms) {
            if (a.sound.value) set.add(a.sound.value);
        }
        return Array.from(set);
    }

    // ===== UI生成 =====
    function makeNumberSelect(min, max) {
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-lg bg-black text-white border-secondary';
        for (let i = min; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i).padStart(2, '0');
            sel.appendChild(opt);
        }
        return sel;
    }

    function makeSoundSelect() {
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-lg bg-black text-white border-secondary';
        {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '（なし）';
            sel.appendChild(opt);
        }
        for (const f of SOUND_FILES) {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            sel.appendChild(opt);
        }
        return sel;
    }

    function createAlarmRow(init) {
        const row = document.createElement('div');
        row.className = 'row g-2 align-items-center mb-2';

        const colMin = document.createElement('div');
        colMin.className = 'col-4';
        const minSel = makeNumberSelect(0, 59);
        colMin.appendChild(minSel);

        const colSec = document.createElement('div');
        colSec.className = 'col-4';
        const secSel = makeNumberSelect(0, 59);
        colSec.appendChild(secSel);

        const colSound = document.createElement('div');
        colSound.className = 'col-4';
        const soundSel = makeSoundSelect();
        colSound.appendChild(soundSel);

        const colDel = document.createElement('div');
        colDel.className = 'col-12 mt-1';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-outline-danger w-100';
        delBtn.textContent = '削除';
        colDel.appendChild(delBtn);

        row.appendChild(colMin);
        row.appendChild(colSec);
        row.appendChild(colSound);
        row.appendChild(colDel);

        alarmsWrap.appendChild(row);

        const alarm = { root: row, min: minSel, sec: secSel, sound: soundSel, del: delBtn };
        STATE.alarms.push(alarm);

        // 初期値
        if (init) {
            minSel.value = String(init.m ?? 0);
            secSel.value = String(init.s ?? 0);
            soundSel.value = String(init.sound ?? '');
        }

        // 削除
        delBtn.addEventListener('click', () => {
            if (STATE.running) return;
            const idx = STATE.alarms.indexOf(alarm);
            if (idx >= 0) STATE.alarms.splice(idx, 1);
            try { alarmsWrap.removeChild(row); } catch { }
            STATE.fired.delete(alarm);
            saveAlarms();
        });

        // 変更時の保存＋事前デコード
        const onChange = async () => {
            saveAlarms();
            if (STATE.running && soundSel.value) {
                try { await loadSound(soundSel.value); } catch { }
            }
        };
        soundSel.addEventListener('change', onChange);
        minSel.addEventListener('change', saveAlarms);
        secSel.addEventListener('change', saveAlarms);
    }

    // ===== 発火チェック =====
    function checkAlarms(prev, curr) {
        for (const a of STATE.alarms) {
            if (a.sound.value === '') continue;
            const when = (+a.min.value * 60) + (+a.sec.value);
            // ★ 跨ぎ検知：prev < when <= curr のときだけ一度鳴らす
            if (prev < when && when <= curr && !STATE.fired.has(a)) {
                STATE.fired.add(a);
                // 事前ロード済みのはずだが、念のため存在しなければロードしてから再生
                if (!BUFFERS.has(a.sound.value)) {
                    loadSound(a.sound.value).then(() => playSound(a.sound.value)).catch(() => { });
                } else {
                    playSound(a.sound.value);
                }
            }
        }
    }

    // ===== 保存/復元 =====
    function saveAlarms() {
        try {
            const data = STATE.alarms.map(a => ({
                m: +a.min.value,
                s: +a.sec.value,
                sound: a.sound.value || '' // OFFは空
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { }
    }

    function loadAlarms() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const list = JSON.parse(raw);
            if (!Array.isArray(list)) return false;

            STATE.alarms.length = 0;
            alarmsWrap.innerHTML = '';

            for (const it of list) {
                createAlarmRow(it);
            }
            return true;
        } catch {
            return false;
        }
    }

    // ===== タイマー =====
    async function start() {
        if (STATE.running || STATE.starting) return;
        STATE.starting = true;
        updateControls();

        // iOS Safari：ユーザー操作直後に resume が必須
        if (audioCtx.state === 'suspended') {
            try {
                await audioCtx.resume();
            } catch { }
        }

        // 鳴る可能性のある音を事前デコード（無音。誤爆しない）
        const urls = getSelectedSoundUrls();
        try {
            await Promise.allSettled(urls.map(loadSound));
        } catch {
            // 失敗しても後段で再挑戦される
        }

        // 起動確定
        STATE.running = true;
        STATE.starting = false;
        updateControls();
        STATE.timerId = setInterval(tick, CONFIG.TICK_MS);
    }

    function stop() {
        if (STATE.timerId) clearInterval(STATE.timerId);
        STATE.timerId = null;
        STATE.running = false;
        STATE.canReset = true;
        updateControls();
    }

    function reset() {
        if (STATE.running) return;
        // WebAudio は one-shot なので停める対象はなし。状態のみリセット
        STATE.elapsed = CONFIG.DEFAULT_START;
        STATE.fired.clear();
        STATE.canReset = false;
        render();
        updateControls();
    }

    function tick() {
        const prev = STATE.elapsed;
        STATE.elapsed = prev + 1;
        render();
        checkAlarms(prev, STATE.elapsed);
    }

    // ===== イベント =====
    addBtn.addEventListener('click', () => {
        createAlarmRow();
        saveAlarms();
    });

    toggleBtn.addEventListener('click', () => (STATE.running ? stop() : start()));
    resetBtn.addEventListener('click', reset);

    // ===== 初期化 =====
    render();
    updateControls();
    if (!loadAlarms()) createAlarmRow();
})();
