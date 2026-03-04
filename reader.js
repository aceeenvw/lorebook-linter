// lorebook-linter — reader.js
// Stage 1 v4: multi-lorebook fix + auto-refresh on Active World change

import { populateLorebookCheckboxes } from './index.js';

const MODULE_NAME = 'lorebook-linter';

const state = {
    availableLorebooks: [],
    loadedEntries: {},
};

let _onDiscovery = null;

export function initReader(onDiscovery) {
    _onDiscovery = onDiscovery;
    discoverLorebooks();
    if (typeof onDiscovery === 'function') onDiscovery();
    watchForChanges();
}

export function getReaderState() {
    return state;
}

export async function runLintOnce(names) {
    const allEntries = [];
    let totalTokens = 0;

    for (const name of names) {
        try {
            const entries = await readAllEntries(name);
            state.loadedEntries[name] = entries;
            for (const raw of entries) {
                const proc = processEntryForLint(raw, name);
                allEntries.push(proc);
                totalTokens += proc.estimatedTokens;
            }
            console.log(`[${MODULE_NAME}] "${name}": ${entries.length} entries`);
        } catch (e) {
            console.error(`[${MODULE_NAME}] Error reading "${name}":`, e);
        }
    }

    console.log(`[${MODULE_NAME}] Lint scan complete: ${allEntries.length} entries from [${names.join(', ')}]`);
    return { entries: allEntries, totalEntries: allEntries.length, totalTokens };
}

// ── Discovery ──

function refreshDiscovery() {
    discoverLorebooks();
    if (typeof _onDiscovery === 'function') _onDiscovery();
    console.log(`[${MODULE_NAME}] Discovery refreshed → [${state.availableLorebooks.join(', ')}]`);
}

function discoverLorebooks() {
    const ctx = SillyTavern.getContext();
    const found = new Set();

    // 1. Chat metadata
    const meta = ctx.chatMetadata;
    if (meta) {
        for (const prop of ['world_info', 'worldinfo']) {
            const val = meta[prop];
            if (val && typeof val === 'string' && val.trim()) {
                found.add(val.trim());
            } else if (Array.isArray(val)) {
                val.forEach(n => { if (n && typeof n === 'string' && n.trim()) found.add(n.trim()); });
            }
        }
    }

    // 2. DOM: Active World(s) — iterate EACH selected option individually
    try {
        // #world_info: use option TEXT only (val() is often a numeric index)
        $('#world_info option:selected').each(function () {
            const text = $(this).text()?.trim();
            if (text && text !== 'None' && text !== '' && text.length > 1) {
                found.add(text);
            }
        });

        // Extra active worlds — select2 tags
        $('#character_extra_world_info_selector .select2-selection__choice').each(function () {
            const name = $(this).attr('title') || $(this).text()?.replace('×', '').trim() || '';
            if (name.trim() && name.length > 1) {
                found.add(name.trim());
            }
        });

        // Additional extra world info selectors
        const extraSelectors = [
            '#world_info_character_strategy_extras option:selected',
            '#character_extra_world_info option:selected',
        ];
        for (const sel of extraSelectors) {
            $(sel).each(function () {
                const text = $(this).text()?.trim() || '';
                if (text && text !== 'None' && text.length > 1) {
                    found.add(text);
                }
            });
        }
    } catch (e) {
        console.log(`[${MODULE_NAME}] DOM discovery error (non-fatal):`, e.message);
    }

    // 3. Context arrays
    const ACTIVE_KEYS = ['selectedWorldInfo', 'activeWorldInfo', 'enabledWorldInfo'];
    for (const key of ACTIVE_KEYS) {
        const val = ctx[key];
        if (Array.isArray(val)) {
            for (const n of val) {
                if (n && typeof n === 'string' && n.trim().length > 1) found.add(n.trim());
            }
        }
    }

    state.availableLorebooks = [...found].filter(n => !/^\d+$/.test(n)).sort();
    console.log(`[${MODULE_NAME}] Active lorebooks: ${state.availableLorebooks.length} → [${state.availableLorebooks.join(', ')}]`);
}

// ── Auto-refresh: watch Active World(s) changes ──

function watchForChanges() {
    // Watch the Active World(s) dropdown for changes
    $(document).on('change', '#world_info', () => {
        console.log(`[${MODULE_NAME}] #world_info changed`);
        setTimeout(refreshDiscovery, 300);
    });

    // Watch extra world info selector
    $(document).on('change', '#character_extra_world_info', () => {
        console.log(`[${MODULE_NAME}] Extra world info changed`);
        setTimeout(refreshDiscovery, 300);
    });

    // Watch select2 mutations (for tag additions/removals)
    const extraContainer = document.querySelector('#character_extra_world_info_selector');
    if (extraContainer) {
        const observer = new MutationObserver(() => {
            console.log(`[${MODULE_NAME}] Extra world info selector mutated`);
            setTimeout(refreshDiscovery, 300);
        });
        observer.observe(extraContainer, { childList: true, subtree: true });
    }

    // Watch ST chat changes
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`[${MODULE_NAME}] Chat changed — refreshing discovery`);
            setTimeout(refreshDiscovery, 500);
        });
    } catch (e) {
        console.log(`[${MODULE_NAME}] Could not bind CHAT_CHANGED:`, e.message);
    }
}

