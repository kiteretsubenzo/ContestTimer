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
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`fetch failed: ${url}`);
        const arr = await res.arrayBuffer();
        const buf = await decodeArrayBuffer(arr);
        BUFFERS.set(url, buf);
        return buf;
    }

    function playSound(url) {
        const buf = BUFFERS.get(url);
        if (!buf) return; // 未ロード（理論上ここは通らない想定）
        // 毎回新しい source を作る（WebAudioの原則）
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        try { src.start(0); } catch { }
    }

    // 現在のアラーム設定から、OFF以外のユニークURLを抽出
    function getSelectedSoundUrls() {
        return Array.from(new Set(
            STATE.alarms
                .map(a => a.sound?.value)
                .filter(v => typeof v === 'string' && v.length > 0)
        ));
    }

    // ===== 表示/制御 =====
    function fmtSigned(sec) {
        const s = sec < 0 ? '-' : '';
        const a = Math.abs(sec);
        const m = Math.floor(a / 60), t = a % 60;
        return `${s}${String(m).padStart(2, '0')}:${String(t).padStart(2, '0')}`;
    }
    function render() {
        timeEl.textContent = fmtSigned(STATE.elapsed);
    }
    function updateControls() {
        resetBtn.disabled = STATE.running || !STATE.canReset;
        toggleBtn.classList.toggle('running', STATE.running);
        toggleBtn.disabled = STATE.starting; // 起動中は押せない
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
        STATE.elapsed += 1;
        render();
        checkAlarms();
    }

    // ===== UI生成 =====
    function makeNumberSelect(min, max) {
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-lg d-inline-block w-auto';
        for (let i = min; i <= max; i++) {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = String(i).padStart(2, '0');
            sel.appendChild(o);
        }
        return sel;
    }

    // 「音 → 分・秒」順、ラベル文字なし（分・秒のみ小ラベル）
    function createAlarmRow(init = { m: 0, s: 0, sound: '' }) {
        const row = document.createElement('div');
        row.className = 'alarm-row d-flex flex-wrap align-items-center gap-2';

        // 音セレクト（先頭 OFF）
        const soundSel = document.createElement('select');
        soundSel.className = 'form-select form-select-lg sound d-inline-block w-auto';
        const off = document.createElement('option'); off.value = ''; off.textContent = 'OFF';
        soundSel.appendChild(off);
        SOUND_FILES.forEach(f => {
            const o = document.createElement('option');
            o.value = `sounds/${f}`;   // ※ASCII対応は現状不要の要望に合わせそのまま
            o.textContent = f;
            soundSel.appendChild(o);
        });

        // 分・秒
        const minSel = makeNumberSelect(0, 5);
        const secSel = makeNumberSelect(0, 59);

        const applyDisable = () => {
            const isOff = soundSel.value === '';
            minSel.disabled = isOff;
            secSel.disabled = isOff;
        };

        // 削除
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '−';
        removeBtn.className = 'remove btn btn-outline-danger btn-lg';
        removeBtn.addEventListener('click', () => {
            alarmsWrap.removeChild(row);
            STATE.alarms = STATE.alarms.filter(a => a.el !== row);
            saveAlarms();
        });

        // 「音 → 分 → '分' → 秒 → '秒' → 削除」
        const labelMin = document.createElement('span');
        labelMin.textContent = '分';
        labelMin.className = 'text-secondary';

        const labelSec = document.createElement('span');
        labelSec.textContent = '秒';
        labelSec.className = 'text-secondary';

        row.append(soundSel, minSel, labelMin, secSel, labelSec, removeBtn);
        alarmsWrap.appendChild(row);

        const alarm = {
            el: row,
            min: minSel,
            sec: secSel,
            sound: soundSel
        };
        STATE.alarms.push(alarm);

        // 初期値
        minSel.value = String(init.m ?? 0);
        secSel.value = String(init.s ?? 0);
        soundSel.value = init.sound ?? '';
        applyDisable();

        // 変更で保存（音変更時は将来の再生に備えて事前ロードも可能）
        const onChange = async () => {
            applyDisable();
            saveAlarms();
            // running中に新しい音を選んだ場合でも、鳴る前にロードしておくと安心
            if (STATE.running && soundSel.value) {
                try { await loadSound(soundSel.value); } catch { }
            }
        };
        soundSel.addEventListener('change', onChange);
        minSel.addEventListener('change', saveAlarms);
        secSel.addEventListener('change', saveAlarms);
    }

    // ===== 発火チェック =====
    function checkAlarms() {
        for (const a of STATE.alarms) {
            if (a.sound.value === '') continue;
            const when = (+a.min.value * 60) + (+a.sec.value);
            if (STATE.elapsed === when && !STATE.fired.has(a)) {
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
                const m = Number(it?.m) || 0;
                const s = Number(it?.s) || 0;
                const snd = typeof it?.sound === 'string' ? it.sound : '';
                createAlarmRow({ m, s, sound: snd });
            }
            return true;
        } catch { return false; }
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
