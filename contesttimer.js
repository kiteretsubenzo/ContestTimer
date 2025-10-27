(() => {
    'use strict';

    const timeEl = document.getElementById('time');
    const alarmsContainer = document.getElementById('alarms');
    const addBtn = document.getElementById('add-alarm');
    const toggleBtn = document.getElementById('toggle');
    const resetBtn = document.getElementById('reset');

    const SOUND_FILES = ['start.mp3', 'alert.mp3', 'end.mp3'];
    const SOUND_PATHS = SOUND_FILES.map(f => `sounds/${f}`);
    const AUDIO_CACHE = new Map();

    const CONFIG = { DEFAULT_START: -3, TICK_MS: 1000 };
    const STATE = {
        elapsed: CONFIG.DEFAULT_START,
        running: false,
        timerId: null,
        fired: new Set(),
        canReset: false,
        alarms: [] // {el, min, sec, sound}
    };

    function getAudio(src) {
        if (!AUDIO_CACHE.has(src)) {
            const a = new Audio(src);
            a.preload = 'auto';
            AUDIO_CACHE.set(src, a);
        }
        return AUDIO_CACHE.get(src);
    }

    function fmtSigned(sec) {
        const sign = sec < 0 ? '-' : '';
        const a = Math.abs(sec);
        const m = Math.floor(a / 60), s = a % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function render() { timeEl.textContent = fmtSigned(STATE.elapsed); }
    function updateControls() {
        resetBtn.disabled = STATE.running || !STATE.canReset;
        toggleBtn.classList.toggle('running', STATE.running);
    }

    function start() {
        if (STATE.running) return;
        STATE.running = true;
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
        STATE.elapsed = CONFIG.DEFAULT_START;
        STATE.fired.clear();
        STATE.canReset = false;
        render(); updateControls();
    }

    function tick() {
        STATE.elapsed++;
        render();
        checkAlarms();
    }

    // ===== アラーム関連 =====
    function createAlarmRow() {
        const row = document.createElement('div');
        row.className = 'alarm-row row';

        // 時間選択
        const minSel = makeSelect(0, 5);
        const secSel = makeSelect(0, 59);

        // 音選択
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

        // 無効化制御
        const applyDisable = () => {
            const isOff = soundSel.value === '';
            minSel.disabled = isOff;
            secSel.disabled = isOff;
        };
        soundSel.addEventListener('change', applyDisable);
        applyDisable();

        // 削除ボタン
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '−';
        removeBtn.className = 'remove';
        removeBtn.addEventListener('click', () => {
            alarmsContainer.removeChild(row);
            STATE.alarms = STATE.alarms.filter(a => a.el !== row);
        });

        // 組み立て
        row.append(minSel, '分', secSel, '秒：', soundSel, removeBtn);
        alarmsContainer.appendChild(row);

        const alarm = { el: row, min: minSel, sec: secSel, sound: soundSel };
        STATE.alarms.push(alarm);
    }

    function makeSelect(min, max) {
        const sel = document.createElement('select');
        for (let i = min; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = String(i).padStart(2, '0');
            sel.appendChild(opt);
        }
        return sel;
    }

    function checkAlarms() {
        for (const a of STATE.alarms) {
            const sec = a.sound.value ? (+a.min.value * 60 + +a.sec.value) : null;
            if (sec === null) continue;
            if (STATE.elapsed === sec && !STATE.fired.has(a)) {
                STATE.fired.add(a);
                const audio = getAudio(a.sound.value);
                audio.currentTime = 0;
                audio.play();
            }
        }
    }

    // ===== イベント =====
    addBtn.addEventListener('click', createAlarmRow);
    toggleBtn.addEventListener('click', () => STATE.running ? stop() : start());
    resetBtn.addEventListener('click', reset);

    // ===== 初期表示 =====
    render();
    updateControls();
    createAlarmRow(); // デフォルト1つ
})();
