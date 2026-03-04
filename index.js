// lorebook-linter — index.js
// Stage 1 v2: settings init, settings panel wiring, stale selection cleanup

import { initReader, getReaderState, runLintOnce } from './reader.js';
import { lintEntries } from './rules.js';

const MODULE_NAME = 'lorebook-linter';
const EXT_PATH = `scripts/extensions/third-party/${MODULE_NAME}`;

const defaultSettings = Object.freeze({
    enabled: true,
    selectedLorebooks: [],
});

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    const lodash = SillyTavern.libs.lodash;
    extensionSettings[MODULE_NAME] = lodash.merge(
        structuredClone(defaultSettings),
        extensionSettings[MODULE_NAME],
    );
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// Clean stale lorebook names from settings that no longer appear in discovery
function pruneStaleSelections() {
    const settings = getSettings();
    const available = new Set(getReaderState().availableLorebooks || []);
    const before = settings.selectedLorebooks.length;
    settings.selectedLorebooks = settings.selectedLorebooks.filter(n => available.has(n));
    if (before !== settings.selectedLorebooks.length) {
        console.log(`[${MODULE_NAME}] Pruned ${before - settings.selectedLorebooks.length} stale lorebook selections`);
        saveSettings();
    }
}

export function populateLorebookCheckboxes() {
    const container = $('#ll_lorebook_list');
    if (!container.length) return;

    const settings = getSettings();
    const selected = settings.selectedLorebooks || [];
    const state = getReaderState();
    const available = state.availableLorebooks || [];

    container.empty();

    if (available.length === 0) {
        container.html('<div class="ll-lorebook-empty">No active lorebooks detected. Set Active World(s) and reload chat.</div>');
        return;
    }

    for (const name of available) {
        const id = `ll_lb_${CSS.escape(name)}`;
        const checked = selected.includes(name) ? 'checked' : '';
        const item = $(
            `<label class="ll-lorebook-item">
                <input type="checkbox" id="${id}" value="${name}" ${checked} />
                <span>${escapeHtml(name)}</span>
            </label>`
        );
        item.find('input').on('change', () => {
            const settings = getSettings();
            const list = new Set(settings.selectedLorebooks || []);
            if (item.find('input').is(':checked')) {
                list.add(name);
            } else {
                list.delete(name);
            }
            settings.selectedLorebooks = [...list];
            saveSettings();
        });
        container.append(item);
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function wireRunButton() {
    const btn = $('#ll_run_lint');
    if (!btn.length) return;
    btn.off('click.ll');
    btn.on('click.ll', async () => {
        const settings = getSettings();
        const available = new Set(getReaderState().availableLorebooks || []);

        // Only lint lorebooks that are BOTH selected AND still available
        const selected = (settings.selectedLorebooks || []).filter(n => available.has(n));
        const report = $('#ll_report');

        if (selected.length === 0) {
                        const lintIssues = (lint && Array.isArray(lint.issues)) ? lint.issues : [];
            const errCount = lintIssues.filter(i => i.severity === 'error').length;
            const warnCount = lintIssues.filter(i => i.severity === 'warning').length;
            const infoCount = lintIssues.filter(i => i.severity === 'info').length;

            const healthLine = `Health: <b>${errCount}</b> errors · <b>${warnCount}</b> warnings · <b>${infoCount}</b> info`;

            const issuesHtml = lintIssues.slice(0, 200).map(i => {
                const world = escapeHtml(i.world || '');
                const title = escapeHtml(i.entryTitle || 'Untitled');
                const msg = escapeHtml(i.message || '');
                return `<div class="ll-issue ll-issue--${i.severity}">`
                    + `<span class="ll-issue-code">${i.ruleId}</span>`
                    + `<span class="ll-issue-title">[${world}] ${title}</span>`
                    + `<span class="ll-issue-msg">${msg}</span>`
                    + `</div>`;
            }).join('');

            report.html(
                `<div class="ll-summary">${healthLine}<br>` +
                `Scanned <b>${selected.length}</b> lorebook(s): ` +
                `<b>${totalEntries}</b> entries · ~<b>${totalTokens}</b> tokens` +
                `</div>` +
                (lintIssues.length
                    ? `<div class="ll-issues">${issuesHtml}</div>`
                    : `<div class="ll-issues ll-issues--empty">No issues found by core checks.</div>`),
            );
            return;
        }

        btn.prop('disabled', true).text('Scanning…');
        try {
            const result = await runLintOnce(selected);
        const lint = lintEntries(result.entries || []);
            const totalEntries = result.totalEntries || 0;
            const totalTokens = result.totalTokens || 0;

            // Per-lorebook breakdown
            const breakdown = selected.map(name => {
                const bookEntries = result.entries.filter(e => e.world === name);
                const bookTokens = bookEntries.reduce((s, e) => s + e.estimatedTokens, 0);
                return `<b>${escapeHtml(name)}</b>: ${bookEntries.length} entries · ~${bookTokens}t`;
            }).join('<br>');

            report.html(
                `<div class="ll-summary">` +
                `Scanned <b>${selected.length}</b> lorebook(s): <b>${totalEntries}</b> entries · ~<b>${totalTokens}</b> tokens` +
                `<br><br>${breakdown}</div>`
            );
        } catch (e) {
            console.error(`[${MODULE_NAME}] Run Lint error`, e);
            report.html('<div class="ll-summary ll-summary--error">Lint failed. See console for details.</div>');
        } finally {
            btn.prop('disabled', false).text('Run Lint');
        }
    });
}

async function loadSettingsPanel() {
    const html = await fetch(`${EXT_PATH}/settings.html`).then(r => r.text());
    $('#extensions_settings').append(html);
    wireRunButton();
}

jQuery(async () => {
    await loadSettingsPanel();
    initReader(populateLorebookCheckboxes);
    pruneStaleSelections();
    populateLorebookCheckboxes();
    console.log(`[${MODULE_NAME}] Initialized`);
});
