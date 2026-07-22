/**
 * TWCC Attack Organizer v3.6
 * Nur „Eintreffend“, frei sortierbare Buttons und explizite Aktion:
 * Status ersetzen oder Zusatz anhängen.
 */
(function () {
    'use strict';

    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    const $ = win.jQuery || win.$ || window.jQuery || window.$;

    if (!$) {
        console.error('[TWCC Attack Organizer] jQuery wurde nicht gefunden.');
        return;
    }

    // Beim erneuten Laden keine doppelten Listener/Observer erzeugen.
    if (win.TWCC_AttackOrganizer && typeof win.TWCC_AttackOrganizer.destroy === 'function') {
        try { win.TWCC_AttackOrganizer.destroy(); } catch (e) {}
    }

    const TEAMCODE_STORAGE_KEY = 'twcc_attack_organizer_team_config_v1';
    const TEAMCODE_PREFIX = 'TWCCAO1:';

    function safeJsonParse(value, fallback) {
        try { return JSON.parse(value); } catch (e) { return fallback; }
    }

    function getStoredTeamConfig() {
        const raw = localStorage.getItem(TEAMCODE_STORAGE_KEY);
        const parsed = raw ? safeJsonParse(raw, null) : null;
        return parsed && parsed.type === 'TWCC_AttackOrganizer_Settings' ? parsed : null;
    }

    function utf8ToBase64(value) {
        const bytes = new TextEncoder().encode(String(value));
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
    }

    function base64ToUtf8(value) {
        const binary = atob(String(value));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    function encodeTeamCode(config) {
        return TEAMCODE_PREFIX + utf8ToBase64(JSON.stringify(config));
    }

    function decodeTeamCode(code) {
        const clean = String(code || '').trim();
        if (!clean.startsWith(TEAMCODE_PREFIX)) {
            throw new Error('Ungültiger Teamcode. Erwartet wird ein Code mit "' + TEAMCODE_PREFIX + '".');
        }
        const parsed = safeJsonParse(base64ToUtf8(clean.slice(TEAMCODE_PREFIX.length)), null);
        if (!parsed || parsed.type !== 'TWCC_AttackOrganizer_Settings' || !parsed.settings) {
            throw new Error('Der Teamcode enthält keine gültigen Attack-Organizer-Einstellungen.');
        }
        return parsed;
    }

    const storedTeamConfig = getStoredTeamConfig();

    const fallbackSettings = {
        0: ['[Gedefft]', 'Gedefft', 'green', 'white'],
        1: ['[Nachdeffen]', 'Nachdeffen', 'lime', 'black'],
        2: ['[Rausstellen]', 'Rausstellen', 'yellow', 'black'],
        3: ['[Tabben]', 'Tabben', 'orange', 'white'],
        4: ['[Readel]', 'Readel', 'orange', 'white'],
        5: [' | Fakeschutz IO', 'Fakeschutz IO', 'green', 'white'],
        6: [' | Aufstocken IO', 'Aufgestockt', 'green', 'white'],
        7: [' | Wallcheck', 'Wallcheck', 'yellow', 'black'],
        8: [' | Off Raus ⚠️', 'Off Raus', 'yellow', 'black'],
        9: [' | Fake DB', 'Fake?', 'green', 'white'],
        10: [' | Off DB', 'Off?', 'red', 'white'],
        11: [' | DONE ✅', 'DONE', 'dgreen', 'white']
    };

    const fallbackColors = {
        red: ['#c18a8a', '#c18a8a'],
        yellow: ['#ffd91c', '#e8c30d'],
        white: ['#ffffff', '#dbdbdb'],
        black: ['#000000', '#2b2b2b'],
        green: ['#31c908', '#228c05'],
        dgreen: ['#196f24', '#12551b'],
        orange: ['#ef8b10', '#d3790a'],
        lime: ['#ffd400', '#ffd400'],
        blue: ['#0d83dd', '#0860a3'],
        lblue: ['#22e5db', '#0cd3c9'],
        gray: ['#adb6c6', '#828891'],
        dorange: ['#ff0000', '#ff0000'],
        pink: ['#ff69b4', '#ff69b4'],
        incok: ['#659b5e', '#659b5e'],
        inckontrolle: ['#95bf74', '#95bf74'],
        durchlassen: ['#90323d', '#90323d'],
        raus: ['#ad2e24', '#ad2e24'],
        rausgestellt: ['#d8572a', '#d8572a'],
        tabben: ['#005e9b', '#005e9b'],
        getabben: ['#52acff', '#52acff'],
        cleaner: ['#ffb700', '#ffb700'],
        readel: ['#ffdd00', '#ffdd00'],
        Nachdeffen: ['#66CDAA', '#66CDAA'],
        holder: ['#D3D3D3', '#BDB76B']
    };

    // Importierte Team-Einstellungen haben Vorrang. Ohne Import werden die
    // von TWCC bereitgestellten Werte beziehungsweise die Originalwerte verwendet.
    const settings = storedTeamConfig && storedTeamConfig.settings
        ? storedTeamConfig.settings
        : ((win.settings && Object.keys(win.settings).length) ? win.settings : fallbackSettings);

    const colors = Object.assign(
        {},
        fallbackColors,
        win.colors || {},
        storedTeamConfig && storedTeamConfig.colors ? storedTeamConfig.colors : {}
    );
    const fontSize = Number(storedTeamConfig && storedTeamConfig.fontSize) || Number(win.font_size) || 8;
    const attackLayout = (storedTeamConfig && storedTeamConfig.attackLayout) || win.attack_layout || 'column';

    const buttonNames = $.map(settings, obj => obj[0]);
    const buttonIcons = $.map(settings, obj => obj[1]);
    const buttonColors = $.map(settings, obj => obj[2]);
    const buttonTextColors = $.map(settings, obj => obj[3]);
    const buttonModes = $.map(settings, obj => obj[4] || (String(obj[0] || '').indexOf('|') !== -1 ? 'append' : 'replace'));

    let observer = null;
    let scheduled = false;

    function colorValue(name, index, fallback) {
        const entry = colors[name];
        return entry && entry[index] ? entry[index] : fallback;
    }

    function getTop(num) {
        return colorValue(buttonColors[num], 0, '#b69471');
    }

    function getBot(num) {
        return colorValue(buttonColors[num], 1, '#6c4d2d');
    }

    function getFont(num) {
        return colorValue(buttonTextColors[num], 0, '#ffffff');
    }

    function isSupport(line) {
        const src = $(line).find('img').first().attr('src') || '';
        return src.indexOf('support') >= 0;
    }

    function baseCommandName(value) {
        return String(value || '').trim().split(/\s+/)[0] || '';
    }

    function renameLine(line, text, mode) {
        const $line = $(line);
        const $rename = $line.find('.rename-icon').first();

        if (!$rename.length) return;

        $rename.trigger('click');

        // Quickedit wird teilweise erst nach dem Klick erzeugt.
        setTimeout(function () {
            const $input = $line.find('.quickedit-content input[type="text"], input[type="text"]').first();
            const $save = $line.find('.quickedit-content input[type="button"], input[type="button"]').first();

            if (!$input.length || !$save.length) return;

            const current = $input.val() || '';
                        if (mode === 'append') {
                const separator = current && text && !/^\s/.test(text) ? ' ' : '';
                $input.val(current + separator + text);
            } else {
                $input.val((baseCommandName(current) + ' ' + text).trim());
            }
            $save.trigger('click');

            setTimeout(function () {
                markRowUnprocessed(line);
                processRow(line);
                colorRows();
            }, 150);
        }, 30);
    }

    function markRowUnprocessed(line) {
        $(line).removeAttr('data-twcc-ao-ready');
        $(line).find('.twcc-ao-buttons').remove();
    }

    function addButtons(line, nr) {
        const $line = $(line);
        if ($line.attr('data-twcc-ao-ready') === '1') return;
        if (isSupport(line)) return;

        // Die quickedit-content ist auf aktuellen Welten häufig ausgeblendet.
        // Darum werden die Buttons in die sichtbare Befehlszelle eingesetzt.
        const $quickedit = $line.find('.quickedit').first();
        const $label = $line.find('.quickedit-label').first();
        const $rename = $line.find('.rename-icon').first();

        let $target = $quickedit.closest('td');
        if (!$target.length) $target = $label.closest('td');
        if (!$target.length) $target = $rename.closest('td');
        if (!$target.length) return;

        const $wrap = $('<span class="twcc-ao-buttons"></span>').css({
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '2px',
            marginLeft: '6px',
            verticalAlign: 'middle',
            position: 'relative',
            zIndex: '5'
        });

        buttonIcons.forEach(function (icon, num) {
            const $button = $('<button type="button" class="btn twcc-ao-button"></button>')
                .text(icon)
                .attr('title', buttonNames[num])
                .css({
                    color: getFont(num),
                    fontSize: fontSize + 'px',
                    background: 'linear-gradient(to bottom,' + getTop(num) + ' 30%,' + getBot(num) + ' 100%)',
                    padding: '2px 5px',
                    minHeight: '22px'
                })
                .on('click.twccAO', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    const text = buttonNames[num] || '';
                    renameLine(line, text, buttonModes[num] === 'append' ? 'append' : 'replace');
                });

            $wrap.append($button);
        });

        // Direkt hinter dem sichtbaren Quickedit-Element einsetzen.
        if ($quickedit.length) {
            $quickedit.after($wrap);
        } else if ($label.length) {
            $label.closest('.quickedit-content, .quickedit, span').after($wrap);
        } else {
            $target.append($wrap);
        }

        $line.attr('data-twcc-ao-ready', '1');
    }

    function findCodes(name) {
        const found = [];
        for (let i = 0; i < buttonNames.length; i++) {
            if (name.indexOf(buttonNames[i]) !== -1) found.push(i);
        }
        return found;
    }

    function setRowBackground($line, background) {
        if (attackLayout === 'line') {
            $line.find('td').attr('style', function (_, old) {
                return (old || '') + ';background:' + background + ' !important;';
            });
        } else if (attackLayout === 'column') {
            $line.find('td').first().attr('style', function (_, old) {
                return (old || '') + ';background:' + background + ' !important;';
            });
        }
        $line.find('a').first().css({
            color: 'white',
            textShadow: '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000'
        });
    }


    function normalizeText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function getIncomingRows() {
        const result = [];

        $('table').each(function () {
            let insideIncomingSection = false;

            $(this).find('tr').each(function () {
                const $row = $(this);

                // Abschnittsüberschriften stehen in TW normalerweise in einer TH-
                // oder einer über mehrere Spalten laufenden TD-Zelle.
                const $headingCell = $row.children('th, td[colspan]').first();
                const heading = normalizeText($headingCell.text());

                if (/^eintreffend(?:\s|\(|$)/.test(heading)) {
                    insideIncomingSection = true;
                    return;
                }

                // Sobald ein anderer Befehlsabschnitt beginnt, endet „Eintreffend“.
                if (
                    /^(eigene befehle|ausgehend|unterstützungen|rückkehrend|befehle)(?:\s|\(|$)/.test(heading)
                ) {
                    insideIncomingSection = false;
                    return;
                }

                if (
                    insideIncomingSection &&
                    $row.find('.rename-icon, .quickedit-label, .quickedit').length > 0
                ) {
                    result.push(this);
                }
            });
        });

        return $(Array.from(new Set(result)));
    }

    function cleanupOutsideIncoming() {
        const allowed = new Set(getIncomingRows().toArray());

        $('.twcc-ao-buttons').each(function () {
            const row = $(this).closest('tr')[0];
            if (!row || !allowed.has(row)) {
                $(this).remove();
                if (row) $(row).removeAttr('data-twcc-ao-ready');
            }
        });
    }

    function colorRows() {
        getIncomingRows().each(function () {
            const $line = $(this);

            if (isSupport(this)) {
                setRowBackground($line, colorValue('yellow', 1, '#e8c30d'));
                return;
            }

            const name = $.trim($line.find('.quickedit-label').first().text());
            const codes = findCodes(name);

            if (codes.length === 1) {
                setRowBackground($line, colorValue(buttonColors[codes[0]], 1, '#6c4d2d'));
            } else if (codes.length >= 2) {
                const c1 = colorValue(buttonColors[codes[0]], 0, '#6c4d2d');
                const c2 = colorValue(buttonColors[codes[1]], 0, '#6c4d2d');
                setRowBackground(
                    $line,
                    'repeating-linear-gradient(45deg,' + c1 + ',' + c1 + ' 10px,' + c2 + ' 10px,' + c2 + ' 20px)'
                );
            } else if (name) {
                setRowBackground($line, colorValue('red', 1, '#b70707'));
            }
        });
    }

    function processRow(line, nr) {
        if (!isSupport(line)) addButtons(line, nr);
    }

    function scan() {
        scheduled = false;
        cleanupOutsideIncoming();

        getIncomingRows().each(function (nr) {
            processRow(this, nr);
        });

        colorRows();
    }

    function scheduleScan() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(scan, 60);
    }

    function ensureButtonStyles() {
        if (document.getElementById('twcc-ao-visible-style')) return;
        const style = document.createElement('style');
        style.id = 'twcc-ao-visible-style';
        style.textContent = `
            .twcc-ao-buttons { visibility: visible !important; opacity: 1 !important; }
            .twcc-ao-button { display: inline-block !important; visibility: visible !important; opacity: 1 !important; cursor: pointer !important; }
            #incomings_table td, #commands_incomings td { overflow: visible !important; }
        `;
        document.head.appendChild(style);
    }

    function buildCurrentTeamConfig() {
        return {
            type: 'TWCC_AttackOrganizer_Settings',
            formatVersion: 1,
            organizerVersion: '3.6.0-teamcode',
            exportedAt: new Date().toISOString(),
            settings: settings,
            colors: colors,
            fontSize: fontSize,
            attackLayout: attackLayout
        };
    }

    function showTeamCodeDialog() {
        $('#twcc-ao-teamcode-dialog').remove();

        const currentCode = encodeTeamCode(buildCurrentTeamConfig());
        const $overlay = $('<div id="twcc-ao-teamcode-dialog"></div>').css({
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,.55)', zIndex: 999999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px'
        });
        const $box = $('<div></div>').css({
            width: 'min(720px, 96vw)', maxHeight: '90vh', overflow: 'auto',
            background: '#f4e4bc', border: '2px solid #7d510f', borderRadius: '6px',
            padding: '14px', color: '#2b1a08', boxShadow: '0 8px 28px rgba(0,0,0,.45)'
        });
        const $title = $('<div><strong>Attack Organizer – Teamcode</strong></div>').css({fontSize:'16px', marginBottom:'8px'});
        const $hint = $('<div></div>').text('Export: Code kopieren und weitergeben. Import: erhaltenen Code einfügen und übernehmen.').css({marginBottom:'8px'});
        const $area = $('<textarea spellcheck="false"></textarea>').val(currentCode).css({
            width: '100%', minHeight: '190px', boxSizing: 'border-box', resize: 'vertical',
            fontFamily: 'monospace', fontSize: '12px'
        });
        const $status = $('<div></div>').css({minHeight:'20px', marginTop:'8px', fontWeight:'bold'});
        const $buttons = $('<div></div>').css({display:'flex', flexWrap:'wrap', gap:'6px', marginTop:'8px'});

        const $copy = $('<button type="button" class="btn">Code kopieren</button>').on('click', async function () {
            $area.val(encodeTeamCode(buildCurrentTeamConfig())).trigger('select');
            try {
                await navigator.clipboard.writeText($area.val());
                $status.text('Teamcode wurde kopiert.').css('color', '#126b16');
            } catch (e) {
                document.execCommand('copy');
                $status.text('Teamcode wurde markiert/kopiert.').css('color', '#126b16');
            }
        });

        const $import = $('<button type="button" class="btn">Code importieren</button>').on('click', function () {
            try {
                const imported = decodeTeamCode($area.val());
                localStorage.setItem(TEAMCODE_STORAGE_KEY, JSON.stringify(imported));
                $status.text('Import erfolgreich. Die Seite wird neu geladen.').css('color', '#126b16');
                setTimeout(function () { location.reload(); }, 350);
            } catch (e) {
                $status.text(e && e.message ? e.message : 'Import fehlgeschlagen.').css('color', '#a40000');
            }
        });

        const $reset = $('<button type="button" class="btn">Teamcode-Einstellungen löschen</button>').on('click', function () {
            localStorage.removeItem(TEAMCODE_STORAGE_KEY);
            $status.text('Gespeicherte Team-Einstellungen gelöscht. Die Seite wird neu geladen.').css('color', '#126b16');
            setTimeout(function () { location.reload(); }, 350);
        });

        const $close = $('<button type="button" class="btn">Schließen</button>').on('click', function () { $overlay.remove(); });
        $buttons.append($copy, $import, $reset, $close);
        $box.append($title, $hint, $area, $status, $buttons);
        $overlay.append($box).on('click', function (e) { if (e.target === this) $overlay.remove(); });
        $('body').append($overlay);
    }

    function ensureTeamCodeButton() {
        if ($('#twcc-ao-teamcode-button').length) return;
        const $button = $('<button id="twcc-ao-teamcode-button" type="button" class="btn">AO Teamcode</button>').css({
            position: 'fixed', right: '10px', bottom: '10px', zIndex: 999998,
            padding: '5px 9px', fontWeight: 'bold'
        }).on('click.twccAO', function (event) {
            event.preventDefault();
            showTeamCodeDialog();
        });
        $('body').append($button);
    }

    function init() {
        if (!document.body) {
            setTimeout(init, 100);
            return;
        }

        ensureButtonStyles();
        ensureTeamCodeButton();
        scan();

        const Observer = win.MutationObserver || window.MutationObserver;
        observer = new Observer(scheduleScan);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Einige Übersichten laden die Angriffstabelle verzögert per AJAX.
        setTimeout(scan, 500);
        setTimeout(scan, 1500);
        setTimeout(scan, 3500);

        console.log('[TWCC Attack Organizer] gestartet.', {
            href: location.href,
            buttons: buttonNames.length,
            layout: attackLayout,
            incomingRows: getIncomingRows().length
        });
    }

    function destroy() {
        if (observer) observer.disconnect();
        observer = null;
        $(document).off('.twccAO');
        $('.twcc-ao-button').off('.twccAO');
        $('.twcc-ao-buttons').remove();
        $('#twcc-ao-teamcode-button, #twcc-ao-teamcode-dialog').remove();
        $('[data-twcc-ao-ready]').removeAttr('data-twcc-ao-ready');
        console.log('[TWCC Attack Organizer] beendet.');
    }

    win.TWCC_AttackOrganizerLoaded = true;

    win.TWCC_AttackOrganizer = {
        version: '3.6.0-teamcode',
        init,
        destroy,
        refresh: scan
    };

    if (document.readyState === 'loading') {
        $(init);
    } else {
        init();
    }
})();
