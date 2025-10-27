(() => {
    'use strict';

    // ===== 参照 =====
    const timeEl = document.getElementById('time');
    const toggleBtn = document.getElementById('toggle');   // 追加
    const resetBtn = document.getElementById('reset');
    const a1m = document.getElementById('a1m');
    const a1s = document.getElementById('a1s');
    const a2m = document.getElementById('a2m');
    const a2s = document.getElementById('a2s');

    // ===== 短いビープ3種類（MP3 base64埋め込み） =====
    const BEEP_SOURCES = [
        'sounds/start.mp3',
        'sounds/alert.mp3',
        'sounds/end.mp3'
    ];

    // ===== MP3配列をAudioにマップ（遅延初期化） =====
    const BEEPS = BEEP_SOURCES.map(() => new Audio());
    let BEEPS_READY = false;
    const MP3_MIME = 'audio/mpeg';

    // ===== 設定 & 状態 =====
    const CONFIG = Object.freeze({
        DEFAULT_START: -3,
        TICK_MS: 1000
    });

    const STATE = {
        elapsed: CONFIG.DEFAULT_START,
        running: false,
        timerId: null,
        fired: new Set(),
        canReset: false,        // ← 追加：Reset を押せるかどうか
    };

    // ===== 表示 =====
    function fmtSigned(sec) {
        const sign = sec < 0 ? '-' : '';
        const a = Math.abs(sec);
        const m = Math.floor(a / 60), s = a % 60;
        return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    function render() { timeEl.textContent = fmtSigned(STATE.elapsed); }

    // ===== コントロール状態 =====
    function updateControls() {
        // 動作中は押せない／停止中でも canReset が true のときだけ押せる
        resetBtn.disabled = STATE.running || !STATE.canReset;

        // トグルの見た目（CSSでテキスト切り替え）
        toggleBtn.classList.toggle('running', STATE.running);
    }

    // ===== トグル動作 =====
    function toggle() {
        if (STATE.running) stop();
        else start();
    }

    // ===== 発火（キー＋音インデックス） =====
    function fireAt(key, soundIndex) {
        if (STATE.fired.has(key)) return;
        STATE.fired.add(key);
        playBeep(soundIndex);
    }

    function checkBeep() {
        const [A0, A1, A2] = getAlarms();
        switch (STATE.elapsed) {
            case A0:
                fireAt('a0', 0);
                break;
            case A1:
                fireAt('a1', 1);
                break;
            case A2:
                fireAt('a2', 2);
                break;
            default:
                break;
        }
    }

    // ===== タイマー =====
    function tick() {
        STATE.elapsed += 1; // カウントアップ
        render();
        checkBeep();
    }

    function start() {
        ensureBeeps();
        if (STATE.running) return;
        STATE.running = true;
        // 動作を始めた瞬間は Reset 不可のまま
        // STATE.canReset はここでは触らない（falseのまま）
        updateControls();
        checkBeep();
        STATE.timerId = setInterval(tick, CONFIG.TICK_MS);
    }

    function stop() {
        if (STATE.timerId) {
            clearInterval(STATE.timerId);
            STATE.timerId = null;
        }
        STATE.running = false;
        STATE.canReset = true;     // ← 停止したので Reset を有効化
        updateControls();
    }

    function reset() {
        if (STATE.running) return; // 停止中のみリセットできる
        STATE.elapsed = CONFIG.DEFAULT_START;
        STATE.fired.clear();
        STATE.canReset = false;    // ← Reset を押したら無効化に戻す
        render();
        updateControls();
    }

    function fillSelect(sel, max) {
        for (let i = 0; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = String(i).padStart(2, '0');
            sel.appendChild(opt);
        }
    }

    // ===== 入力 -> 秒（A0/A1/A2 を返す）=====
    // A0: 0秒（固定） / A1: 第1アラーム / A2: 第2アラーム
    function getAlarms() {
        const n = (m, s) => m * 60 + s;
        const A0 = 0;
        const A1 = n(+a1m.value, +a1s.value);
        const A2 = n(+a2m.value, +a2s.value);
        return [A0, A1, A2];
    }

    // ===== 音声処理 =====
    // MP3配列をAudioにマップ（遅延初期化）
    function ensureBeeps() {
        if (BEEPS_READY) return;
        for (let i = 0; i < BEEPS.length; i++) {
            const a = BEEPS[i];
            a.preload = 'auto';
            a.src = BEEP_SOURCES[i];               // ← ここが相対パス
            a.load();
            // 任意のサポート確認
            if (typeof a.canPlayType === 'function' && !a.canPlayType(MP3_MIME)) {
                console.warn('MP3 may not be supported');
            }
        }
        BEEPS_READY = true;
    }

    // 整数インデックス指定でビープ再生（0=高音,1=中音,2=低音）
    function playBeep(index) {
        if (!BEEPS_READY) return;
        const a = BEEPS[index];
        if (!a) return;
        try { a.currentTime = 0; a.play(); } catch (_) { }
    }

    // ===== プルダウンの選択肢 =====
    fillSelect(a1m, 5);   // 分（0〜5）
    fillSelect(a2m, 5);
    fillSelect(a1s, 59);  // 秒（0〜59）
    fillSelect(a2s, 59);

    // ===== 初期化 =====
    render();
    updateControls();

    // ===== イベント =====
    toggleBtn.classList.toggle('running', STATE.running);
    toggleBtn.addEventListener('click', toggle);
    resetBtn.addEventListener('click', reset);
})();
