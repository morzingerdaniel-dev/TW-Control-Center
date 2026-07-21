// TWCC External Module: DS Angriff Timer ServerMS
// Repository path: modules/AttackTimerServerMS.js
(function () {
    'use strict';

    if (window.TWCC_AttackTimerServerMS && typeof window.TWCC_AttackTimerServerMS.init === 'function') {
        window.TWCC_AttackTimerServerMS.init();
        return;
    }
const FIXED_PREPARE_MS = 120;

        const STORAGE_KEY_TARGET = 'tw_serverms_target';
        const STORAGE_KEY_OFFSET = 'tw_serverms_offset';
        const STORAGE_KEY_ENEMY = 'tw_serverms_enemy_time';
        const STORAGE_KEY_BEHIND = 'tw_serverms_behind_ms';
        const STORAGE_KEY_CALIB = 'tw_serverms_calib_values';

        const STORAGE_KEY_PANEL = 'tw_serverms_panel_rect';
        const STORAGE_KEY_CALIB_OPEN = 'tw_serverms_calib_open';
        const STORAGE_KEY_FIELD_SIZES = 'tw_serverms_field_sizes';

        const STATE = {
          armed: false,
          timeout: null,
          raf: null,
          refresh: null,
          debug: []
        };

        function pad(n, len = 2) {
          return String(n).padStart(len, '0');
        }

        function log(msg) {
          const d = new Date();
          const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
          STATE.debug.unshift(`[${stamp}] ${msg}`);
          STATE.debug = STATE.debug.slice(0, 8);
          const box = document.getElementById('tw-debug-log');
          if (box) box.textContent = STATE.debug.join('\n');
        }

        function toast(msg) {
          let el = document.getElementById('tw-arrival-toast');
          if (!el) {
            el = document.createElement('div');
            el.id = 'tw-arrival-toast';
            el.style.cssText =
              'position:fixed;right:20px;bottom:20px;z-index:999999;background:#6b4e23;color:white;' +
              'padding:10px 14px;border-radius:8px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.25);';
            document.body.appendChild(el);
          }

          el.textContent = msg;
          clearTimeout(el._hideTimer);
          el.style.opacity = '1';
          el._hideTimer = setTimeout(() => el.style.opacity = '0', 1800);
        }

        function getServerOffset() {
          const txt = $('#serverTime').closest('p').text();
          const nums = txt.match(/\d+/g);
          if (!nums || nums.length < 6) return 0;

          const [hour, min, sec, day, month, year] = nums.map(Number);
          const serverDateTime = new Date(year, month - 1, day, hour, min, sec).getTime();
          return Math.round(Math.abs(serverDateTime - Date.now()) / 36e5) * 3600 * 1000;
        }

        function getServerDateParts() {
          const txt = $('#serverTime').closest('p').text();
          const nums = txt.match(/\d+/g);
          if (!nums || nums.length < 6) return null;

          const [hour, min, sec, day, month, year] = nums.map(Number);
          return { hour, min, sec, day, month, year };
        }

        function getCurrentServerMs() {
          if (typeof Timing !== 'undefined' && typeof Timing.getCurrentServerTime === 'function') {
            return Math.round(Timing.getCurrentServerTime());
          }
          return Date.now() + getServerOffset();
        }

        function getDurationMs() {
          const span = document.querySelector('#date_arrival span[data-duration]');
          const duration = span ? Number(span.dataset.duration) * 1000 : NaN;
          if (Number.isFinite(duration)) return duration;

          const txt = document.body.innerText || '';
          const m = txt.match(/Dauer:\s*(\d{1,2}):(\d{2}):(\d{2})/i);
          if (!m) return null;

          return ((Number(m[1]) * 3600) + (Number(m[2]) * 60) + Number(m[3])) * 1000;
        }

        function findArrivalCell() {
          const rows = [...document.querySelectorAll('tr')];

          for (const row of rows) {
            const cells = [...row.querySelectorAll('td')];
            if (cells.length < 2) continue;

            const label = (cells[0].textContent || '').trim().toLowerCase();
            if (label === 'ankunft:' || label === 'ankunft') return cells[1];
          }

          return null;
        }

        function getArrivalText() {
          const cell = findArrivalCell();
          return cell ? (cell.textContent || '').trim() : null;
        }

        function parseArrivalToTargetText(txt) {
          const m = String(txt || '').match(/(\d{1,2}):(\d{2}):(\d{2})/);
          if (!m) return '';
          return `${pad(m[1])}:${m[2]}:${m[3]}.500`;
        }

        function parseTarget(str) {
          const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
          if (!m) return null;

          const ms = Number((m[4] || '0').padEnd(3, '0'));

          return {
            h: Number(m[1]),
            m: Number(m[2]),
            s: Number(m[3]),
            ms,
            text: `${pad(m[1])}:${m[2]}:${m[3]}.${pad(ms, 3)}`
          };
        }

        function addMsToTime(time, addMs) {
          let total = ((time.h * 3600 + time.m * 60 + time.s) * 1000) + time.ms + addMs;
          const day = 24 * 3600 * 1000;
          total = ((total % day) + day) % day;

          const h = Math.floor(total / 3600000);
          total %= 3600000;
          const m = Math.floor(total / 60000);
          total %= 60000;
          const s = Math.floor(total / 1000);
          const ms = Math.floor(total % 1000);

          return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
        }

        function calculateTargetFromEnemy() {
          const enemyInput = document.getElementById('tw-enemy-time');
          const behindInput = document.getElementById('tw-behind-ms');
          const targetInput = document.getElementById('tw-arrival-target');

          const enemy = parseTarget(enemyInput.value);
          const behind = Math.round(Number(String(behindInput.value || '0').replace(',', '.')));

          if (!enemy) return toast('Gegnerzeit ungültig');
          if (!Number.isFinite(behind)) return toast('Dahinter-ms ungültig');

          const target = addMsToTime(enemy, behind);
          targetInput.value = target;

          localStorage.setItem(STORAGE_KEY_ENEMY, enemyInput.value.trim());
          localStorage.setItem(STORAGE_KEY_BEHIND, String(behind));
          localStorage.setItem(STORAGE_KEY_TARGET, target);

          toast(`Ziel gesetzt: ${target}`);
          log(`Ziel berechnet: Gegner ${enemy.text} + ${behind} ms = ${target}`);
        }

        function getNumber(id, fallback) {
          const input = document.getElementById(id);
          const val = Math.round(Number(String(input?.value ?? fallback).replace(',', '.')));
          return Number.isFinite(val) ? val : fallback;
        }

        function findAttackButton() {
          return (
            document.querySelector('#troop_confirm_submit') ||
            [...document.querySelectorAll('input, button, a')].find(el => {
              const txt = ((el.value || el.textContent || '').trim()).toLowerCase();
              return txt.includes('angreifen');
            }) ||
            null
          );
        }

        function submitAttack(btn) {
          if (!btn) return false;

          try {
            const form = btn.closest('form');
            if (form && typeof form.requestSubmit === 'function') {
              form.requestSubmit(btn);
              return true;
            }

            btn.click();
            return true;
          } catch (_) {
            try {
              btn.click();
              return true;
            } catch (_) {
              return false;
            }
          }
        }

      function buildTargetArrivalMs(target) {
        const serverDate = getServerDateParts();
        if (!serverDate) return null;

        const arrivalText = (getArrivalText() || '').toLowerCase();

        let dayOffset = 0;

        if (arrivalText.includes('morgen')) {
          dayOffset = 1;
        }

        const arrivalLocal = new Date(
          serverDate.year,
          serverDate.month - 1,
          serverDate.day + dayOffset,
          target.h,
          target.m,
          target.s,
          target.ms
        ).getTime();

        const nowServer = getCurrentServerMs();
        const serverOffset = getServerOffset();

        let arrivalServer = arrivalLocal + serverOffset;


        if (arrivalServer < nowServer && arrivalText.includes('morgen')) {
          arrivalServer += 24 * 3600 * 1000;
        }

        // Normaler Schutz für Tageswechsel
        if (arrivalServer < nowServer - 12 * 3600 * 1000) {
          arrivalServer += 24 * 3600 * 1000;
        }

        return arrivalServer;
        }

        function clearArmedState() {
          STATE.armed = false;

          if (STATE.timeout) {
            clearTimeout(STATE.timeout);
            STATE.timeout = null;
          }

          if (STATE.raf) {
            cancelAnimationFrame(STATE.raf);
            STATE.raf = null;
          }

          const status = document.getElementById('tw-arrival-status');
          if (status) status.textContent = 'Status: inaktiv';
        }

        function precisionSubmitAt(sendServerMs, btn, status) {
          const spin = () => {
            if (!STATE.armed) return;

            const nowServer = getCurrentServerMs();
            const rest = sendServerMs - nowServer;

            if (status) {
              status.textContent = `Status: Precision • Server-Rest ${Math.round(rest)} ms • Server-ms ${nowServer % 1000}`;
            }

            if (rest <= 0) {
              STATE.armed = false;

              const before = getCurrentServerMs();
              const restAtSubmit = sendServerMs - before;
              const ok = submitAttack(btn);
              const after = getCurrentServerMs();

              log(`SUBMIT ${ok ? 'OK' : 'FAIL'} • ServerRest ${restAtSubmit} ms • ServerMS ${before % 1000} • SubmitCall ${after - before} ms`);

              status.textContent = ok
                ? `Status: GEKLICKT • ServerRest ${restAtSubmit} ms • ServerMS ${before % 1000}`
                : 'Status: Submit fehlgeschlagen';

              toast(ok ? 'Angriff ausgelöst' : 'Submit fehlgeschlagen');
              return;
            }

            if (rest > 16) {
              STATE.raf = requestAnimationFrame(spin);
            } else {
              queueMicrotask(spin);
            }
          };

          spin();
        }

        function armTimer() {
          clearArmedState();

          const targetRaw = document.getElementById('tw-arrival-target')?.value || '';
          const target = parseTarget(targetRaw);
          const offset = getNumber('tw-arrival-offset', 0);
          const prepare = FIXED_PREPARE_MS;

          localStorage.setItem(STORAGE_KEY_TARGET, targetRaw);
          localStorage.setItem(STORAGE_KEY_OFFSET, String(offset));

          const btn = findAttackButton();
          const status = document.getElementById('tw-arrival-status');
          const duration = getDurationMs();

          if (!target) return toast('Zielzeit ungültig');
          if (!btn) return toast('Angreifen-Button nicht gefunden');
          if (!Number.isFinite(duration)) return toast('Dauer nicht gefunden');

          const arrivalServerMs = buildTargetArrivalMs(target);
          if (!arrivalServerMs) return toast('Serverdatum nicht lesbar');

          const sendServerMs = arrivalServerMs - duration - offset;
          const nowServer = getCurrentServerMs();
          const delay = sendServerMs - nowServer;

          if (delay < 0) {
            toast('Sendezeit liegt in der Vergangenheit');
            if (status) status.textContent = `Status: zu spät • Delay ${delay} ms`;
            log(`Fehler: Delay negativ ${delay} ms`);
            return;
          }

          STATE.armed = true;

          const waitMs = Math.max(0, delay - prepare);

          if (status) {
            status.textContent =
              `Status: scharf • Send in ${Math.round(delay)} ms • Ziel ${target.text} • Offset -${offset}`;
          }

          log(`SCHARF • Ziel ${target.text} • Dauer ${duration} ms • SendDelay ${delay} ms • Offset ${offset} • Prepare ${prepare}`);

          toast('Timer scharf');

          STATE.timeout = setTimeout(() => {
            if (!STATE.armed) return;
            log(`Precision-Start • ServerRest ${sendServerMs - getCurrentServerMs()} ms`);
            precisionSubmitAt(sendServerMs, btn, status);
          }, waitMs);
        }

        function setFromCurrentArrival() {
          const arrival = getArrivalText();
          const target = parseArrivalToTargetText(arrival);
          const input = document.getElementById('tw-arrival-target');

          if (!target) return toast('Ankunft nicht gefunden');

          input.value = target;
          localStorage.setItem(STORAGE_KEY_TARGET, target);
          toast('Aktuelle Ankunft übernommen');
          log(`Aktuelle übernommen: ${target}`);
        }

        // ======================
        // KALIBRIERUNG
        // ======================

        function getTargetMsOnly() {
          const target = parseTarget(document.getElementById('tw-arrival-target')?.value || '');
          return target ? target.ms : 500;
        }

        function loadCalibValues() {
          try {
            const arr = JSON.parse(localStorage.getItem(STORAGE_KEY_CALIB) || '[]');
            return Array.isArray(arr) ? arr.filter(v => Number.isFinite(Number(v))).map(Number).slice(-5) : [];
          } catch (_) {
            return [];
          }
        }

        function saveCalibValues(values) {
          localStorage.setItem(STORAGE_KEY_CALIB, JSON.stringify(values.slice(-5)));
        }

        function averageWithoutWorstOutlier(values, targetMs) {
          if (values.length <= 2) return values.reduce((a, b) => a + b, 0) / values.length;

          let worstIndex = 0;
          let worstDist = -1;

          values.forEach((v, i) => {
            const dist = Math.abs(v - targetMs);
            if (dist > worstDist) {
              worstDist = dist;
              worstIndex = i;
            }
          });

          const filtered = values.filter((_, i) => i !== worstIndex);
          return filtered.reduce((a, b) => a + b, 0) / filtered.length;
        }

        function refreshCalibDisplay() {
          const values = loadCalibValues();
          const targetMs = getTargetMsOnly();
          const list = document.getElementById('tw-calib-list');
          const avgBox = document.getElementById('tw-calib-avg');

          if (list) list.textContent = values.length ? values.join(', ') : '-';

          if (avgBox) {
            if (!values.length) {
              avgBox.textContent = 'Ø: -';
            } else {
              const avg = averageWithoutWorstOutlier(values, targetMs);
              const diff = avg - targetMs;
              avgBox.textContent = `Ø ohne Ausreißer: ${avg.toFixed(1)} ms • Abweichung: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ms`;
            }
          }
        }

        function addCalibValue() {
          const input = document.getElementById('tw-calib-ms');
          const raw = Math.round(Number(String(input.value || '').replace(',', '.')));

          if (!Number.isFinite(raw) || raw < 0 || raw > 999) {
            toast('Echte ms ungültig');
            return;
          }

          const values = loadCalibValues();
          values.push(raw);
          saveCalibValues(values);

          input.value = '';
          refreshCalibDisplay();
          toast(`Kalibrierwert gespeichert: ${raw}`);
          log(`Kalibrierung: Wert ${raw} gespeichert`);
        }

        function applyAutoOffset() {
          const values = loadCalibValues();
          if (!values.length) return toast('Keine Kalibrierwerte');

          const targetMs = getTargetMsOnly();
          const avg = averageWithoutWorstOutlier(values, targetMs);
          const diff = avg - targetMs;

          const offsetInput = document.getElementById('tw-arrival-offset');
          const oldOffset = getNumber('tw-arrival-offset', 0);
          const newOffset = Math.round(oldOffset + diff);

          offsetInput.value = String(newOffset);
          localStorage.setItem(STORAGE_KEY_OFFSET, String(newOffset));

          toast(`Offset gesetzt: ${newOffset}`);
          log(`Auto-Offset: alt ${oldOffset}, Ø ${avg.toFixed(1)}, Ziel ${targetMs}, neu ${newOffset}`);
        }

        function clearCalibValues() {
          localStorage.removeItem(STORAGE_KEY_CALIB);
          refreshCalibDisplay();
          toast('Kalibrierung gelöscht');
          log('Kalibrierung gelöscht');
        }

        // ======================
        // UI: DRAG / RESIZE / SAVE
        // ======================

        function loadJson(key, fallback = null) {
          try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
          } catch (_) {
            return fallback;
          }
        }

        function saveJson(key, value) {
          localStorage.setItem(key, JSON.stringify(value));
        }

        function makePanelDraggable(panel, handle) {
          let dragging = false;
          let startX = 0;
          let startY = 0;
          let startLeft = 0;
          let startTop = 0;

          handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = panel.offsetLeft;
            startTop = panel.offsetTop;

            panel.style.right = 'auto';
            panel.style.left = `${startLeft}px`;
            panel.style.top = `${startTop}px`;

            document.body.style.userSelect = 'none';
            e.preventDefault();
          });

          document.addEventListener('mousemove', (e) => {
            if (!dragging) return;

            const left = Math.max(0, Math.min(window.innerWidth - 80, startLeft + e.clientX - startX));
            const top = Math.max(0, Math.min(window.innerHeight - 40, startTop + e.clientY - startY));

            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
          });

          document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = '';

            saveJson(STORAGE_KEY_PANEL, {
              left: panel.offsetLeft,
              top: panel.offsetTop,
              width: panel.offsetWidth,
              height: panel.offsetHeight
            });

            log('Maskenposition gespeichert');
          });
        }

        function restorePanelRect(panel) {
          const rect = loadJson(STORAGE_KEY_PANEL);
          if (!rect) return;

          if (rect.left !== undefined && rect.top !== undefined) {
            panel.style.right = 'auto';
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;
          }

          if (rect.width) panel.style.width = `${rect.width}px`;
          if (rect.height) panel.style.height = `${rect.height}px`;
        }

        function watchPanelResize(panel) {
          let timer = null;
          const obs = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              saveJson(STORAGE_KEY_PANEL, {
                left: panel.offsetLeft,
                top: panel.offsetTop,
                width: panel.offsetWidth,
                height: panel.offsetHeight
              });
            }, 250);
          });
          obs.observe(panel);
        }

        function getFieldSizes() {
          return loadJson(STORAGE_KEY_FIELD_SIZES, {});
        }

        function saveFieldSize(el) {
          const sizes = getFieldSizes();
          sizes[el.id] = {
            width: el.offsetWidth,
            height: el.offsetHeight
          };
          saveJson(STORAGE_KEY_FIELD_SIZES, sizes);
        }

        function restoreFieldSize(el) {
          const sizes = getFieldSizes();
          const s = sizes[el.id];
          if (!s) return;

          if (s.width) el.style.width = `${s.width}px`;
          if (s.height) el.style.height = `${s.height}px`;
        }

        function watchFieldResize(el) {
          let timer = null;
          const obs = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => saveFieldSize(el), 250);
          });
          obs.observe(el);
        }

        function setupResizableFields() {
          const ids = [
            'tw-enemy-time',
            'tw-behind-ms',
            'tw-arrival-target',
            'tw-arrival-offset'
          ];

          ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            restoreFieldSize(el);
            watchFieldResize(el);
          });
        }

        function setCalibOpen(open) {
          const body = document.getElementById('tw-calib-body');
          const btn = document.getElementById('tw-calib-toggle');
          if (!body || !btn) return;

          body.style.display = open ? 'block' : 'none';
          btn.textContent = open ? '−' : '+';
          localStorage.setItem(STORAGE_KEY_CALIB_OPEN, open ? '1' : '0');
        }

        function buildPanel() {
          if (document.getElementById('tw-arrival-panel')) return;

          const panel = document.createElement('div');
          panel.id = 'tw-arrival-panel';
          panel.style.cssText =
            'position:fixed;top:80px;right:20px;z-index:999999;width:470px;min-width:330px;min-height:260px;' +
            'background:#f4e4bc;border:2px solid #6b4e23;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);' +
            'padding:12px;font-family:Arial,sans-serif;color:#2f1d07;box-sizing:border-box;resize:both;overflow:auto;';

          panel.innerHTML = `
            <div id="tw-panel-title" style="
              font-weight:700;font-size:22px;margin-bottom:12px;cursor:move;user-select:none;
              padding:2px 4px;border-radius:6px;
            ">Angriff-Timer ServerMS</div>

            <div style="font-size:14px;margin-bottom:6px;">Gelesene Ankunft:</div>
            <div id="tw-arrival-current" style="
              background:#d8ffd2;border:1px solid #7ab96f;border-radius:6px;padding:10px;
              font-weight:700;margin-bottom:14px;
            ">-</div>

            <div style="font-size:16px;margin-bottom:8px;font-weight:700;">Gegner-Ankunft</div>
            <textarea id="tw-enemy-time" rows="1" spellcheck="false" placeholder="15:08:30.753" style="
              width:100%;box-sizing:border-box;padding:12px;border:1px solid #8b6b3f;
              border-radius:6px;margin-bottom:10px;font-size:20px;font-weight:700;
              height:58px;resize:both;overflow:auto;font-family:Arial,sans-serif;background:white;
            "></textarea>

            <div style="font-size:16px;margin-bottom:8px;">Dahinter ms</div>
            <textarea id="tw-behind-ms" rows="1" spellcheck="false" placeholder="10" style="
              width:100%;box-sizing:border-box;padding:12px;border:1px solid #8b6b3f;
              border-radius:6px;margin-bottom:10px;font-size:20px;height:58px;
              resize:both;overflow:auto;font-family:Arial,sans-serif;background:white;
            "></textarea>

            <button id="tw-calc-target" style="
              width:100%;padding:10px;border:none;border-radius:6px;background:#4b6f9f;color:#fff;
              cursor:pointer;font-weight:700;font-size:16px;margin-bottom:14px;
            ">Ziel berechnen</button>

            <div style="font-size:16px;margin-bottom:8px;font-weight:700;">Ziel-Ankunft</div>
            <textarea id="tw-arrival-target" rows="1" spellcheck="false" placeholder="15:08:30.763" style="
              width:100%;box-sizing:border-box;padding:18px 14px;border:2px solid #8b6b3f;
              border-radius:8px;margin-bottom:16px;font-size:24px;font-weight:700;height:72px;
              resize:both;overflow:auto;font-family:Arial,sans-serif;background:white;
            "></textarea>

            <div style="margin-bottom:14px;">
              <div style="font-size:16px;margin-bottom:6px;">Offset ms</div>
              <textarea id="tw-arrival-offset" rows="1" spellcheck="false" placeholder="0" style="
                width:100%;box-sizing:border-box;padding:12px;border:1px solid #8b6b3f;
                border-radius:6px;font-size:20px;height:58px;resize:both;overflow:auto;
                font-family:Arial,sans-serif;background:white;
              "></textarea>
            </div>

            <div id="tw-calib-box" style="background:#ead3a2;border:1px solid #8b6b3f;border-radius:8px;padding:10px;margin-bottom:14px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="font-weight:700;font-size:16px;">Kalibrierung</div>
                <button id="tw-calib-toggle" style="
                  width:34px;height:28px;border:none;border-radius:6px;background:#6b4e23;color:#fff;
                  cursor:pointer;font-weight:700;font-size:18px;line-height:18px;
                ">−</button>
              </div>

              <div id="tw-calib-body" style="margin-top:8px;">
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                  <input id="tw-calib-ms" type="number" min="0" max="999" step="1" placeholder="echte ms z.B. 530" style="
                    flex:1;box-sizing:border-box;padding:10px;border:1px solid #8b6b3f;
                    border-radius:6px;font-size:16px;
                  ">
                  <button id="tw-calib-add" style="
                    padding:10px;border:none;border-radius:6px;background:#6b4e23;color:#fff;
                    cursor:pointer;font-weight:700;
                  ">Eintragen</button>
                </div>

                <div style="font-size:12px;margin-bottom:4px;">Letzte Werte: <span id="tw-calib-list">-</span></div>
                <div id="tw-calib-avg" style="font-size:12px;margin-bottom:8px;">Ø: -</div>

                <div style="display:flex;gap:8px;">
                  <button id="tw-calib-apply" style="
                    flex:1;padding:9px;border:none;border-radius:6px;background:#2f8f2f;color:#fff;
                    cursor:pointer;font-weight:700;
                  ">Offset auto setzen</button>
                  <button id="tw-calib-clear" style="
                    padding:9px;border:none;border-radius:6px;background:#b33a3a;color:#fff;
                    cursor:pointer;font-weight:700;
                  ">Reset</button>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button id="tw-arrival-copy" style="
                flex:1;padding:10px;border:none;border-radius:6px;background:#6b4e23;color:#fff;
                cursor:pointer;font-weight:700;font-size:16px;">Aktuelle übernehmen</button>

              <button id="tw-arrival-arm" style="
                flex:1;padding:10px;border:none;border-radius:6px;background:#2f8f2f;color:#fff;
                cursor:pointer;font-weight:700;font-size:16px;">Scharf</button>
            </div>

            <button id="tw-arrival-stop" style="
              width:100%;margin-top:10px;padding:10px;border:none;border-radius:6px;
              background:#b33a3a;color:#fff;cursor:pointer;font-size:16px;">Stop</button>

            <div id="tw-arrival-status" style="margin-top:12px;font-size:14px;">Status: inaktiv</div>

            <pre id="tw-debug-log" style="
              margin-top:12px;background:#2f1d07;color:#f8e7bd;padding:8px;border-radius:6px;
              font-size:11px;max-height:120px;overflow:auto;white-space:pre-wrap;
            "></pre>

            <div style="margin-top:12px;font-size:12px;opacity:.85;">
              Titel ziehen = Maske bewegen. Maske und weiße Felder unten rechts ziehen = Größe ändern. Alles wird gespeichert.
            </div>
          `;

          document.body.appendChild(panel);

          restorePanelRect(panel);
          makePanelDraggable(panel, document.getElementById('tw-panel-title'));
          watchPanelResize(panel);

          document.getElementById('tw-arrival-target').value = localStorage.getItem(STORAGE_KEY_TARGET) || '';
          document.getElementById('tw-arrival-offset').value = localStorage.getItem(STORAGE_KEY_OFFSET) || '0';
          document.getElementById('tw-enemy-time').value = localStorage.getItem(STORAGE_KEY_ENEMY) || '';
          document.getElementById('tw-behind-ms').value = localStorage.getItem(STORAGE_KEY_BEHIND) || '10';

          setupResizableFields();

          const calibOpen = localStorage.getItem(STORAGE_KEY_CALIB_OPEN);
          setCalibOpen(calibOpen !== '0');

          document.getElementById('tw-calib-toggle').addEventListener('click', () => {
            const body = document.getElementById('tw-calib-body');
            setCalibOpen(body.style.display === 'none');
          });

          document.getElementById('tw-calc-target').addEventListener('click', calculateTargetFromEnemy);
          document.getElementById('tw-arrival-copy').addEventListener('click', setFromCurrentArrival);
          document.getElementById('tw-arrival-arm').addEventListener('click', armTimer);
          document.getElementById('tw-arrival-stop').addEventListener('click', () => {
            clearArmedState();
            toast('Timer gestoppt');
            log('Timer gestoppt');
          });

          document.getElementById('tw-calib-add').addEventListener('click', addCalibValue);
          document.getElementById('tw-calib-apply').addEventListener('click', applyAutoOffset);
          document.getElementById('tw-calib-clear').addEventListener('click', clearCalibValues);

          document.getElementById('tw-calib-ms').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCalibValue();
            }
          });

          ['tw-enemy-time', 'tw-behind-ms'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
              localStorage.setItem(STORAGE_KEY_ENEMY, document.getElementById('tw-enemy-time').value.trim());
              localStorage.setItem(STORAGE_KEY_BEHIND, document.getElementById('tw-behind-ms').value.trim());
            });
          });

          document.getElementById('tw-arrival-target').addEventListener('input', () => {
            localStorage.setItem(STORAGE_KEY_TARGET, document.getElementById('tw-arrival-target').value.trim());
            refreshCalibDisplay();
          });

          document.getElementById('tw-arrival-offset').addEventListener('input', () => {
            localStorage.setItem(STORAGE_KEY_OFFSET, document.getElementById('tw-arrival-offset').value.trim());
          });

          refreshCalibDisplay();
          log('Script geladen');
        }

        function refreshCurrentArrival() {
          const box = document.getElementById('tw-arrival-current');
          if (!box) return;
          box.textContent = getArrivalText() || '-';
        }

        function init() {
          buildPanel();
          refreshCurrentArrival();

          if (!STATE.refresh) {
            STATE.refresh = setInterval(refreshCurrentArrival, 100);
          }
        }


    function openSettings() {
        init();
        const panel = document.getElementById('tw-arrival-panel');
        if (panel) {
            panel.style.display = 'block';
            panel.classList.remove('twx-hidden');
        }
    }

    function destroy() {
        STATE.armed = false;
        if (STATE.timeout) clearTimeout(STATE.timeout);
        if (STATE.raf) cancelAnimationFrame(STATE.raf);
        if (STATE.refresh) clearInterval(STATE.refresh);
        STATE.timeout = null;
        STATE.raf = null;
        STATE.refresh = null;

        document.getElementById('tw-arrival-panel')?.remove();
        document.getElementById('tw-arrival-toast')?.remove();
    }

    window.TWCC_AttackTimerServerMS = Object.freeze({
        version: '4.5-external',
        init,
        openSettings,
        destroy
    });

    init();
})();