// ── Entry Reader ──

function getHeaders() {
    try {
        const ctx = SillyTavern.getContext();
        if (typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
    } catch (_) {}
    return { 'Content-Type': 'application/json' };
}

function extractEntries(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;

    if (data.entries && typeof data.entries === 'object') {
        const vals = Object.values(data.entries);
        if (vals.length > 0) return vals;
    }

    const keys = Object.keys(data);
    if (keys.length > 0 && data[keys[0]]?.uid !== undefined) {
        return Object.values(data);
    }

    return [];
}

async function readAllEntries(name) {
    const ctx = SillyTavern.getContext();
    const headers = getHeaders();

    // Strategy 1: ST memory cache
    for (const prop of ['worldInfo', 'world_info', 'worldInfoData']) {
        const container = ctx[prop];
        if (container && typeof container === 'object' && !Array.isArray(container)) {
            if (container[name]) {
                const entries = extractEntries(container[name]);
                if (entries.length > 0) {
                    console.log(`[${MODULE_NAME}] ✓ ctx.${prop}["${name}"] → ${entries.length} entries`);
                    return entries;
                }
            }
        }
    }

    // Strategy 2: getWorldInfoData function
    if (typeof ctx.getWorldInfoData === 'function') {
        try {
            const data = await ctx.getWorldInfoData(name);
            const entries = extractEntries(data);
            if (entries.length > 0) {
                console.log(`[${MODULE_NAME}] ✓ getWorldInfoData("${name}") → ${entries.length} entries`);
                return entries;
            }
        } catch (e) {
            console.log(`[${MODULE_NAME}] getWorldInfoData failed for "${name}":`, e.message);
        }
    }

    // Strategy 3: /api/worldinfo/get
    try {
        const res = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name }),
        });
        if (res.ok) {
            const json = await res.json();
            const entries = extractEntries(json);
            if (entries.length > 0) {
                console.log(`[${MODULE_NAME}] ✓ /api/worldinfo/get → ${entries.length} entries for "${name}"`);
                return entries;
            }
            console.log(`[${MODULE_NAME}] /api/worldinfo/get: 0 entries. Top keys:`, Object.keys(json).slice(0, 5));
        } else {
            console.log(`[${MODULE_NAME}] /api/worldinfo/get HTTP ${res.status} for "${name}"`);
        }
    } catch (e) {
        console.log(`[${MODULE_NAME}] /api/worldinfo/get error for "${name}":`, e.message);
    }

    // Strategy 4: legacy endpoint
    try {
        const res = await fetch('/getworldinfo', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name }),
        });
        if (res.ok) {
            const json = await res.json();
            const entries = extractEntries(json);
            if (entries.length > 0) {
                console.log(`[${MODULE_NAME}] ✓ /getworldinfo → ${entries.length} entries for "${name}"`);
                return entries;
            }
        }
    } catch (_) {}

    console.warn(`[${MODULE_NAME}] ✗ readAllEntries FAILED for "${name}"`);
    return [];
}

// ── Entry Processing ──

function processEntryForLint(entry, worldName) {
    const charCount = entry.content?.length || 0;
    const estimatedTokens = Math.round(charCount / 3.5);

    return {
        uid: entry.uid,
        world: worldName,
        title: entry.comment || entry.key?.[0] || 'Untitled',
        position: entry.position,
        depth: entry.depth,
        order: entry.order,
        charCount,
        estimatedTokens,
        constant: !!entry.constant,
        sticky: entry.sticky || 0,
        cooldown: entry.cooldown || 0,
        delay: entry.delay || 0,
        role: entry.role ?? null,
        keys: entry.key || [],
        secondaryKeys: entry.keysecondary || [],
        selective: !!entry.selective,
        selectiveLogic: entry.selectiveLogic,
        matchScenario: !!entry.matchScenario,
        matchCharacterDescription: !!entry.matchCharacterDescription,
        matchCharacterPersonality: !!entry.matchCharacterPersonality,
        matchPersonaDescription: !!entry.matchPersonaDescription,
        matchCreatorNotes: !!entry.matchCreatorNotes,
        matchCharacterDepthPrompt: !!entry.matchCharacterDepthPrompt,
        preventRecursion: !!entry.preventRecursion,
        excludeRecursion: !!entry.excludeRecursion,
        delayUntilRecursion: !!entry.delayUntilRecursion,
        probability: entry.probability,
        group: entry.group,
        groupWeight: entry.groupWeight,
        disable: !!entry.disable,
        scanDepth: entry.scanDepth,
        caseSensitive: !!entry.caseSensitive,
        matchWholeWords: !!entry.matchWholeWords,
        useGroupScoring: !!entry.useGroupScoring,
        automationId: entry.automationId,
        content: entry.content || '',
    };
}
