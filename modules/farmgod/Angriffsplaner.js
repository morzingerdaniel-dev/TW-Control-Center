// ==UserScript==
// @name         TWCC Angriffsplaner
// @namespace    TWCC-Test
// @version      1.6
// @description  TWCC Angriffsplaner SAFE Rollback - seriell ohne Auto-Close
// @author       Daniel 
// @match        https://*.die-staemme.de/game.php*
// @match        https://*.tribalwars.net/game.php*
// @match        https://*.tribalwars.*/*game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'TWCC_DSU_TEST_VILLAGE_MAP';
    const PLAN_KEY = 'TWCC_DSU_TEST_PLAN';
    const RAW_KEY = 'TWCC_DSU_TEST_PLAN_RAW';
    const ACTIVE_KEY = 'TWCC_DSU_TEST_ACTIVE_ATTACK';
    const QUEUE_KEY = 'TWCC_DSU_TEST_QUEUE_RUNNING';
    const QUEUE_PAUSE_KEY = 'TWCC_DSU_TEST_QUEUE_PAUSED';
    const TIMING_DEFAULT_MS_KEY = 'TWCC_DSU_TIMING_DEFAULT_MS';
    const TIMING_OFFSET_KEY = 'TWCC_DSU_TIMING_OFFSET_MS';
    const TIMING_STATS_KEY = 'TWCC_DSU_TIMING_STATS';
    const TIMING_AUTOCALIB_KEY = 'TWCC_DSU_TIMING_AUTOCALIB';
    const TIMING_CALIB_LIMIT_KEY = 'TWCC_DSU_TIMING_CALIB_LIMIT';
    const AUTO_CLOSE_KEY = 'TWCC_DSU_AUTO_CLOSE_TAB';
    const CLOSE_MARKER_KEY = 'TWCC_DSU_CLOSE_MARKER';

    const TEMPLATE_MAP = {
        ramme: 'volle off',
        rammen: 'volle off',
        ram: 'volle off',
        catapult: 'volle off',
        kata: 'volle off',
        ag: 'AG1',
        snob: 'AG1',
        noble: 'AG1',
        axt: 'Fake',
        axe: 'Fake',
        fake: 'Fake'
    };

    function log(...args) {
        console.log('[TWCC-DSU-P1]', ...args);
    }

    function toast(msg) {
        let el = document.getElementById('twcc-dsu-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'twcc-dsu-toast';
            el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:999999;background:#6f4e2e;color:white;padding:10px 14px;border-radius:8px;font-weight:bold;box-shadow:0 2px 10px rgba(0,0,0,.25);';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.style.opacity = '0', 2200);
    }

    function getParams() {
        return new URLSearchParams(window.location.search);
    }

    function getScreen() {
        return getParams().get('screen') || '';
    }

    function saveJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function loadJson(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key)) || fallback;
        } catch (e) {
            return fallback;
        }
    }

    function coordFromText(text) {
        const m = String(text || '').match(/\b(\d{3})\|(\d{3})\b/);
        return m ? `${m[1]}|${m[2]}` : '';
    }

    function villageIdFromHref(href) {
        const m = String(href || '').match(/[?&]village=(\d+)/);
        return m ? m[1] : '';
    }

    function normalizeUnit(unit) {
        return String(unit || '').trim().toLowerCase();
    }

    function getTemplateName(unit) {
        return TEMPLATE_MAP[normalizeUnit(unit)] || unit || '';
    }

    function scanOwnVillages() {
        const map = loadJson(STORAGE_KEY, {});
        const links = Array.from(document.querySelectorAll('a[href*="village="]'));

        links.forEach(a => {
            const coord = coordFromText(a.textContent) || coordFromText(a.closest('tr')?.textContent || '');
            const id = villageIdFromHref(a.href);
            if (coord && id) map[coord] = id;
        });

        saveJson(STORAGE_KEY, map);
        log('Village map gespeichert:', map);
        return map;
    }


    function normalizeDsuDate(str) {
        const m = String(str || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?$/);
        if (!m) return str;
        const ms = m[7] !== undefined ? '.' + String(m[7]).padEnd(3, '0').slice(0, 3) : '';
        return `${pad(m[3])}.${pad(m[2])}.${m[1]} ${pad(m[4])}:${m[5]}:${m[6]}${ms}`;
    }

    function parseDsuBBCode(text) {
        const source = String(text || '');
        if (!source.includes('[coord]') || !source.includes('[unit]') || !source.includes('game.php?village=')) return [];

        const lines = source.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes('[coord]') && l.includes('[unit]'));
        const result = [];

        const re = /(?:Offensiv|Defensiv)?\s*von\s+\[b\]([^\[]+?)\[\/b\]\s+aus\s+\[coord\](\d{3}\|\d{3})\[\/coord\]\s+mit\s+\[unit\]([a-z_]+)\[\/unit\]\s+auf\s+\[b\]([^\[]+?)\[\/b\]\s+.*?\[coord\](\d{3}\|\d{3})\[\/coord\]\s+startet\s+am\s+\[color=[^\]]+\]([0-9-]+\s+[0-9:]+)\[\/color\]\s+und\s+kommt\s+am\s+\[color=[^\]]+\]([0-9-]+\s+[0-9:]+)\[\/color\]\s+an\s+\(\[url="([^"]+)"\]/i;

        lines.forEach((line, idx) => {
            const m = line.match(re);
            if (!m) {
                result.push({ ok: false, status: 'error', line: idx + 1, raw: line, error: 'BBCode-Zeile nicht erkannt' });
                return;
            }

            const url = m[8];
            const villageMatch = url.match(/[?&]village=(\d+)/);
            const targetMatch = url.match(/[?&]target=(\d+)/);

            result.push({
                id: 'dsu-bb-' + Date.now() + '-' + idx,
                source: 'dsu-bbcode',
                ok: true,
                status: 'open',
                line: idx + 1,
                villageId: villageMatch ? villageMatch[1] : '',
                targetId: targetMatch ? targetMatch[1] : '',
                fromName: m[1].trim(),
                from: m[2],
                unit: m[3].trim(),
                toName: m[4].trim(),
                to: m[5],
                send: normalizeDsuDate(m[6]),
                arrival: normalizeDsuDate(m[7]),
                raw: line
            });
        });

        return result;
    }


    function parseDsuText(text) {
        const bb = parseDsuBBCode(text);
        if (bb.length) return bb;

        const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const result = [];

        const fullRe = /(?:✅|•|\-|\*)?\s*(\d{3}\|\d{3})\s*\(([^)]*)\)\s*→\s*(\d{3}\|\d{3})\s*\(([^)]*)\)\s*\|\s*Abschicken:\s*([0-9.]+\s+[0-9:]+(?:\.\d{1,3})?)(?:\s*\|\s*Ankunft:\s*([0-9.]+\s+[0-9:.]+))?(?:\s*\|\s*Einheit:\s*(.+))?$/i;
        const shortRe = /(?:✅|•|\-|\*)?\s*(\d{3}\|\d{3}).*?→\s*(\d{3}\|\d{3}).*?Abschicken:\s*([0-9.]+\s+[0-9:]+(?:\.\d{1,3})?)(?:.*?Einheit:\s*(.+))?$/i;

        lines.forEach((line, idx) => {
            let m = line.match(fullRe);
            if (m) {
                result.push({
                    id: 'dsu-' + Date.now() + '-' + idx,
                    ok: true,
                    status: 'open',
                    line: idx + 1,
                    from: m[1],
                    fromName: m[2] || '',
                    to: m[3],
                    toName: m[4] || '',
                    send: m[5],
                    arrival: m[6] || '',
                    unit: (m[7] || '').trim() || 'Ramme',
                    raw: line
                });
                return;
            }

            m = line.match(shortRe);
            if (m) {
                result.push({
                    id: 'dsu-' + Date.now() + '-' + idx,
                    ok: true,
                    status: 'open',
                    line: idx + 1,
                    from: m[1],
                    fromName: '',
                    to: m[2],
                    toName: '',
                    send: m[3],
                    arrival: '',
                    unit: (m[4] || '').trim() || 'Ramme',
                    raw: line
                });
                return;
            }

            result.push({ ok: false, status: 'error', line: idx + 1, raw: line, error: 'Nicht erkannt' });
        });

        return result;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[c]));
    }

    function updatePlanItem(id, patch) {
        const plan = loadJson(PLAN_KEY, []);
        const idx = plan.findIndex(p => p.id === id);
        if (idx >= 0) {
            plan[idx] = Object.assign({}, plan[idx], patch);
            saveJson(PLAN_KEY, plan);
        }
        return plan;
    }

    function isAttackExpired(attack) {
        try {
            const timing = getSendTimingInfo(attack.send);
            if (!timing) return false;
            return timing.clickMs <= getCurrentServerMs() + 250;
        } catch (e) {
            return false;
        }
    }

    function markExpiredAttacks() {
        const plan = loadJson(PLAN_KEY, []);
        let changed = false;

        plan.forEach(p => {
            if (!p.ok) return;
            if (['submitted_test', 'submitted', 'done', 'error', 'expired', 'not_enough_troops'].includes(p.status)) return;

            if (isAttackExpired(p)) {
                p.status = 'expired';
                p.error = 'Abschickzeit liegt in der Vergangenheit';
                changed = true;
            }
        });

        if (changed) saveJson(PLAN_KEY, plan);
        return plan;
    }

    function getNextOpenAttack() {
        const plan = markExpiredAttacks();
        return plan.find(p => p.ok && (!p.status || p.status === 'open') && !isAttackExpired(p));
    }

    function detectNotEnoughTroopsText() {
        const txt = (document.body.innerText || '').toLowerCase();
        const patterns = [
            'nicht genügend',
            'zu wenig',
            'nicht genug',
            'nicht ausreichend',
            'nicht genügend einheiten',
            'nicht genügend truppen',
            'nicht genug truppen',
            'nicht genug einheiten'
        ];
        return patterns.find(p => txt.includes(p)) || '';
    }

    function failActiveAttack(status, errorText) {
        const active = loadJson(ACTIVE_KEY, null);
        if (!active?.id) return;

        updatePlanItem(active.id, { status, error: errorText || status, failedAt: Date.now() });
        localStorage.removeItem(ACTIVE_KEY);

        toast(errorText || status);
        log('Aktiver Angriff fehlgeschlagen:', status, errorText);

        if (isQueueRunning() && !isQueuePaused()) {
            setTimeout(() => queueTick(status), 1200);
        }
    }



    function isQueueRunning() {
        return localStorage.getItem(QUEUE_KEY) === '1';
    }

    function setQueueRunning(value) {
        localStorage.setItem(QUEUE_KEY, value ? '1' : '0');
    }

    function isQueuePaused() {
        return localStorage.getItem(QUEUE_PAUSE_KEY) === '1';
    }

    function setQueuePaused(value) {
        localStorage.setItem(QUEUE_PAUSE_KEY, value ? '1' : '0');
    }

    function getQueueStats() {
        const plan = loadJson(PLAN_KEY, []);
        const okPlan = plan.filter(p => p.ok);
        const done = okPlan.filter(p => ['submitted_test', 'submitted', 'done'].includes(p.status)).length;
        const open = okPlan.filter(p => (!p.status || p.status === 'open')).length;
        const errors = okPlan.filter(p => p.status === 'error' || p.status === 'submit_failed' || p.status === 'expired' || p.status === 'not_enough_troops').length;
        const working = okPlan.filter(p => ['preparing', 'confirm_opening', 'confirm_ready'].includes(p.status)).length;
        return { total: okPlan.length, done, open, errors, working };
    }

    function startQueue() {
        setQueueRunning(true);
        setQueuePaused(false);

        const active = loadJson(ACTIVE_KEY, null);
        if (active && ['phase1-auto', 'confirm-opened', 'confirm-ready'].includes(active.phase)) {
            toast('Angriffe laufen bereits mit aktivem Angriff');
            return;
        }

        markExpiredAttacks();
        toast('Angriffe gestartet');
        queueTick('start');
    }

    function pauseQueue() {
        setQueuePaused(true);
        toast('Angriffe pausiert');
    }

    function resumeQueue() {
        setQueuePaused(false);
        setQueueRunning(true);
        markExpiredAttacks();
        toast('Angriffe fortgesetzt');
        queueTick('resume');
    }

    function stopQueue() {
        setQueueRunning(false);
        setQueuePaused(false);
        clearPhase2Timer?.();
        toast('Angriffe gestoppt');
    }

    function queueTick(reason = 'tick') {
        log('Angriffe tick:', reason, { running: isQueueRunning(), paused: isQueuePaused(), stats: getQueueStats() });

        if (!isQueueRunning() || isQueuePaused()) return;

        const active = loadJson(ACTIVE_KEY, null);
        if (active && ['phase1-auto', 'confirm-opened', 'confirm-ready'].includes(active.phase)) {
            log('Angriffe warten auf aktiven Angriff:', active.phase);
            return;
        }

        const next = getNextOpenAttack();
        if (!next) {
            setQueueRunning(false);
            toast('Angriffe fertig: keine offenen Angriffe');
            log('Angriffe fertig');
            return;
        }

        openPlaceForAttack(next, true);
    }


    function openPlaceForAttack(attack, auto = false) {
        if (isAttackExpired(attack)) {
            updatePlanItem(attack.id, { status: 'expired', error: 'Abschickzeit liegt in der Vergangenheit' });
            toast('Übersprungen: abgelaufen ' + attack.from + ' → ' + attack.to);
            if (auto && isQueueRunning() && !isQueuePaused()) setTimeout(() => queueTick('expired-open-guard'), 400);
            return;
        }

        const villageMap = loadJson(STORAGE_KEY, {});
        const villageId = attack.villageId || villageMap[attack.from];

        if (!villageId) {
            alert('Keine village_id für Startdorf ' + attack.from + ' gefunden. Bei BBCode sollte village= im Link stehen, sonst erst Übersicht scannen.');
            return;
        }

        const [x, y] = attack.to.split('|');

        const active = Object.assign({}, attack, {
            villageId,
            phase: auto ? 'phase1-auto' : 'manual-open',
            openedByAngriffsplaner: auto,
            startedAt: Date.now()
        });

        saveJson(ACTIVE_KEY, active);
        updatePlanItem(attack.id, { status: auto ? 'preparing' : 'opened' });

        const targetParam = attack.targetId ? `&target=${encodeURIComponent(attack.targetId)}` : '';
        const url = `/game.php?village=${encodeURIComponent(villageId)}&screen=place${targetParam}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`;
        openManagedTab(attack.id, url);
    }

    function startNextPhase1() {
        const attack = getNextOpenAttack();
        if (!attack) {
            toast('Kein offener Angriff im Plan');
            return;
        }

        toast('Phase 1 startet: ' + attack.from + ' → ' + attack.to);
        openPlaceForAttack(attack, true);
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function textOf(el) {
        return String(el?.textContent || el?.value || el?.title || el?.getAttribute?.('aria-label') || '').trim();
    }

    function findByText(selectors, wantedText) {
        const wanted = String(wantedText || '').trim().toLowerCase();
        if (!wanted) return null;

        const els = Array.from(document.querySelectorAll(selectors.join(','))).filter(isVisible);

        return els.find(el => textOf(el).toLowerCase() === wanted)
            || els.find(el => textOf(el).toLowerCase().includes(wanted))
            || null;
    }

    function findTemplateButton(templateName) {
        const selectors = [
            'a',
            'button',
            'input[type="button"]',
            'input[type="submit"]',
            '.btn',
            '.troop_template_selector',
            '[data-template-id]',
            '[data-title]'
        ];

        return findByText(selectors, templateName);
    }

    function setTargetCoords(to) {
        const [x, y] = String(to || '').split('|');

        const xInput =
            document.querySelector('input[name="x"]') ||
            document.querySelector('#inputx') ||
            document.querySelector('#target_x');

        const yInput =
            document.querySelector('input[name="y"]') ||
            document.querySelector('#inputy') ||
            document.querySelector('#target_y');

        if (xInput && yInput) {
            xInput.value = x;
            yInput.value = y;
            xInput.dispatchEvent(new Event('input', { bubbles: true }));
            yInput.dispatchEvent(new Event('input', { bubbles: true }));
            xInput.dispatchEvent(new Event('change', { bubbles: true }));
            yInput.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        const combined =
            document.querySelector('input[name="target"]') ||
            document.querySelector('input[name="coord"]') ||
            document.querySelector('input[placeholder*="000|000"]');

        if (combined) {
            combined.value = to;
            combined.dispatchEvent(new Event('input', { bubbles: true }));
            combined.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        return false;
    }

    function findAttackButton() {
        return (
            document.querySelector('#target_attack') ||
            document.querySelector('input[name="attack"]') ||
            document.querySelector('button[name="attack"]') ||
            Array.from(document.querySelectorAll('input, button, a')).find(el => {
                if (!isVisible(el)) return false;
                const txt = textOf(el).toLowerCase();
                return txt.includes('angriff') || txt.includes('attack');
            }) ||
            null
        );
    }

    function safeClick(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (e) {}
        try {
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.click();
            return true;
        } catch (e) {
            try {
                el.click();
                return true;
            } catch (_) {
                return false;
            }
        }
    }

    async function phase1AutoOnPlace() {
        if (getScreen() !== 'place') return;

        const active = loadJson(ACTIVE_KEY, null);
        if (!active || active.phase !== 'phase1-auto') return;

        if (active.done) return;

        if (isAttackExpired(active)) {
            failActiveAttack('expired', 'Abschickzeit liegt in der Vergangenheit');
            return;
        }

        log('Phase1 aktiv auf Place:', active);
        toast('Phase 1: Vorlage/Ziel/Angriff vorbereiten');

        await sleep(800);

        const targetOk = setTargetCoords(active.to);
        log('Ziel gesetzt:', targetOk, active.to);

        await sleep(500);

        const templateName = getTemplateName(active.unit);
        const templateBtn = findTemplateButton(templateName);

        if (!templateBtn) {
            log('Vorlage nicht gefunden:', templateName);
            toast('Vorlage nicht gefunden: ' + templateName);
            updatePlanItem(active.id, { status: 'error', error: 'Vorlage nicht gefunden: ' + templateName });
            if (isQueueRunning()) pauseQueue();
            return;
        }

        log('Vorlage gefunden:', templateName, templateBtn);
        safeClick(templateBtn);

        await sleep(900);

        // Nach Vorlagen-Klick sicherheitshalber Koordinaten nochmal setzen,
        // falls die Vorlage Eingaben verändert.
        setTargetCoords(active.to);

        await sleep(400);

        const attackBtn = findAttackButton();
        if (!attackBtn) {
            log('Angriff-Button nicht gefunden');
            toast('Angriff-Button nicht gefunden');
            updatePlanItem(active.id, { status: 'error', error: 'Angriff-Button nicht gefunden' });
            if (isQueueRunning()) pauseQueue();
            return;
        }

        log('Angriff-Button gefunden:', attackBtn);
        toast('Klicke Angriff bis Confirm');
        updatePlanItem(active.id, { status: 'confirm_opening' });

        // active bleibt gespeichert, damit Confirm-Seite ihn später in Phase 2 nutzen kann.
        active.phase = 'confirm-opened';
        active.templateName = templateName;
        active.targetSet = targetOk;
        active.attackClickedAt = Date.now();
        saveJson(ACTIVE_KEY, active);

        await sleep(300);
        safeClick(attackBtn);

        setTimeout(() => {
            const current = loadJson(ACTIVE_KEY, null);
            if (!current || current.id !== active.id) return;

            const params = getParams();
            const stillPlace = getScreen() === 'place' && params.get('try') !== 'confirm';

            if (!stillPlace) return;

            const reason = detectNotEnoughTroopsText();
            if (reason) {
                failActiveAttack('not_enough_troops', 'Zu wenig Truppen / ' + reason);
                return;
            }

            // Wenn nach dem Angriffsklick keine Confirm-Seite kam, behandeln wir es als Vorbereitungsfehler.
            failActiveAttack('error', 'Confirm-Seite wurde nicht geöffnet');
        }, 3200);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function getTwccTabManager() {
        // Wichtig: Im Angriffstab existiert ggf. ein eigener TWCC, aber der hat die Tab-Referenz nicht.
        // Deshalb zuerst den opener/Main-Tab prüfen.
        try {
            if (window.opener && !window.opener.closed && window.opener.TWCC && window.opener.TWCC.TabManager) {
                console.log('[TWCC Angriffsplaner] TabManager über opener gefunden');
                return window.opener.TWCC.TabManager;
            }
        } catch (e) {
            console.warn('[TWCC Angriffsplaner] opener TabManager nicht erreichbar', e);
        }

        try {
            if (window.TWCC && window.TWCC.TabManager) {
                console.log('[TWCC Angriffsplaner] TabManager über window gefunden');
                return window.TWCC.TabManager;
            }
        } catch (e) {}

        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.TWCC && unsafeWindow.TWCC.TabManager) {
                console.log('[TWCC Angriffsplaner] TabManager über unsafeWindow gefunden');
                return unsafeWindow.TWCC.TabManager;
            }
        } catch (e) {}

        console.warn('[TWCC Angriffsplaner] Kein TabManager gefunden');
        return null;
    }



    function openManagedTab(id, url) {
        const tm = getTwccTabManager();
        const cleanId = String(id || 'tab').replace(/[^a-zA-Z0-9_-]/g, '_');

        if (tm && typeof tm.open === 'function') {
            console.log('[TWCC Angriffsplaner] open -> TabManager', cleanId, url);
            return tm.open(cleanId, url);
        }

        console.warn('[TWCC Angriffsplaner] open fallback window.open', cleanId, url);
        return openManagedTab(attack.id, url);
    }



    function closeManagedTab(id) {
        const cleanId = String(id || 'tab').replace(/[^a-zA-Z0-9_-]/g, '_');
        console.log('[TWCC Angriffsplaner] closeManagedTab', cleanId);

        const tm = getTwccTabManager();

        if (tm && typeof tm.requestClose === 'function') {
            console.log('[TWCC Angriffsplaner] requestClose -> TabManager', cleanId);
            tm.requestClose(cleanId, 'angriff-gesendet');
        } else if (tm && typeof tm.close === 'function') {
            console.log('[TWCC Angriffsplaner] close -> TabManager', cleanId);
            tm.close(cleanId);
        }

        // Broadcast/localStorage immer zusätzlich senden, auch wenn ein TabManager gefunden wurde.
        try {
            const payload = { id: cleanId, reason: 'angriff-gesendet', at: Date.now() };
            localStorage.setItem('TWCC_TAB_CLOSE_REQUEST', JSON.stringify(payload));
            setTimeout(() => localStorage.removeItem('TWCC_TAB_CLOSE_REQUEST'), 50);

            if (window.BroadcastChannel) {
                const bc = new BroadcastChannel('TWCC_TAB_MANAGER');
                bc.postMessage({ type: 'close', payload });
                setTimeout(() => bc.close(), 300);
            }
            console.log('[TWCC Angriffsplaner] CloseRequest gesendet', payload);
        } catch (e) {
            console.warn('[TWCC Angriffsplaner] CloseRequest Fehler', e);
        }

        // Fallback: Tab versucht sich selbst zu schließen.
        setTimeout(() => {
            try {
                console.log('[TWCC Angriffsplaner] window.close fallback');
                window.close();
            } catch (e) {
                console.warn('[TWCC Angriffsplaner] window.close fallback fehlgeschlagen', e);
            }
        }, 1200);

        return true;
    }







    function isAutoCloseEnabled() {
        // SAFE v1.6: Auto-Close deaktiviert, bis TabManager mit harter Sperre neu gebaut ist.
        return false;
    }

    function setAutoCloseEnabled(value) {
        localStorage.setItem(AUTO_CLOSE_KEY, value ? '1' : '0');
    }

    function setCloseMarker(active, reason) {
        if (!active || !active.id) return;
        const marker = {
            id: active.id,
            villageId: active.villageId || '',
            from: active.from,
            to: active.to,
            reason: reason || 'submitted',
            at: Date.now()
        };
        localStorage.setItem(CLOSE_MARKER_KEY, JSON.stringify(marker));
    }

    function maybeAutoCloseThisTab() {
        if (!isAutoCloseEnabled()) return;
        const marker = loadJson(CLOSE_MARKER_KEY, null);
        if (!marker) return;

        const params = getParams();
        const currentVillage = params.get('village') || '';

        // Nur Tabs schließen, die sehr wahrscheinlich vom Angriffsplaner geöffnet wurden.
        const isSameVillage = !marker.villageId || marker.villageId === currentVillage;
        const fresh = Date.now() - Number(marker.at || 0) < 20000;

        if (!fresh || !isSameVillage) return;

        console.log('[TWCC Angriffsplaner] Tab wird nach Senden geschlossen', marker);
        localStorage.removeItem(CLOSE_MARKER_KEY);

        setTimeout(() => {
            closeManagedTab(marker.id);
        }, 600);
    }


    function getStatusInfo(status, error) {
        const s = status || 'open';

        const map = {
            open: { color: '#2f80ed', label: 'offen' },
            preparing: { color: '#f2c94c', label: 'wird vorbereitet' },
            opened: { color: '#56ccf2', label: 'Place geöffnet' },
            confirm_opening: { color: '#bb6bd9', label: 'Confirm öffnet' },
            confirm_ready: { color: '#9b51e0', label: 'Confirm bereit' },
            submitted_test: { color: '#27ae60', label: 'gesendet' },
            submitted: { color: '#27ae60', label: 'gesendet' },
            done: { color: '#27ae60', label: 'fertig' },
            expired: { color: '#eb5757', label: 'abgelaufen' },
            not_enough_troops: { color: '#f2994a', label: 'zu wenig Truppen' },
            error: { color: '#eb5757', label: 'Fehler' },
            submit_failed: { color: '#eb5757', label: 'Submit fehlgeschlagen' }
        };

        const info = map[s] || { color: '#828282', label: s };
        return {
            color: info.color,
            label: error ? `${info.label}: ${error}` : info.label
        };
    }

    function renderStatusBadge(status, error) {
        const info = getStatusInfo(status, error);
        return `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">
            <span style="width:10px;height:10px;border-radius:50%;background:${info.color};display:inline-block;border:1px solid rgba(0,0,0,.35);"></span>
            <span>${escapeHtml(info.label)}</span>
        </span>`;
    }

    function getRowBgByStatus(status) {
        switch (status) {
            case 'submitted_test':
            case 'submitted':
            case 'done':
                return 'background:#d9f7d9;';
            case 'preparing':
            case 'opened':
            case 'confirm_opening':
            case 'confirm_ready':
                return 'background:#fff3bf;';
            case 'not_enough_troops':
                return 'background:#ffe0bd;';
            case 'expired':
            case 'error':
            case 'submit_failed':
                return 'background:#ffd6d6;';
            default:
                return '';
        }
    }


    function renderPreview(plan) {
        const villageMap = loadJson(STORAGE_KEY, {});
        const rows = plan.map((p, i) => {
            if (!p.ok) {
                return `<tr style="background:#ffd6d6;"><td>${p.line}</td><td colspan="11">${escapeHtml(p.raw)}<br><b>${escapeHtml(p.error)}</b></td></tr>`;
            }

            const vid = p.villageId || villageMap[p.from] || '';
            const status = vid ? '✅ gefunden' : '❌ fehlt';
            const template = getTemplateName(p.unit);
            const state = (p.status || 'open') + (p.error ? ' · ' + p.error : '');

            const rowBg = getRowBgByStatus(p.status);

            return `<tr style="${rowBg}">
                <td>${i + 1}</td>
                <td>${escapeHtml(p.from)}</td>
                <td>${escapeHtml(vid)}</td>
                <td>${escapeHtml(p.to)}</td>
                <td>${escapeHtml(p.targetId || '-')}</td>
                <td>${escapeHtml(p.send)}</td>
                <td>${escapeHtml(p.arrival || '-')}</td>
                <td>${escapeHtml(p.unit)}</td>
                <td>${escapeHtml(template)}</td>
                <td>${renderStatusBadge(p.status, p.error)}</td>
                <td>${status}</td>
                <td><button class="twcc-dsu-open" data-index="${i}" ${vid ? '' : 'disabled'}>Dorf öffnen</button></td>
            </tr>`;
        }).join('');

        return `<table style="width:100%; border-collapse:collapse; font-size:12px;" border="1" cellpadding="4">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Start</th>
                    <th>Village-ID</th>
                    <th>Ziel</th>
                    <th>Target-ID</th>
                    <th>Abschickzeit</th>
                    <th>Ankunft</th>
                    <th>Einheit</th>
                    <th>Vorlage</th>
                    <th>Status</th>
                    <th>Map</th>
                    <th>Test</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function createWindow() {
        let win = document.getElementById('twcc-dsu-p1');
        if (win) {
            win.style.display = '';
            return;
        }

        win = document.createElement('div');
        win.id = 'twcc-dsu-p1';
        win.style.cssText = [
            'position:fixed',
            'top:90px',
            'left:90px',
            'width:980px',
            'height:660px',
            'z-index:999999',
            'background:#f4e4bc',
            'border:2px solid #6f4e2e',
            'border-radius:8px',
            'box-shadow:0 4px 16px rgba(0,0,0,.35)',
            'font:12px Arial,sans-serif',
            'color:#2b1a08',
            'resize:both',
            'overflow:auto'
        ].join(';');

        win.innerHTML = `
            <div id="twcc-dsu-head" style="background:#6f4e2e;color:white;padding:8px;cursor:move;font-weight:bold;">
                📋 TWCC Angriffsplaner
                <button id="twcc-dsu-close" style="float:right;">×</button>
            </div>
            <div style="padding:10px;">
                <div style="margin-bottom:8px;">
                    <button id="twcc-dsu-scan">Eigene Dörfer scannen</button>
                    <button id="twcc-dsu-showmap">Village-Map anzeigen</button>
                    <button id="twcc-dsu-start">Angriff vorbereiten</button>
                    <button id="twcc-dsu-queue-start">Angriffe starten</button>
                    <button id="twcc-dsu-queue-pause">Pause</button>
                    <button id="twcc-dsu-queue-resume">Fortsetzen</button>
                    <button id="twcc-dsu-queue-stop">Angriffe Stop</button>
                    <button id="twcc-dsu-resetstatus">Status zurücksetzen</button>
                    <button id="twcc-dsu-clear">Daten löschen</button>
                    <span id="twcc-dsu-status" style="margin-left:10px;font-weight:bold;"></span>
                </div>

                <div style="background:#fff8e8;border:1px solid #c7a76b;border-radius:6px;padding:8px;margin-bottom:8px;">
                    <b>Vorlagen-Mapping:</b>
                    Ramme/Katapult → volle off · AG → AG1 · Axt → Fake
                </div>

                <textarea id="twcc-dsu-text" style="width:100%;height:170px;" placeholder="DS-Ultimate Copy-Liste hier einfügen..."></textarea>

                <div style="margin:8px 0;">
                    <button id="twcc-dsu-parse">Prüfen / Vorschau</button>
                    <button id="twcc-dsu-save">Plan speichern</button>
                </div>

                <div id="twcc-dsu-preview"></div>
            </div>
        `;

        document.body.appendChild(win);

        const textarea = document.getElementById('twcc-dsu-text');
        textarea.value = localStorage.getItem(RAW_KEY) || '';

        let currentPlan = loadJson(PLAN_KEY, []);

        function refreshPreview() {
            markExpiredAttacks();
            currentPlan = loadJson(PLAN_KEY, currentPlan || []);
            document.getElementById('twcc-dsu-preview').innerHTML = renderPreview(currentPlan);

            document.querySelectorAll('.twcc-dsu-open').forEach(btn => {
                btn.onclick = () => openPlaceForAttack(currentPlan[parseInt(btn.dataset.index, 10)], false);
            });

            const ok = currentPlan.filter(p => p.ok).length;
            const bad = currentPlan.length - ok;
            const missing = currentPlan.filter(p => p.ok && !loadJson(STORAGE_KEY, {})[p.from]).length;
            document.getElementById('twcc-dsu-status').textContent = `${ok} erkannt, ${bad} Fehler, ${missing} ohne village_id`;
        }

        document.getElementById('twcc-dsu-close').onclick = () => win.style.display = 'none';

        document.getElementById('twcc-dsu-scan').onclick = () => {
            const map = scanOwnVillages();
            document.getElementById('twcc-dsu-status').textContent = `${Object.keys(map).length} Dörfer gespeichert`;
            refreshPreview();
        };

        document.getElementById('twcc-dsu-showmap').onclick = () => {
            const map = loadJson(STORAGE_KEY, {});
            document.getElementById('twcc-dsu-preview').innerHTML = `<pre style="background:white;padding:8px;max-height:350px;overflow:auto;">${escapeHtml(JSON.stringify(map, null, 2))}</pre>`;
        };

        document.getElementById('twcc-dsu-start').onclick = startNextPhase1;
        document.getElementById('twcc-dsu-queue-start').onclick = startQueue;
        document.getElementById('twcc-dsu-queue-pause').onclick = pauseQueue;
        document.getElementById('twcc-dsu-queue-resume').onclick = resumeQueue;
        document.getElementById('twcc-dsu-queue-stop').onclick = stopQueue;

        document.getElementById('twcc-dsu-resetstatus').onclick = () => {
            const plan = loadJson(PLAN_KEY, []).map(p => p.ok ? Object.assign({}, p, { status: 'open', error: '' }) : p);
            saveJson(PLAN_KEY, plan);
            localStorage.removeItem(ACTIVE_KEY);
            setQueueRunning(false);
            setQueuePaused(false);
            currentPlan = plan;
            refreshPreview();
            toast('Status zurückgesetzt');
        };

        document.getElementById('twcc-dsu-clear').onclick = () => {
            if (!confirm('Testdaten löschen?')) return;
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(PLAN_KEY);
            localStorage.removeItem(RAW_KEY);
            localStorage.removeItem(ACTIVE_KEY);
            localStorage.removeItem(QUEUE_KEY);
            localStorage.removeItem(QUEUE_PAUSE_KEY);
            currentPlan = [];
            document.getElementById('twcc-dsu-status').textContent = 'gelöscht';
            document.getElementById('twcc-dsu-preview').innerHTML = '';
        };

        document.getElementById('twcc-dsu-parse').onclick = () => {
            currentPlan = parseDsuText(textarea.value);
            saveJson(PLAN_KEY, currentPlan);
            localStorage.setItem(RAW_KEY, textarea.value);
            refreshPreview();
        };

        document.getElementById('twcc-dsu-save').onclick = () => {
            if (!currentPlan.length) currentPlan = parseDsuText(textarea.value);
            saveJson(PLAN_KEY, currentPlan);
            localStorage.setItem(RAW_KEY, textarea.value);
            alert(currentPlan.filter(p => p.ok).length + ' Angriffe gespeichert.');
            refreshPreview();
        };

        makeDraggable(win, document.getElementById('twcc-dsu-head'));
        refreshPreview();

        if (!win._twccLiveRefresh) {
            win._twccLiveRefresh = setInterval(() => {
                if (win.style.display === 'none') return;
                refreshPreview();
            }, 1200);
        }
    }

    function makeDraggable(panel, header) {
        let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;

        header.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            dragging = true;
            sx = e.clientX;
            sy = e.clientY;
            const r = panel.getBoundingClientRect();
            sl = r.left;
            st = r.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = Math.max(0, sl + e.clientX - sx) + 'px';
            panel.style.top = Math.max(0, st + e.clientY - sy) + 'px';
        });

        document.addEventListener('mouseup', () => dragging = false);
    }

    function addLauncher() {
        if (document.getElementById('twcc-dsu-launch')) return;

        const btn = document.createElement('button');
        btn.id = 'twcc-dsu-launch';
        btn.textContent = 'Angriffsplaner';
        btn.style.cssText = [
            'position:fixed',
            'right:10px',
            'bottom:55px',
            'z-index:999998',
            'background:#f4e4bc',
            'border:2px solid #6f4e2e',
            'border-radius:6px',
            'padding:6px 10px',
            'cursor:pointer'
        ].join(';');

        btn.onclick = createWindow;
        document.body.appendChild(btn);
    }


    // ======================
    // PHASE 2: Confirm / Timer Test
    // ======================

    const PHASE2_STATE = {
        armed: false,
        timeout: null,
        raf: null,
        tick: null
    };

    function pad(n, len = 2) {
        return String(n).padStart(len, '0');
    }

    function getTimingDefaultMs() {
        const v = Math.round(Number(localStorage.getItem(TIMING_DEFAULT_MS_KEY) ?? '200'));
        return Number.isFinite(v) ? Math.max(0, Math.min(999, v)) : 200;
    }

    function setTimingDefaultMs(v) {
        const n = Math.round(Number(String(v ?? '').replace(',', '.')));
        localStorage.setItem(TIMING_DEFAULT_MS_KEY, String(Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 200));
    }

    function getTimingOffsetMs() {
        const v = Math.round(Number(localStorage.getItem(TIMING_OFFSET_KEY) ?? '0'));
        return Number.isFinite(v) ? v : 0;
    }

    function setTimingOffsetMs(v) {
        const n = Math.round(Number(String(v ?? '').replace(',', '.')));
        localStorage.setItem(TIMING_OFFSET_KEY, String(Number.isFinite(n) ? n : 0));
    }

    function parseDateTimeDe(str) {
        const m = String(str || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
        if (!m) return null;

        const explicitMs = m[7] !== undefined;
        const ms = explicitMs
            ? Number(String(m[7]).padEnd(3, '0').slice(0, 3))
            : getTimingDefaultMs();

        const targetMs = new Date(
            Number(m[3]),
            Number(m[2]) - 1,
            Number(m[1]),
            Number(m[4]),
            Number(m[5]),
            Number(m[6]),
            ms
        ).getTime();

        return {
            raw: str,
            targetMs,
            ms,
            explicitMs,
            display: `${pad(m[4])}:${m[5]}:${m[6]}.${pad(ms, 3)}`,
            dateDisplay: `${pad(m[1])}.${pad(m[2])}.${m[3]} ${pad(m[4])}:${m[5]}:${m[6]}.${pad(ms, 3)}`,
            clickMs: targetMs + getTimingOffsetMs()
        };
    }

    function getSendTimingInfo(sendText) {
        const parsed = parseDateTimeDe(sendText);
        if (!parsed) return null;

        const offset = getTimingOffsetMs();
        return {
            ...parsed,
            offset,
            clickMs: parsed.targetMs + offset,
            clickDisplay: formatServerTime(parsed.targetMs + offset)
        };
    }


    function isAutoCalibEnabled() {
        return localStorage.getItem(TIMING_AUTOCALIB_KEY) !== '0';
    }

    function setAutoCalibEnabled(value) {
        localStorage.setItem(TIMING_AUTOCALIB_KEY, value ? '1' : '0');
    }

    function getCalibLimit() {
        const v = Math.round(Number(localStorage.getItem(TIMING_CALIB_LIMIT_KEY) ?? '300'));
        return Number.isFinite(v) ? Math.max(20, Math.min(1000, v)) : 300;
    }

    function setCalibLimit(value) {
        const v = Math.round(Number(String(value ?? '').replace(',', '.')));
        localStorage.setItem(TIMING_CALIB_LIMIT_KEY, String(Number.isFinite(v) ? Math.max(20, Math.min(1000, v)) : 300));
    }

    function calculateAutoCalib() {
        const stats = loadJson(TIMING_STATS_KEY, [])
            .filter(s => Number.isFinite(Number(s.diffMs)))
            .slice(-5);

        if (stats.length < 5) {
            return {
                ready: false,
                message: `${stats.length}/5 Werte gesammelt`,
                used: stats.map(s => Number(s.diffMs)),
                ignored: null,
                avg: null,
                correction: 0
            };
        }

        const values = stats.map(s => Number(s.diffMs));
        const rawAvg = values.reduce((a, b) => a + b, 0) / values.length;

        let ignoredIndex = -1;
        let maxDistance = -1;

        values.forEach((v, i) => {
            const dist = Math.abs(v - rawAvg);
            if (dist > maxDistance) {
                maxDistance = dist;
                ignoredIndex = i;
            }
        });

        const distances = values.map(v => Math.abs(v - rawAvg)).sort((a, b) => b - a);
        const biggest = distances[0] || 0;
        const second = distances[1] || 0;
        const removeOutlier = ignoredIndex >= 0 && biggest > 80 && biggest > second * 1.8;

        const used = removeOutlier ? values.filter((_, i) => i !== ignoredIndex) : values;
        const ignored = removeOutlier ? values[ignoredIndex] : null;
        const avg = used.reduce((a, b) => a + b, 0) / used.length;

        const limit = getCalibLimit();
        let correction = -Math.round(avg);
        correction = Math.max(-limit, Math.min(limit, correction));

        return {
            ready: true,
            message: `Ø ${avg >= 0 ? '+' : ''}${avg.toFixed(1)} ms · Korrektur ${correction >= 0 ? '+' : ''}${correction} ms` + (ignored !== null ? ` · Ausreißer ignoriert ${ignored >= 0 ? '+' : ''}${ignored} ms` : ''),
            used,
            ignored,
            avg,
            correction
        };
    }

    function applyAutoCalibIfReady() {
        if (!isAutoCalibEnabled()) return;
        const calc = calculateAutoCalib();

        if (!calc.ready) {
            log('AutoKalibrierung wartet:', calc.message);
            return;
        }

        if (!calc.correction) {
            log('AutoKalibrierung keine Korrektur nötig:', calc.message);
            return;
        }

        const oldOffset = getTimingOffsetMs();
        const newOffset = oldOffset + calc.correction;
        setTimingOffsetMs(newOffset);

        log(`AutoKalibrierung angewendet: Offset ${oldOffset} -> ${newOffset} (${calc.message})`);
        toast(`Auto-Kalibrierung: Offset ${newOffset} ms`);
    }


    function saveTimingStat(entry) {
        const stats = loadJson(TIMING_STATS_KEY, []);
        stats.push(Object.assign({ at: Date.now() }, entry));
        saveJson(TIMING_STATS_KEY, stats.slice(-50));
        applyAutoCalibIfReady();
    }

    function getTimingStatsSummary() {
        const stats = loadJson(TIMING_STATS_KEY, []).filter(s => Number.isFinite(Number(s.diffMs)));
        if (!stats.length) return 'Noch keine Werte';
        const diffs = stats.map(s => Number(s.diffMs));
        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const best = diffs.reduce((best, v) => Math.abs(v) < Math.abs(best) ? v : best, diffs[0]);
        const worst = diffs.reduce((worst, v) => Math.abs(v) > Math.abs(worst) ? v : worst, diffs[0]);
        const calib = calculateAutoCalib();
        return `Ø ${avg >= 0 ? '+' : ''}${avg.toFixed(1)} ms · Beste ${best >= 0 ? '+' : ''}${best.toFixed(0)} ms · Schlechteste ${worst >= 0 ? '+' : ''}${worst.toFixed(0)} ms · Kalib: ${calib.message}`;
    }



    function formatMs(ms) {
        if (!Number.isFinite(ms)) return '-';
        const sign = ms < 0 ? '-' : '';
        ms = Math.abs(ms);
        const h = Math.floor(ms / 3600000);
        ms %= 3600000;
        const m = Math.floor(ms / 60000);
        ms %= 60000;
        const s = Math.floor(ms / 1000);
        const milli = Math.floor(ms % 1000);
        return `${sign}${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
    }

    function getServerOffset() {
        try {
            const txt = $('#serverTime').closest('p').text();
            const nums = txt.match(/\d+/g);
            if (!nums || nums.length < 6) return 0;
            const [hour, min, sec, day, month, year] = nums.map(Number);
            const serverDateTime = new Date(year, month - 1, day, hour, min, sec).getTime();
            return Math.round(Math.abs(serverDateTime - Date.now()) / 36e5) * 3600 * 1000;
        } catch (e) {
            return 0;
        }
    }

    function getCurrentServerMs() {
        if (typeof Timing !== 'undefined' && typeof Timing.getCurrentServerTime === 'function') {
            return Math.round(Timing.getCurrentServerTime());
        }
        return Date.now() + getServerOffset();
    }

    function formatServerTime(ms) {
        const d = new Date(ms);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    }

    function findConfirmButton() {
        return (
            document.querySelector('#troop_confirm_submit') ||
            document.querySelector('input[name="submit"]') ||
            document.querySelector('button[name="submit"]') ||
            Array.from(document.querySelectorAll('input, button, a')).find(el => {
                if (!isVisible(el)) return false;
                const txt = textOf(el).toLowerCase();
                return txt.includes('angreifen') || txt.includes('bestätigen') || txt.includes('confirm') || txt.includes('ok');
            }) ||
            null
        );
    }

    function submitConfirm(btn) {
        if (!btn) return false;

        try {
            const form = btn.closest('form');
            if (form && typeof form.requestSubmit === 'function') {
                form.requestSubmit(btn);
                return true;
            }
            btn.click();
            return true;
        } catch (e) {
            try {
                btn.click();
                return true;
            } catch (_) {
                return false;
            }
        }
    }

    function clearPhase2Timer() {
        PHASE2_STATE.armed = false;
        if (PHASE2_STATE.timeout) {
            clearTimeout(PHASE2_STATE.timeout);
            PHASE2_STATE.timeout = null;
        }
        if (PHASE2_STATE.raf) {
            cancelAnimationFrame(PHASE2_STATE.raf);
            PHASE2_STATE.raf = null;
        }
    }

    function precisionSubmitAt(sendServerMs, btn) {
        const status = document.getElementById('twcc-dsu-exec-status');

        const spin = () => {
            if (!PHASE2_STATE.armed) return;

            const nowServer = getCurrentServerMs();
            const rest = sendServerMs - nowServer;

            if (status) status.textContent = `Precision aktiv · Rest ${Math.round(rest)} ms · Server-ms ${nowServer % 1000}`;

            if (rest <= 0) {
                PHASE2_STATE.armed = false;

                const before = getCurrentServerMs();
                const restAtSubmit = sendServerMs - before;
                const activeBeforeSubmit = loadJson(ACTIVE_KEY, null);
                // Kein CloseMarker vor Submit setzen:
                // Der Tab darf erst schließen, nachdem die Weiterverarbeitung gestartet wurde.
                const ok = submitConfirm(btn);
                const after = getCurrentServerMs();

                const activeForStats = loadJson(ACTIVE_KEY, null);
                const timingForStats = activeForStats ? getSendTimingInfo(activeForStats.send) : null;
                const diffToTarget = timingForStats ? before - timingForStats.targetMs : null;

                log(`PHASE2 SUBMIT ${ok ? 'OK' : 'FAIL'} · RestKlick ${restAtSubmit} ms · ZielDiff ${diffToTarget} ms · ServerMS ${before % 1000} · Call ${after - before} ms`);

                if (ok && timingForStats) {
                    saveTimingStat({
                        id: activeForStats.id,
                        from: activeForStats.from,
                        to: activeForStats.to,
                        targetMs: timingForStats.targetMs,
                        clickMs: before,
                        offsetMs: timingForStats.offset,
                        diffMs: diffToTarget,
                        serverMs: before % 1000,
                        submitCallMs: after - before
                    });
                }

                if (status) {
                    status.textContent = ok
                        ? `GEKLICKT · ZielDiff ${diffToTarget} ms · ServerMS ${before % 1000}`
                        : 'Submit fehlgeschlagen';
                }

                const active = loadJson(ACTIVE_KEY, null);
                if (active?.id) {
                    updatePlanItem(active.id, { status: ok ? 'submitted_test' : 'submit_failed', submitAt: Date.now() });
                    active.phase = ok ? 'submitted-test' : 'submit-failed';
                    active.submitAt = Date.now();
                    if (ok) {
                        const shouldClose = isAutoCloseEnabled() && active.openedByAngriffsplaner;
                        localStorage.removeItem(ACTIVE_KEY);
                        setTimeout(() => queueTick('auto-submit'), 500);
                        if (shouldClose) {
                            /* SAFE v1.6: Auto-Close deaktiviert */
                        }
                    } else {
                        saveJson(ACTIVE_KEY, active);
                    }
                }

                toast(ok ? 'Angriff gesendet' : 'Submit fehlgeschlagen');
                return;
            }

            if (rest > 16) PHASE2_STATE.raf = requestAnimationFrame(spin);
            else queueMicrotask(spin);
        };

        spin();
    }

    function armPhase2Timer() {
        clearPhase2Timer();

        const active = loadJson(ACTIVE_KEY, null);
        if (!active) return toast('Kein aktiver Angriff gefunden');

        if (isAttackExpired(active)) {
            failActiveAttack('expired', 'Abschickzeit liegt in der Vergangenheit');
            return;
        }

        const timing = getSendTimingInfo(active.send);
        if (!timing) return toast('Abschickzeit ungültig: ' + active.send);
        const sendMs = timing.clickMs;

        const btn = findConfirmButton();
        if (!btn) return toast('Confirm-Button nicht gefunden');

        const nowServer = getCurrentServerMs();
        const delay = sendMs - nowServer;

        if (delay < 0) {
            const status = document.getElementById('twcc-dsu-exec-status');
            if (status) status.textContent = `Zu spät · Delay ${delay} ms`;
            failActiveAttack('expired', 'Abschickzeit liegt in der Vergangenheit');
            return;
        }

        PHASE2_STATE.armed = true;

        const prepareMs = 120;
        const waitMs = Math.max(0, delay - prepareMs);

        const status = document.getElementById('twcc-dsu-exec-status');
        if (status) status.textContent = `Abschickzeit aktiv · Start Precision in ${Math.round(waitMs)} ms`;

        log(`PHASE2 SCHARF · Ziel ${timing.dateDisplay} · Offset ${timing.offset} · Klick ${formatServerTime(timing.clickMs)} · Delay ${delay} ms · Prepare ${prepareMs}`);

        PHASE2_STATE.timeout = setTimeout(() => {
            if (!PHASE2_STATE.armed) return;
            precisionSubmitAt(sendMs, btn);
        }, waitMs);
    }

    function buildAngriffsplanerPanel(active) {
        let panel = document.getElementById('twcc-dsu-executor');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'twcc-dsu-executor';
            panel.style.cssText = [
                'position:fixed',
                'right:20px',
                'top:90px',
                'width:430px',
                'z-index:999999',
                'background:#f4e4bc',
                'border:2px solid #6f4e2e',
                'border-radius:10px',
                'box-shadow:0 4px 16px rgba(0,0,0,.35)',
                'font:12px Arial,sans-serif',
                'color:#2b1a08',
                'resize:both',
                'overflow:auto'
            ].join(';');

            panel.innerHTML = `
                <div id="twcc-dsu-exec-head" style="background:#6f4e2e;color:white;padding:8px;cursor:move;font-weight:bold;">
                    ⏱ TWCC Angriffsplaner Timer
                    <button id="twcc-dsu-exec-close" style="float:right;">×</button>
                </div>
                <div style="padding:10px;">
                    <div style="background:#fff8e8;border:1px solid #c7a76b;border-radius:6px;padding:8px;margin-bottom:8px;">
                        <div><b>Aktuell:</b> <span id="twcc-dsu-exec-current">-</span></div>
                        <div><b>Vorlage:</b> <span id="twcc-dsu-exec-template">-</span></div>
                        <div><b>Abschicken Import:</b> <span id="twcc-dsu-exec-send">-</span></div>
                        <div><b>Zielzeit:</b> <span id="twcc-dsu-exec-target">-</span></div>
                        <div><b>MS-Modus:</b> <span id="twcc-dsu-exec-msmode">-</span></div>
                        <div><b>Klick geplant:</b> <span id="twcc-dsu-exec-click">-</span></div>
                        <div><b>Serverzeit:</b> <span id="twcc-dsu-exec-server">-</span></div>
                        <div><b>Rest bis Klick:</b> <span id="twcc-dsu-exec-rest">-</span></div>
                    </div>

                    <div style="background:#ead3a2;border:1px solid #8b6b3f;border-radius:6px;padding:8px;margin-bottom:8px;">
                        <b>Timing</b><br>
                        Standard-MS wenn leer:
                        <input id="twcc-dsu-default-ms" type="number" min="0" max="999" style="width:70px;" value="200">
                        Offset ms:
                        <input id="twcc-dsu-offset-ms" type="number" style="width:80px;" value="0">
                        Limit:
                        <input id="twcc-dsu-calib-limit" type="number" style="width:70px;" value="300">
                        <label style="white-space:nowrap;"><input id="twcc-dsu-autocalib" type="checkbox" checked> Auto-Kalibrierung</label>
                        <label style="white-space:nowrap;opacity:.55;"><input id="twcc-dsu-autoclose" type="checkbox" disabled> Tab nach Senden schließen (deaktiviert)</label>
                        <button id="twcc-dsu-save-timing">Speichern</button>
                        <div style="margin-top:5px;font-size:11px;">Statistik: <span id="twcc-dsu-timing-stats">-</span></div>
                    </div>

                    <div id="twcc-dsu-exec-status" style="font-weight:bold;margin-bottom:8px;">Status: Confirm erkannt</div>

                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button id="twcc-dsu-exec-manual">Jetzt senden</button>
                        <button id="twcc-dsu-exec-arm">Abschickzeit aktiv</button>
                        <button id="twcc-dsu-exec-stop">Timer Stop</button>
                        <button id="twcc-dsu-exec-pause">Pause</button>
                        <button id="twcc-dsu-exec-resume">Fortsetzen</button>
                        <button id="twcc-dsu-exec-qstop">Angriffe Stop</button>
                    </div>

                    <pre id="twcc-dsu-exec-debug" style="margin-top:10px;background:#2f1d07;color:#f8e7bd;padding:8px;border-radius:6px;max-height:120px;overflow:auto;white-space:pre-wrap;"></pre>
                </div>
            `;

            document.body.appendChild(panel);

            document.getElementById('twcc-dsu-exec-close').onclick = () => panel.style.display = 'none';
            document.getElementById('twcc-dsu-exec-manual').onclick = () => {
                const btn = findConfirmButton();
                const active = loadJson(ACTIVE_KEY, null);
                // Kein CloseMarker vor Submit setzen:
                // Der Tab darf erst schließen, nachdem die Weiterverarbeitung gestartet wurde.
                const ok = submitConfirm(btn);
                if (ok && active?.id) {
                    updatePlanItem(active.id, { status: 'submitted_test', submitAt: Date.now() });
                    const shouldClose = isAutoCloseEnabled() && active.openedByAngriffsplaner;
                    localStorage.removeItem(ACTIVE_KEY);
                    setTimeout(() => queueTick('manual-submit'), 500);
                    if (shouldClose) {
                        /* SAFE v1.6: Auto-Close deaktiviert */
                    }
                }
                toast(ok ? 'Manuell gesendet' : 'Manuelles Abschicken fehlgeschlagen');
            };
            document.getElementById('twcc-dsu-exec-arm').onclick = armPhase2Timer;
            document.getElementById('twcc-dsu-exec-stop').onclick = () => {
                clearPhase2Timer();
                document.getElementById('twcc-dsu-exec-status').textContent = 'Status: Timer gestoppt';
                toast('Timer gestoppt');
            };
            document.getElementById('twcc-dsu-exec-pause').onclick = pauseQueue;
            document.getElementById('twcc-dsu-exec-resume').onclick = resumeQueue;
            document.getElementById('twcc-dsu-exec-qstop').onclick = stopQueue;

            document.getElementById('twcc-dsu-default-ms').value = String(getTimingDefaultMs());
            document.getElementById('twcc-dsu-offset-ms').value = String(getTimingOffsetMs());
            document.getElementById('twcc-dsu-calib-limit').value = String(getCalibLimit());
            document.getElementById('twcc-dsu-autocalib').checked = isAutoCalibEnabled();
            document.getElementById('twcc-dsu-autoclose').checked = isAutoCloseEnabled();
            document.getElementById('twcc-dsu-save-timing').onclick = () => {
                setTimingDefaultMs(document.getElementById('twcc-dsu-default-ms').value);
                setTimingOffsetMs(document.getElementById('twcc-dsu-offset-ms').value);
                setCalibLimit(document.getElementById('twcc-dsu-calib-limit').value);
                setAutoCalibEnabled(document.getElementById('twcc-dsu-autocalib').checked);
                setAutoCloseEnabled(document.getElementById('twcc-dsu-autoclose').checked);
                toast('Timing gespeichert');
            };

            makeDraggable(panel, document.getElementById('twcc-dsu-exec-head'));
        }

        panel.style.display = '';

        function update() {
            const activeNow = loadJson(ACTIVE_KEY, active);
            if (!activeNow) return;

            const now = getCurrentServerMs();
            const timing = getSendTimingInfo(activeNow.send);
            const rest = timing ? timing.clickMs - now : NaN;

            const plan = loadJson(PLAN_KEY, []);
            const total = plan.filter(p => p.ok).length;
            const done = plan.filter(p => ['submitted_test', 'done'].includes(p.status)).length;

            document.getElementById('twcc-dsu-exec-current').textContent =
                `${activeNow.from} → ${activeNow.to} (${done}/${total} erledigt)`;
            document.getElementById('twcc-dsu-exec-template').textContent = activeNow.templateName || getTemplateName(activeNow.unit);
            document.getElementById('twcc-dsu-exec-send').textContent = activeNow.send || '-';
            document.getElementById('twcc-dsu-exec-target').textContent = timing ? timing.dateDisplay : '-';
            document.getElementById('twcc-dsu-exec-msmode').textContent = timing ? (timing.explicitMs ? 'aus Import' : 'Standard .' + pad(timing.ms, 3)) : '-';
            document.getElementById('twcc-dsu-exec-click').textContent = timing ? `${formatServerTime(timing.clickMs)} (${timing.offset >= 0 ? '+' : ''}${timing.offset} ms)` : '-';
            document.getElementById('twcc-dsu-exec-server').textContent = formatServerTime(now);
            document.getElementById('twcc-dsu-exec-rest').textContent = formatMs(rest);
            const statsEl = document.getElementById('twcc-dsu-timing-stats');
            if (statsEl) statsEl.textContent = getTimingStatsSummary();

            const dbg = document.getElementById('twcc-dsu-exec-debug');
            if (dbg) {
                dbg.textContent =
                    `screen=${getScreen()} try=${getParams().get('try') || '-'}\n` +
                    `confirmButton=${!!findConfirmButton()}\n` +
                    `active.phase=${activeNow.phase}\n` +
                    `active.status=${activeNow.status || '-'}\n` +
                    `angriffe.laufen=${isQueueRunning()} pause=${isQueuePaused()}\n` +
                    `stats=${JSON.stringify(getQueueStats())}\n` +
                    `timing=${timing ? JSON.stringify({target: timing.dateDisplay, click: formatServerTime(timing.clickMs), offset: timing.offset, explicitMs: timing.explicitMs}) : '-'}`;
            }
        }

        update();

        if (!PHASE2_STATE.tick) {
            PHASE2_STATE.tick = setInterval(update, 100);
        }

        if (isQueueRunning() && !isQueuePaused() && !PHASE2_STATE.armed) {
            const status = document.getElementById('twcc-dsu-exec-status');
            if (status) status.textContent = 'Angriffe aktiv · Timer wird automatisch scharf gestellt';
            setTimeout(armPhase2Timer, 700);
        }
    }


    function markConfirmPageIfActive() {
        const params = getParams();
        if (getScreen() !== 'place' || params.get('try') !== 'confirm') return;

        const active = loadJson(ACTIVE_KEY, null);
        if (!active || active.phase !== 'confirm-opened') return;

        updatePlanItem(active.id, { status: 'confirm_ready' });
        active.phase = 'confirm-ready';
        active.confirmReadyAt = Date.now();
        saveJson(ACTIVE_KEY, active);

        toast('Confirm-Seite bereit für Phase 2');
        log('Confirm-Seite erkannt:', active);
        buildAngriffsplanerPanel(active);
    }

    function init() {
        maybeAutoCloseThisTab();
        addLauncher();

        if (getScreen() === 'overview_villages') {
            setTimeout(() => {
                const map = scanOwnVillages();
                log('Auto-Scan overview_villages:', Object.keys(map).length);
            }, 1200);
        }

        setTimeout(phase1AutoOnPlace, 700);
        setTimeout(markConfirmPageIfActive, 1000);
        setTimeout(() => {
            if (getScreen() === 'place' && getParams().get('try') === 'confirm') {
                const active = loadJson(ACTIVE_KEY, null);
                if (active) buildAngriffsplanerPanel(active);
            } else if (isQueueRunning() && !isQueuePaused()) {
                const active = loadJson(ACTIVE_KEY, null);
                if (!active) queueTick('init-continue');
            }
        }, 1400);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
