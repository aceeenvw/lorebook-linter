// lorebook-linter — rules.js
// Stage 2, Part 2: core lint rules (keywords, JSON sync, empty content)

const MODULE_NAME = 'lorebook-linter';

// Helper: safe array
function asArray(val) {
    return Array.isArray(val) ? val : (val ? [val] : []);
}

// Core lint implementation
export function lintEntries(entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const issues = [];

    const stats = {
        totalEntries: safeEntries.length,
        totalTokens: safeEntries.reduce((sum, e) => sum + (e.estimatedTokens || 0), 0),
    };

    for (const entry of safeEntries) {
        runKeywordRules(entry, issues);
        runSyncRules(entry, issues);
        runContentRules(entry, issues);
    }

    console.log(
        `[${MODULE_NAME}] lintEntries: ${stats.totalEntries} entries, ~${stats.totalTokens}t, ${issues.length} issues`,
    );

    return { issues, stats };
}

function makeIssue(ruleId, severity, entry, message, details) {
    return {
        ruleId,
        severity,
        entryUid: entry.uid,
        entryTitle: entry.title || 'Untitled',
        world: entry.world || 'Unknown',
        message,
        details: details || '',
    };
}

// ── Keyword rules ──

function runKeywordRules(entry, out) {
    const keys = asArray(entry.keys || entry.key);

    // KW-001: no primary keywords and not constant
    if ((!keys || keys.length === 0) && !entry.constant) {
        out.push(makeIssue(
            'KW-001',
            'error',
            entry,
            'Entry has no primary keywords and is not constant — it will never trigger.',
            'Add 3–10 primary keywords, or set constant=true only for global AI rules.',
        ));
    }
}

// ── JSON sync rules ──

function runSyncRules(entry, out) {
    const ext = entry.extensions || entry.extension || {};
    if (!ext || typeof ext !== 'object') return;

    const fields = [
        ['position', 'SYNC-001'],
        ['depth', 'SYNC-002'],
        ['role', 'SYNC-003'],
        ['sticky', 'SYNC-004'],
        ['cooldown', 'SYNC-005'],
        ['delay', 'SYNC-006'],
    ];

    for (const [field, ruleId] of fields) {
        const top = entry[field];
        const extVal = ext[field];
        if (top === undefined || extVal === undefined) continue;
        if (top !== extVal) {
            out.push(makeIssue(
                ruleId,
                'error',
                entry,
                `extensions.${field} (${String(extVal)}) != ${field} (${String(top)}).`,
                'SillyTavern reads top-level values; keep extensions and top-level in sync.',
            ));
        }
    }
}

// ── Content rules ──

function runContentRules(entry, out) {
    const content = entry.content || '';
    const trimmed = String(content).trim();

    // CONT-001: empty content
    if (!trimmed) {
        out.push(makeIssue(
            'CONT-001',
            'warning',
            entry,
            'Entry content is empty; this entry does nothing.',
            'Either remove the entry or add descriptive content.',
        ));
    }
}
