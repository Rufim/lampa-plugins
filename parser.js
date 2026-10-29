// Lampa: выбор публичного парсера Jackett/JacRed с проверкой доступности.
// Меню показывает каждый сервер с ответом на настоящий поиск (время и число раздач),
// выбор в один клик пишет адрес и ключ в штатные настройки парсера Lampa.
(function () {
    'use strict';

    if (window.__rp_parser) return;
    window.__rp_parser = true;

    // Проверено 29.10.2026: все отдают раздачи на запрос «The Matrix 1999».
    // jac.red и ru.jac.black режут голый curl (403), но живы для Lampa — статус покажет проверка.
    var SERVERS = [
        { id: 'jac_red_ru', name: 'Jac-red.ru', url: 'https://jac-red.ru', key: '' },
        { id: 'lampa_app', name: 'Lampa.app', url: 'https://lampa.app', key: '' },
        { id: 'jacred_su', name: 'JacRed.su', url: 'https://jacred.su', key: '' },
        { id: 'jac_red', name: 'Jac.red', url: 'jac.red', key: '' },
        { id: 'ru_jac_black', name: 'RU Jac.black', url: 'https://ru.jac.black', key: '' },
        { id: 'freebie', name: 'Freebie', url: 'http://jacred.freebie.tom.ru', key: '1' },
        { id: 'lampa_jacred', name: 'Lampa jacred', url: 'http://87.120.84.218:9117', key: '333' }
    ];

    var OWN = 'own';
    var KEY_SELECTED = 'rp_parser_id';
    var KEY_OWN_URL = 'rp_parser_own_url';
    var KEY_OWN_KEY = 'rp_parser_own_key';

    var PING_TIMEOUT = 8000;
    var PING_TTL = 3 * 60 * 1000;
    var PING_QUERY = '&Query=' + encodeURIComponent('The Matrix') +
        '&title=' + encodeURIComponent('Матрица') +
        '&title_original=' + encodeURIComponent('The Matrix') +
        '&year=1999&is_serial=1&Category[]=2000';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

    var pings = {};

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('RpParser');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function find(id) {
        for (var i = 0; i < SERVERS.length; i++) if (SERVERS[i].id === id) return SERVERS[i];
        return null;
    }

    function selectedId() {
        return Lampa.Storage.get(KEY_SELECTED, OWN) || OWN;
    }

    function selectedName() {
        var s = find(selectedId());
        return s ? s.name : 'Свой (из настроек)';
    }

    // Адрес без протокола Lampa дополняет протоколом страницы — так же делаем и мы.
    function fullUrl(url) {
        if (/^https?:\/\//.test(url)) return url;
        return (window.location.protocol === 'https:' ? 'https://' : 'http://') + url;
    }

    function mixedBlocked(server) {
        if (Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('android')) return false;
        return window.location.protocol === 'https:' && /^http:\/\//.test(server.url);
    }

    function rememberOwn() {
        if (selectedId() !== OWN) return;
        Lampa.Storage.set(KEY_OWN_URL, Lampa.Storage.get('jackett_url', '') || '');
        Lampa.Storage.set(KEY_OWN_KEY, Lampa.Storage.get('jackett_key', '') || '');
    }

    function apply(id) {
        rememberOwn();

        var server = find(id);
        if (server) {
            Lampa.Storage.set('jackett_url', server.url);
            Lampa.Storage.set('jackett_key', server.key);
            Lampa.Storage.set('jackett_interview', 'all');
        } else {
            id = OWN;
            Lampa.Storage.set('jackett_url', Lampa.Storage.get(KEY_OWN_URL, '') || '');
            Lampa.Storage.set('jackett_key', Lampa.Storage.get(KEY_OWN_KEY, '') || '');
        }

        Lampa.Storage.set('parser_torrent_type', 'jackett');
        Lampa.Storage.set('parser_use', true);
        Lampa.Storage.set(KEY_SELECTED, id);

        log('applied', id, Lampa.Storage.get('jackett_url', ''));
    }

    // Пинг — тот же поисковый запрос, что шлёт Lampa: живой сервер = 200 и массив Results.
    function ping(server, done) {
        var cached = pings[server.id];
        if (cached && Date.now() - cached.at < PING_TTL) return done(cached);

        if (mixedBlocked(server)) {
            return done({ ok: false, text: 'только http — недоступен со страницы https', at: 0 });
        }

        var url = fullUrl(server.url) + '/api/v2.0/indexers/all/results?apikey=' +
            encodeURIComponent(server.key) + PING_QUERY;
        var started = Date.now();
        var finished = false;
        var net = new Lampa.Reguest();

        function finish(result) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            try { net.clear(); } catch (e) {}
            result.at = Date.now();
            if (result.ok) pings[server.id] = result;
            done(result);
        }

        var timer = setTimeout(function () {
            finish({ ok: false, text: 'нет ответа за ' + (PING_TIMEOUT / 1000) + ' с' });
        }, PING_TIMEOUT + 500);

        try {
            net.timeout(PING_TIMEOUT);
            net.native(url, function (json) {
                if (typeof json === 'string') {
                    try { json = JSON.parse(json); } catch (e) { json = null; }
                }
                var seconds = ((Date.now() - started) / 1000).toFixed(1);
                if (json && Array.isArray(json.Results)) {
                    finish({ ok: true, text: seconds + ' с · раздач: ' + json.Results.length });
                } else {
                    finish({ ok: false, text: 'ответ не похож на парсер (' + seconds + ' с)' });
                }
            }, function (xhr) {
                var code = xhr && xhr.status;
                var text = code === 401 ? 'нужен ключ (401)' :
                    code ? 'ошибка ' + code : 'не отвечает';
                finish({ ok: false, text: text });
            });
        } catch (e) {
            finish({ ok: false, text: 'ошибка запроса' });
        }
    }

    function reloadTorrents() {
        try {
            var active = Lampa.Activity.active();
            if (active && active.component === 'torrents') Lampa.Activity.replace();
        } catch (e) {
            log('reload failed', e && e.message);
        }
    }

    function updateLabels() {
        var name = selectedName();
        $('.rp-parser-current').text(name);
        $('div[data-name="rp_parser_pick"] .settings-param__descr').text('Сейчас: ' + name);
    }

    function showMenu(onClosed) {
        var current = selectedId();
        var items = [];

        SERVERS.forEach(function (server) {
            items.push({
                title: server.name,
                subtitle: 'проверка…',
                server: server,
                selected: server.id === current
            });
        });

        var ownUrl = current === OWN ? Lampa.Storage.get('jackett_url', '') : Lampa.Storage.get(KEY_OWN_URL, '');
        items.push({
            title: 'Свой (из настроек)',
            subtitle: ownUrl ? String(ownUrl) : 'адрес не задан',
            own: true,
            selected: current === OWN
        });

        Lampa.Select.show({
            title: 'Парсер',
            items: items,
            onSelect: function (item) {
                apply(item.own ? OWN : item.server.id);
                updateLabels();
                Lampa.Noty.show('Парсер: ' + selectedName());
                if (onClosed) onClosed(true);
            },
            onBack: function () {
                if (onClosed) onClosed(false);
            }
        });

        // Select рисует пункты по порядку items — подписи обновляем по индексу.
        var rows = $('.selectbox .selectbox-item');
        SERVERS.forEach(function (server, index) {
            ping(server, function (result) {
                var row = rows.eq(index);
                var sub = row.find('.selectbox-item__subtitle');
                if (!sub.length) {
                    sub = $('<div class="selectbox-item__subtitle"></div>');
                    row.append(sub);
                }
                sub.text((result.ok ? '✓ ' : '✗ ') + result.text)
                    .css('color', result.ok ? '#64e364' : '#ff6b6b');
            });
        });
    }

    function addSettings() {
        Lampa.SettingsApi.addParam({
            component: 'parser',
            param: { name: 'rp_parser_pick', type: 'button' },
            field: {
                name: 'Выбрать парсер',
                description: 'Сейчас: ' + selectedName()
            },
            onChange: function () {
                var controller = Lampa.Controller.enabled().name;
                showMenu(function () {
                    Lampa.Controller.toggle(controller);
                });
            },
            onRender: function (item) {
                setTimeout(function () {
                    var anchor = $('div[data-name="parser_torrent_type"]');
                    if (anchor.length) item.insertAfter(anchor);
                }, 0);
            }
        });
    }

    // Кнопка в фильтре страницы торрентов: сменить парсер и сразу перезапустить поиск.
    function addTorrentsButton(render, attempt) {
        attempt = attempt || 0;
        var sort = render.find('.filter--sort').first();
        if (!sort.length) {
            if (attempt < 20) setTimeout(function () { addTorrentsButton(render, attempt + 1); }, 150);
            return;
        }
        if (render.find('.rp-parser-button').length) return;

        var button = $('<div class="simple-button simple-button--filter selector rp-parser-button">' +
            ICON + '<span class="rp-parser-current"></span></div>');
        button.find('svg').css({ width: '1.2em', height: '1.2em', 'margin-right': '0.4em' });
        button.find('.rp-parser-current').text(selectedName());

        button.on('hover:enter', function () {
            showMenu(function (changed) {
                if (changed) reloadTorrents();
                else Lampa.Controller.toggle('content');
            });
        });

        sort.before(button);
    }

    function start() {
        addSettings();

        Lampa.Listener.follow('activity', function (e) {
            if (e.component !== 'torrents' || e.type !== 'start') return;
            var object = e.object;
            var render = object && object.activity && object.activity.render && object.activity.render();
            if (render) addTorrentsButton($(render));
        });

        log('ready, selected', selectedId());
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
