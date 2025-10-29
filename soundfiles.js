const SOUND_FILES = [
    'アラーム',
    'ゴング',
    'ビープ',
    'ベル1',
    'ベル2',
    'ホーン',
    '警告1',
    '警告2',
    '警告3',
    '拍子木',
    '爆発',
    '和太鼓1',
    '和太鼓2',
];

// 他のJS/Service Workerから参照できるように公開
(function (root) { root.SOUND_FILES = SOUND_FILES; })(typeof self !== 'undefined' ? self : window);
