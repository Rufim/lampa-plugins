// Lampa: усыплять WebAudio на время внешнего плеера.
// Открытый AudioContext держит системный микшер Android активным, и на приставках
// (Сбер/Amlogic) HAL не запускает битстрим AC3/E-AC3/DTS во внешнем плеере.
(function () {
    'use strict';

    if (window.__audio_guard) return;
    window.__audio_guard = true;

    var contexts = [];
    var slept = [];
    var asleep = false;
    var sleptAt = 0;

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('AudioGuard');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function sleepOne(ctx) {
        if (ctx.state !== 'running') return;
        slept.push(ctx);
        ctx.suspend().catch(function () {});
    }

    function sleep(reason) {
        contexts = contexts.filter(function (c) { return c.state !== 'closed'; });
        asleep = true;
        sleptAt = Date.now();
        contexts.forEach(sleepOne);
        log('sleep', reason, 'suspended:', slept.length);
    }

    function wake(reason) {
        if (!asleep) return;
        // нажатие, запустившее плеер, не должно сразу разбудить
        if (reason !== 'visible' && Date.now() - sleptAt < 2000) return;
        asleep = false;
        var list = slept;
        slept = [];
        list.forEach(function (ctx) {
            if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        });
        log('wake', reason, 'resumed:', list.length);
    }

    function wrapContext(name) {
        var Orig = window[name];
        if (typeof Orig !== 'function') return;

        var Wrapped = function () {
            var ctx = Reflect.construct(Orig, Array.prototype.slice.call(arguments), new.target || Wrapped);
            contexts.push(ctx);
            if (asleep) sleepOne(ctx);
            return ctx;
        };
        Wrapped.prototype = Orig.prototype;
        Object.setPrototypeOf(Wrapped, Orig);
        window[name] = Wrapped;
    }

    function wrapMethod(obj, method, reason) {
        if (!obj || typeof obj[method] !== 'function') return;
        var orig = obj[method];
        try {
            obj[method] = function () {
                sleep(reason);
                return orig.apply(this, arguments);
            };
        } catch (e) {}
    }

    wrapContext('AudioContext');
    wrapContext('webkitAudioContext');

    function hookPlayers() {
        if (window.Lampa && Lampa.Android) wrapMethod(Lampa.Android, 'openPlayer', 'external player');
        if (window.AndroidJS) wrapMethod(window.AndroidJS, 'openPlayer', 'external player (bridge)');
    }

    if (window.Lampa && Lampa.Android) hookPlayers();
    else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') hookPlayers();
        });
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') sleep('hidden');
        else wake('visible');
    });
    window.addEventListener('focus', function () { wake('focus'); });
    window.addEventListener('keydown', function () { wake('key'); }, true);

    log('ready');
})();
