// Lampa: русские трейлеры с Кинопоиска в списке кнопки «Смотреть».
// Номер фильма на КП берётся из карточки, иначе из Wikidata по id TMDB / IMDb;
// поток (HLS) отдаёт открытый плеер-виджет Кинопоиска. Дополнительно — трейлеры и тизеры с RuTube.
(function () {
    'use strict';

    if (window.__rp_kp_trailers) return;
    window.__rp_kp_trailers = true;

    var KEY_PLAYER = 'kpt_player';
    var CACHE_TTL = 10 * 60 * 1000;
    var MAX_KP_IDS = 3;
    var MAX_RUTUBE = 10;

    var ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>';

    var cache = {};

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('KpTrailers');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function cached(key) {
        var c = cache[key];
        return c && Date.now() - c.at < CACHE_TTL ? c.value : null;
    }

    function remember(key, value) {
        cache[key] = { at: Date.now(), value: value };
    }

    // Запрос в обход CORS: на Android Lampa ходит через нативный httpReq.
    function request(url, asText, done) {
        var net = new Lampa.Reguest();
        var finished = false;
        function finish(data) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { net.clear(); } catch (e) {}
            done(data);
        }
        var timer = setTimeout(function () { finish(null); }, 12000);
        try {
            net.timeout(10000);
            net.native(url, function (data) {
                if (!asText && typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { data = null; }
                }
                finish(data);
            }, function () {
                finish(null);
            }, false, asText ? { dataType: 'text' } : undefined);
        } catch (e) {
            log('request failed', url, e && e.message);
            finish(null);
        }
    }

    function isSerial(movie) {
        return !!(movie.name || movie.original_name || movie.first_air_date || movie.number_of_seasons);
    }

    function cardYear(movie) {
        var y = String(movie.release_date || movie.first_air_date || '').slice(0, 4);
        return /^\d{4}$/.test(y) ? y : '';
    }

    // ---------- Номер фильма на Кинопоиске ----------

    function kpIdsFromCard(movie) {
        var id = movie.kinopoisk_id || movie.kp_id;
        return id && /^\d+$/.test(String(id)) ? [String(id)] : [];
    }

    function kpIdsFromWikidata(movie, done) {
        var parts = [];
        var tmdbOk = (movie.source === 'tmdb' || movie.source === 'cub' || !movie.source) && /^\d+$/.test(String(movie.id || ''));
        if (tmdbOk) {
            parts.push('{ ?f wdt:' + (isSerial(movie) ? 'P4983' : 'P4947') + ' "' + movie.id + '" }');
        }
        if (/^tt\d+$/.test(movie.imdb_id || '')) parts.push('{ ?f wdt:P345 "' + movie.imdb_id + '" }');
        if (!parts.length) return done([]);

        var key = 'wd:' + parts.join('|');
        var hit = cached(key);
        if (hit) return done(hit);

        var query = 'SELECT DISTINCT ?kp WHERE { ' + parts.join(' UNION ') + ' ?f wdt:P2603 ?kp }';
        var url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);

        request(url, false, function (json) {
            var ids = [];
            try {
                json.results.bindings.forEach(function (b) {
                    var v = b.kp && b.kp.value;
                    if (v && /^\d+$/.test(v) && ids.indexOf(v) === -1) ids.push(v);
                });
            } catch (e) {}
            ids = ids.slice(0, MAX_KP_IDS);
            if (json) remember(key, ids);
            log('wikidata', movie.id, ids);
            done(ids);
        });
    }

    // ---------- Виджет Кинопоиска ----------

    function parseWidget(html) {
        var m = typeof html === 'string' && html.match(/<script[^>]*data-state[^>]*>([\s\S]*?)<\/script>/);
        if (!m) return [];
        var state;
        try { state = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return []; }
        var trailers = state && state.models && state.models.trailers;
        if (!trailers) return [];

        var list = [];
        Object.keys(trailers).forEach(function (id) {
            var t = trailers[id];
            if (!t || !t.streamUrl) return;
            var preview = t.img && t.img.previewUrl;
            var thumb = preview && (preview.x1 || preview.x2);
            list.push({
                film: t.film && t.film.title || '',
                url: t.streamUrl,
                thumb: thumb ? (thumb.indexOf('//') === 0 ? 'https:' + thumb : thumb) : ''
            });
        });
        return list;
    }

    function kpTrailers(ids, done) {
        var all = [];
        var left = ids.length;
        if (!left) return done(all);
        ids.forEach(function (id) {
            // ссылка на поток подписана и живёт недолго — виджет не кэшируем
            request('https://widgets.kinopoisk.ru/discovery/film/' + id + '?onlyPlayer=1', true, function (html) {
                parseWidget(html).forEach(function (t) {
                    t.kpId = id;
                    all.push(t);
                });
                if (--left === 0) done(all);
            });
        });
    }

    // ---------- RuTube ----------

    function norm(text) {
        return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
    }

    function rutubeTrailers(movie, done) {
        var title = movie.title || movie.name || '';
        var original = movie.original_title || movie.original_name || '';
        var year = cardYear(movie);
        if (!title) return done([]);

        var key = 'rt:' + (isSerial(movie) ? 'tv' : 'movie') + ':' + movie.id + ':' + title;
        var hit = cached(key);
        if (hit) return done(hit);

        var query = [title, year, 'трейлер'].filter(Boolean).join(' ');
        var url = 'https://rutube.ru/api/search/video/?query=' + encodeURIComponent(query) + '&format=json';
        var titles = [norm(title), norm(original)].filter(Boolean);

        request(url, false, function (json) {
            var rows = (json && Array.isArray(json.results)) ? json.results : [];
            var list = rows.filter(function (v) {
                if (!v || v.is_hidden || v.is_deleted || v.is_locked || v.is_paid || v.is_livestream || v.is_adult) return false;
                if (v.duration && Number(v.duration) > 600) return false;
                var name = norm(v.title);
                if (!/(трейлер|тизер|trailer|teaser)/.test(name)) return false;
                return titles.some(function (t) { return name.indexOf(t) !== -1; });
            }).slice(0, MAX_RUTUBE).map(function (v) {
                return {
                    id: v.id,
                    title: v.title,
                    author: v.author && v.author.name || '',
                    duration: Number(v.duration) || 0,
                    thumb: v.thumbnail_url || ''
                };
            });
            if (json) remember(key, list);
            done(list);
        });
    }

    function rutubeStream(id, done) {
        request('https://rutube.ru/api/play/options/' + id + '/?format=json&no_404=true', false, function (json) {
            var url = json && json.video_balancer && (json.video_balancer.m3u8 || json.video_balancer.default);
            done(url || '');
        });
    }

    // ---------- Воспроизведение ----------

    // Поток Кинопоиска отдаёт CORS только своему сайту, а плеер Lampa грузит видео с
    // crossorigin="anonymous" — и браузер его режет. Без атрибута WebView играет HLS сам и
    // CORS не спрашивает. Снимаем атрибут только для своих трейлеров, остальным возвращаем.
    var ownStreams = {};

    function patchVideoSrc() {
        var proto = window.HTMLMediaElement && HTMLMediaElement.prototype;
        var desc = proto && Object.getOwnPropertyDescriptor(proto, 'src');
        if (!desc || !desc.set || !desc.configurable) return;

        Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: desc.enumerable,
            get: desc.get,
            set: function (value) {
                try {
                    if (ownStreams[value]) {
                        if (this.hasAttribute('crossorigin')) {
                            this.removeAttribute('crossorigin');
                            this.__kptCors = true;
                        }
                    } else if (this.__kptCors) {
                        this.setAttribute('crossorigin', 'anonymous');
                        this.__kptCors = false;
                    }
                } catch (e) {}
                desc.set.call(this, value);
            }
        });
    }

    function playerMode(invert) {
        // По умолчанию внешний: потоки КП и RuTube без CORS, и встроенный плеер может
        // играть их только нативно — на части приставок (HiSilicon) тогда звук без картинки.
        var mode = Lampa.Storage.get(KEY_PLAYER, 'android') === 'inner' ? 'inner' : 'android';
        if (invert) mode = mode === 'android' ? 'inner' : 'android';
        if (mode === 'android' && !(Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('android'))) mode = 'inner';
        return mode;
    }

    function play(url, title, invert) {
        var data = {
            url: url,
            title: title,
            launch_player: playerMode(invert),
            hls_type: 'native'
        };
        ownStreams[url] = true;
        log('play', data.launch_player, url);
        Lampa.Player.play(data);
        Lampa.Player.playlist([data]);
    }

    function duration(seconds) {
        if (!seconds) return '';
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ---------- Список ----------

    function collect(movie, done) {
        var result = { kp: [], rutube: [] };
        var left = 2;
        function part() { if (--left === 0) done(result); }

        var ids = kpIdsFromCard(movie);
        var withIds = function (list) {
            kpTrailers(list, function (trailers) {
                result.kp = trailers;
                part();
            });
        };
        if (ids.length) withIds(ids);
        else kpIdsFromWikidata(movie, withIds);

        rutubeTrailers(movie, function (list) {
            result.rutube = list;
            part();
        });
    }

    function open(movie) {
        var title = movie.title || movie.name || movie.original_title || movie.original_name || '';
        var cancelled = false;
        Lampa.Loading.start(function () {
            cancelled = true;
            Lampa.Loading.stop();
        });

        collect(movie, function (found) {
            if (cancelled) return;
            Lampa.Loading.stop();

            var items = [];
            found.kp.forEach(function (t, i) {
                items.push({
                    title: found.kp.length > 1 ? 'Трейлер Кинопоиска ' + (i + 1) : 'Трейлер Кинопоиска',
                    subtitle: t.film || title,
                    thumbnail: t.thumb || undefined,
                    stream: t.url
                });
            });
            if (found.rutube.length) {
                items.push({ title: 'RuTube', separator: true });
                found.rutube.forEach(function (v) {
                    items.push({
                        title: v.title,
                        subtitle: [duration(v.duration), v.author].filter(Boolean).join(' · '),
                        thumbnail: v.thumb || undefined,
                        rutube: v.id
                    });
                });
            }

            if (!items.length) {
                Lampa.Noty.show('Трейлеров не нашлось');
                return;
            }

            var controller = Lampa.Controller.enabled().name;
            var choose = function (item, invert) {
                // долгое нажатие Select сам не закрывает
                if (invert) Lampa.Select.hide();
                Lampa.Controller.toggle(controller);
                if (item.stream) return play(item.stream, title + ' — ' + item.title, invert);
                if (item.rutube) {
                    rutubeStream(item.rutube, function (url) {
                        if (url) play(url, item.title, invert);
                        else Lampa.Noty.show('RuTube не отдал видео');
                    });
                }
            };

            Lampa.Select.show({
                title: 'Трейлеры: ' + title,
                items: items,
                onSelect: function (item) { choose(item, false); },
                onLong: function (item) { choose(item, true); },
                onBack: function () { Lampa.Controller.toggle(controller); }
            });
        });
    }

    // ---------- Кнопка в «Смотреть» ----------

    function addButton(e) {
        var render = e.object && e.object.activity && e.object.activity.render && $(e.object.activity.render());
        var movie = e.data && e.data.movie;
        if (!render || !movie) return;
        if (render.find('.view--kp-trailers').length) return;

        var button = $('<div class="full-start__button selector view--kp-trailers" data-subtitle="Кинопоиск, RuTube">' +
            ICON + '<span>Трейлеры Кинопоиска</span></div>');
        button.on('hover:enter', function () { open(movie); });

        var torrent = render.find('.view--torrent');
        if (torrent.length) torrent.after(button);
        else render.find('.buttons--container').append(button);
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'kp_trailers',
            name: 'Трейлеры Кинопоиска',
            icon: ICON
        });
        Lampa.SettingsApi.addParam({
            component: 'kp_trailers',
            param: {
                name: KEY_PLAYER,
                type: 'select',
                values: { inner: 'Встроенный', android: 'Внешний (Android)' },
                default: 'android'
            },
            field: {
                name: 'Плеер для трейлеров',
                description: 'Долгое нажатие на трейлер — открыть в другом плеере'
            }
        });
    }

    function start() {
        patchVideoSrc();
        addSettings();
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') addButton(e);
        });
        log('ready');
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
