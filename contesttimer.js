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
        starting: false,
        timerId: null,
        fired: new Set(),
        canReset: false,
        alarms: []
    };

    const AUDIO_CACHE = new Map();
    function getAudio(src) {
        if (!AUDIO_CACHE.has(src)) {
            const a = new Audio();
            a.preload = 'auto';
            a.playsInline = true; // iOSでのインライン再生
            a.src = src;
            AUDIO_CACHE.set(src, a);
        }
        return AUDIO_CACHE.get(src);
    }

     // スタート押下時に、選択中サウンドを事前ロード＆解除
 async function primeSelectedSounds() {
    // 現在のリストから、OFF以外のURLをユニークに抽出
   const urls = Array.from(new Set(
     STATE.alarms
       .map(a => a.sound?.value)
      .filter(v => typeof v === 'string' && v.length > 0)
   ));
   // 何もなければ何もしない
   if (urls.length === 0) return;

  // 各音源を load → muted再生→停止 で “再生権限” を掴む
  await Promise.allSettled(urls.map(async (u) => {
     const a = getAudio(u);
     try {
       a.preload = 'auto';
       a.load(); // ネットワーク開始（即時に完了しなくてOK）
        const prevMuted = a.muted;
       const prevTime  = a.currentTime;
       a.muted = true;
       a.currentTime = 0;
       await a.play().catch(() => {}); // iOSはユーザー操作直後なので許可される
       a.pause();
       a.muted = prevMuted;
      a.currentTime = prevTime;
     } catch (_) {
       // 失敗しても致命ではない（後段の本再生で再挑戦）
     }
  }));
 }
    
    function fmtSigned(sec) {
        const s = sec < 0 ? '-' : ''; const a = Math.abs(sec);
        const m = Math.floor(a / 60), t = a % 60; return `${s}${String(m).padStart(2, '0')}:${String(t).padStart(2, '0')}`;
    }
    function render() { timeEl.textContent = fmtSigned(STATE.elapsed); }
    function updateControls() {
   resetBtn.disabled = STATE.running || !STATE.canReset;
   toggleBtn.classList.toggle('running', STATE.running);
   // スタート処理中はトグルを一時的に押せないようにする（再入防止の保険）
   toggleBtn.disabled = STATE.starting;
 }

    function start() {
        if (STATE.running || STATE.starting) return; // ← 連打・再入ガード
   STATE.starting = true;
   updateControls();
   // ユーザー操作直後に音をプライム
   primeSelectedSounds().finally(() => {
     // 念のため二重起動の保険
     if (STATE.running) { STATE.starting = false; updateControls(); return; }
      STATE.running = true;
     STATE.starting = false;
     updateControls();
     STATE.timerId = setInterval(tick, CONFIG.TICK_MS);
   });
    }
    function stop() { if (STATE.timerId) clearInterval(STATE.timerId); STATE.timerId = null; STATE.running = false; STATE.canReset = true; updateControls(); }
    function reset() { if (STATE.running) return; STATE.elapsed = CONFIG.DEFAULT_START; STATE.fired.clear(); STATE.canReset = false; render(); updateControls(); }
    function tick() { STATE.elapsed += 1; render(); checkAlarms(); }

    function makeNumberSelect(min, max) {
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-lg d-inline-block w-auto';
        for (let i = min; i <= max; i++) { const o = document.createElement('option'); o.value = i; o.textContent = String(i).padStart(2, '0'); sel.appendChild(o); }
        return sel;
    }

    // ★ 「音 → アラーム（分・秒）」の順で生成。ラベル文字は付けない
    function createAlarmRow(init = { m: 0, s: 0, sound: '' }) {
        const row = document.createElement('div');
        row.className = 'alarm-row d-flex flex-wrap align-items-center gap-2';

        // 音セレクト（先頭 OFF）
        const soundSel = document.createElement('select');
        soundSel.className = 'form-select form-select-lg sound d-inline-block w-auto';
        const off = document.createElement('option'); off.value = ''; off.textContent = 'OFF'; soundSel.appendChild(off);
        SOUND_FILES.forEach(f => { const o = document.createElement('option'); o.value = `sounds/${f}`; o.textContent = f; soundSel.appendChild(o); });

        // 分・秒
        const minSel = makeNumberSelect(0, 5);
        const secSel = makeNumberSelect(0, 59);

        // OFF時は分秒を無効化
        const applyDisable = () => { const isOff = soundSel.value === ''; minSel.disabled = isOff; secSel.disabled = isOff; };

        // 削除ボタン
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button'; removeBtn.textContent = '−'; removeBtn.className = 'remove btn btn-outline-danger btn-lg';
        removeBtn.addEventListener('click', () => { alarmsWrap.removeChild(row); STATE.alarms = STATE.alarms.filter(a => a.el !== row); saveAlarms(); });

        // 並べ方：音 → 分 → 「分」テキスト → 秒 → 「秒」テキスト → 削除
        const labelMin = document.createElement('span'); labelMin.textContent = '分'; labelMin.className = 'text-secondary';
        const labelSec = document.createElement('span'); labelSec.textContent = '秒'; labelSec.className = 'text-secondary';

        row.append(soundSel, minSel, labelMin, secSel, labelSec, removeBtn);
        alarmsWrap.appendChild(row);

        const alarm = { el: row, min: minSel, sec: secSel, sound: soundSel };
        STATE.alarms.push(alarm);

        // 初期値
        minSel.value = String(init.m ?? 0);
        secSel.value = String(init.s ?? 0);
        soundSel.value = init.sound ?? '';
        applyDisable();

        // 変更で保存
        const onChange = () => { applyDisable(); saveAlarms(); };
        soundSel.addEventListener('change', onChange);
        minSel.addEventListener('change', saveAlarms);
        secSel.addEventListener('change', saveAlarms);
    }

    function checkAlarms() {
        for (const a of STATE.alarms) {
            if (a.sound.value === '') continue;
            const when = (+a.min.value * 60) + (+a.sec.value);
            if (STATE.elapsed === when && !STATE.fired.has(a)) {
                STATE.fired.add(a);
                const audio = getAudio(a.sound.value); try { audio.currentTime = 0; audio.play(); } catch { }
            }
        }
    }

    function saveAlarms() {
        try {
            const data = STATE.alarms.map(a => ({ m: +a.min.value, s: +a.sec.value, sound: a.sound.value || '' }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { }
    }
    function loadAlarms() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return false;
            const list = JSON.parse(raw); if (!Array.isArray(list)) return false;
            STATE.alarms.length = 0; alarmsWrap.innerHTML = '';
            for (const it of list) { const m = Number(it?.m) || 0; const s = Number(it?.s) || 0; const snd = typeof it?.sound === 'string' ? it.sound : ''; createAlarmRow({ m, s, sound: snd }); }
            return true;
        } catch { return false; }
    }

    addBtn.addEventListener('click', () => { createAlarmRow(); saveAlarms(); });
    toggleBtn.addEventListener('click', () => (STATE.running ? stop() : start()));
    resetBtn.addEventListener('click', reset);

    render(); updateControls();
    if (!loadAlarms()) createAlarmRow();
})();
