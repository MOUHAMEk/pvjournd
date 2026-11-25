function addVoicePermission(section, daily) {
    const label = document.createElement('label');
    label.className = 'voice-permission';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'voice-daily';
    check.checked = daily === true;
    label.append(check, 'Contenu journalier · autoriser la dictée');
    section.append(label);
}

// L'identité appartient à la rubrique ou à la ligne, jamais à son rang ni à son titre.
function voiceCatalog() {
    const fields = new Map();
    function field(id, section, label, type, daily, node) {
        if (fields.has(id)) throw new Error('Deux champs ont le même identifiant. Vérifiez les rubriques du rapport.');
        fields.set(id, {id, section, label, type, scope:daily ? 'daily' : 'permanent', node});
    }
    for (const node of document.querySelectorAll('#allSections > .custom-section,#freeSections > .free-section,#transmitSection')) {
        const section = node.querySelector('h3')?.textContent || node.querySelector('.free-title')?.value || 'Rubrique sans titre';
        const id = encodeURIComponent(node.id);
        const daily = !!node.querySelector('.voice-daily:checked') && !node.querySelector('.section-checkbox:not(:checked)');
        const title = node.querySelector('h3,.free-title');
        field(id + '/title', section, 'Titre', 'text', false, title);
        if (node.id === 'descriptionSection') {
            for (const entry of node.querySelectorAll('.project-field')) {
                const label = entry.querySelector('.project-label');
                const key = id + '/' + encodeURIComponent(entry.dataset.id);
                field(key + '/label', section, 'Intitulé', 'text', false, label);
                field(key + '/content', section, label.value || 'Champ projet', 'rich-text', false, entry.querySelector('.rich-editor'));
            }
        } else if (['personnelSection','stockSection'].includes(node.id)) {
            const people = node.id === 'personnelSection';
            for (const row of node.querySelectorAll('.personnel-item')) {
                const [label, value] = row.querySelectorAll('input');
                const key = id + '/' + encodeURIComponent(row.dataset.rowId);
                field(key + '/label', section, people ? 'Rôle' : 'Article', 'text', false, label);
                field(key + '/value', section, label.value.trim() || 'Ligne sans intitulé', people ? 'count' : 'quantity', daily && !!label.value.trim(), value);
            }
            field(id + '/new/row', section, people ? 'Nouveau rôle' : 'Nouvel article', people ? 'new-person' : 'new-stock', daily, node);
        } else {
            field('note/' + id + '/content', section, 'Contenu', 'note', daily, node.querySelector('.rich-editor'));
        }
        const position = node.querySelector('.free-position');
        if (position) field(id + '/position', section, 'Position', 'select', false, position);
        const included = node.querySelector('.section-checkbox');
        if (included) field(id + '/included', section, 'Inclure dans le PDF', 'boolean', false, included);
    }
    for (const [id, label, type] of [
        ['inspectionDate','Date','date'], ['reportTitle','Titre','text'], ['includeDate','Afficher la date','boolean'],
        ['logoInput','Logo','image'], ['sizeDisplay','Échelle du logo','number'],
        ['pdfFontSize','Corps du texte','number'], ['pdfLineSpacing','Interligne','number']
    ]) field(id, 'Réglages manuels', label, type, false, $(id));
    for (const card of document.querySelectorAll('.photo-card')) {
        const name = card.querySelector('h3').textContent;
        field(card.dataset.id + '/image', name, 'Photo', 'image', false, card.querySelector('input'));
        field(card.dataset.id + '/caption', name, 'Légende', 'text', false, card.querySelector('textarea'));
    }
    return fields;
}

function dailyDescriptors(catalog) {
    return [...catalog.values()].filter(f => f.scope === 'daily')
        .map(({id, section, label, type, scope}) => ({id, section, label, type, scope}));
}

function voiceBefore(field) {
    if (field.type === 'note') return field.node.innerHTML;
    if (field.type.startsWith('new-')) return '';
    return field.node.value;
}

function voicePlan(result, transcript) {
    const catalog = voiceCatalog();
    const changes = PvVoiceContract.validateResult(result, dailyDescriptors(catalog), transcript);
    return changes.map(change => {
        const field = catalog.get(change.fieldId);
        if (field.type.startsWith('new-') && [...field.node.querySelectorAll('.role-input')].some(
            input => PvVoiceContract.canonical(input.value) === PvVoiceContract.canonical(change.rowLabel))) {
            throw new Error('Cette ligne existe déjà. Utilisez le champ existant ou corrigez la transcription.');
        }
        return {change, field, before:voiceBefore(field)};
    });
}

function writeVoicePlan(plan) {
    return plan.map(({change, field, before}) => {
        if (field.type.startsWith('new-')) {
            const add = field.type === 'new-person' ? addPersonnelField : addStockField;
            const row = add(change.rowLabel, change.value);
            return {field, row, change};
        }
        if (field.type === 'note') {
            if (htmlText(before).trim()) field.node.append(document.createElement('br'));
            field.node.insertAdjacentHTML('beforeend', plainHTML(change.value));
        } else field.node.value = change.value;
        return {field, before, after:voiceBefore(field)};
    });
}

function undoVoicePlan(entries) {
    const catalog = voiceCatalog();
    let restored = 0;
    for (const {field, row, change, before, after} of entries) {
        const live = catalog.get(field.id);
        if (live?.scope !== 'daily' || live.node !== field.node || live.label !== field.label) continue;
        if (row) {
            const [label, value] = row.querySelectorAll('input');
            if (!row.isConnected || label.value !== change.rowLabel || value.value !== change.value) continue;
            row.remove();
        } else {
            if (voiceBefore(field) !== after) continue;
            if (field.type === 'note') field.node.innerHTML = before;
            else field.node.value = before;
        }
        restored++;
    }
    if (restored) markChanged();
    return restored;
}
