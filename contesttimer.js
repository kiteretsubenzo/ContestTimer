(() => {
    'use strict';

    // ===== 要素参照 =====
    const timeEl = document.getElementById('time');
    const alarmsWrap = document.getElementById('alarms');
    const addBtn = document.getElementById('add-alarm');
    const toggleBtn = document.getElementById('toggle');
    const resetBtn = document.getElementById('reset');

    // ===== 音源（sounds/ 配下のファイル名を列挙）=====
    // フォルダに追加したら、この配列だけ増やせばUIに反映されます。
    const SOUND_FILES = [
        'start.mp3',
        '警告1.mp3',
        '警告2.mp3',
        '警告3.mp3',
        '爆発1.mp3'
    ];

    // （任意）0秒で鳴らす音。不要なら null のままにしてください。
    const A0_DEFAULT_SRC = null; // 例: 'sounds/start.mp3'

    // ===== 内部状態 =====
    const CONFIG = { DEFAULT_START: -3, TICK_MS: 1000 };
    const STORAGE_KEY = 'contesttimer.v1'; // localStorageのキー

    const STATE = {
        elapsed: CONFIG.DEFAULT_START,
        running: false,
        timerId: null,
        fired: new Set(),     // 同一秒の多重発火防止用
        canReset: false,
        alarms: []            // { el, min, sec, sound }
    };

    // ===== Audioキャッシュ =====
    const AUDIO_CACHE = new Map();
    function getAudio(src) {
        if (!AUDIO_CACHE.has(src)) {
            const a = new Audio();
            a.preload = 'auto';
            a.src = src;
            AUDIO_CACHE.set(src, a);
        }
        return AUDIO_CACHE.get(src);
    }

    // ===== ユーティリティ =====
    function fmtSigned(sec) {
        const sign = sec < 0 ? '-' : '';
        const a = Math.abs(sec);
        const m = Math.floor(a / 60), s = a % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    function render() { timeEl.textContent = fmtSigned(STATE.elapsed); }

    function updateControls() {
        resetBtn.disabled = STATE.running || !STATE.canReset;
        toggleBtn.classList.toggle('running', STATE.running); // CSSで文字切替
    }

    // ===== タイマー制御 =====
    function start() {
        if (STATE.running) return;
        STATE.running = true;
        updateControls();
        // 0秒で鳴らす（任意）
        if (A0_DEFAULT_SRC && STATE.elapsed === 0 && !STATE.fired.has('a0')) {
            STATE.fired.add('a0');
            const a = getAudio(A0_DEFAULT_SRC);
            try { a.currentTime = 0; a.play(); } catch (_) { }
        }
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

    // ===== セレクト生成 =====
    function makeNumberSelect(min, max) {
        const sel = document.createElement('select');
        for (let i = min; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = String(i).padStart(2, '0');
            sel.appendChild(opt);
        }
        return sel;
    }

    // ===== アラーム行を追加（既定値オプション） =====
    function createAlarmRow(init = { m: 0, s: 0, sound: '' }) {
        const row = document.createElement('div');
        row.className = 'alarm-row row';

        // 分・秒
        const minSel = makeNumberSelect(0, 5);
        const secSel = makeNumberSelect(0, 59);

        // 音選択（先頭はOFF）
        const soundSel = document.createElement('select');
        const off = document.createElement('option');
        off.value = ''; off.textContent = 'OFF';
        soundSel.appendChild(off);
        SOUND_FILES.forEach(f => {
            const opt = document.createElement('option');
            opt.value = `sounds/${f}`;
            opt.textContent = f;
            soundSel.appendChild(opt);
        });

        // OFF時は分・秒を無効化
        const applyDisable = () => {
            const isOff = soundSel.value === '';
            minSel.disabled = isOff;
            secSel.disabled = isOff;
        };

        // 削除ボタン
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '−';
        removeBtn.className = 'remove';
        removeBtn.addEventListener('click', () => {
            alarmsWrap.removeChild(row);
            STATE.alarms = STATE.alarms.filter(a => a.el !== row);
            saveAlarms();
        });

        // 行の組み立て
        row.append('アラーム：', minSel, '分', secSel, '秒 ／ 音：', soundSel, removeBtn);
        alarmsWrap.appendChild(row);

        // 状態に追加
        const alarm = { el: row, min: minSel, sec: secSel, sound: soundSel };
        STATE.alarms.push(alarm);

        // 初期値の適用＆disable反映
        minSel.value = String(init.m ?? 0);
        secSel.value = String(init.s ?? 0);
        soundSel.value = init.sound ?? '';
        applyDisable();

        // 変更時に保存
        soundSel.addEventListener('change', () => { applyDisable(); saveAlarms(); });
        minSel.addEventListener('change', saveAlarms);
        secSel.addEventListener('change', saveAlarms);
    }

    // ===== 発火チェック =====
    function checkAlarms() {
        // 各行ごとに判定：OFFでなければ（soundに値があれば）時間一致で再生
        for (const a of STATE.alarms) {
            const isOff = a.sound.value === '';
            if (isOff) continue;
            const when = (+a.min.value * 60) + (+a.sec.value);
            if (STATE.elapsed === when && !STATE.fired.has(a)) {
                STATE.fired.add(a);
                const audio = getAudio(a.sound.value);
                try { audio.currentTime = 0; audio.play(); } catch (_) { }
            }
        }
    }

    // ===== 保存 / 復元 =====
    function saveAlarms() {
        try {
            const data = STATE.alarms.map(a => ({
                m: +a.min.value,
                s: +a.sec.value,
                sound: a.sound.value || ''   // OFFは空
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (_) { /* ignore */ }
    }

    function loadAlarms() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const list = JSON.parse(raw);
            if (!Array.isArray(list)) return false;

            // 既存クリア
            STATE.alarms.length = 0;
            alarmsWrap.innerHTML = '';

            // 復元
            for (const item of list) {
                const m = Number(item?.m) || 0;
                const s = Number(item?.s) || 0;
                const snd = typeof item?.sound === 'string' ? item.sound : '';
                createAlarmRow({ m, s, sound: snd });
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    // ===== イベント =====
    addBtn.addEventListener('click', () => { createAlarmRow(); saveAlarms(); });
    toggleBtn.addEventListener('click', () => (STATE.running ? stop() : start()));
    resetBtn.addEventListener('click', reset);

    // ===== 初期化 =====
    render();
    updateControls();
    if (!loadAlarms()) createAlarmRow(); // 復元できなければ1行だけ用意
})();
