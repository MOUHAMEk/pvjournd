// Contrat commun au formulaire (y compris file://) et au Worker.
(() => {
    const kinds = ['note', 'count', 'quantity', 'new-person', 'new-stock'];
    const isText = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max;
    function requireValue(valid, message) {
        if (!valid) throw new Error(message);
    }
    function validateFields(fields) {
        requireValue(Array.isArray(fields) && fields.length > 0 && fields.length <= 350,
            'La dictée accepte entre 1 et 350 champs journaliers par analyse.');
        const ids = new Set();
        for (const f of fields) {
            requireValue(f && isText(f.id, 500) && isText(f.label, 500) && isText(f.section, 500)
                && f.scope === 'daily' && kinds.includes(f.type) && !ids.has(f.id), 'Catalogue de champs invalide.');
            const [group, key, prop, extra] = f.id.split('/');
            const table = group === 'personnelSection' || group === 'stockSection';
            const personnel = group === 'personnelSection';
            const valid = f.type === 'note'
                ? group === 'note' && !!key && !['descriptionSection','personnelSection','stockSection','transmitSection'].includes(key) && prop === 'content'
                : table && !!key && (key === 'new'
                    ? prop === 'row' && f.type === (personnel ? 'new-person' : 'new-stock')
                    : prop === 'value' && f.type === (personnel ? 'count' : 'quantity'));
            requireValue(valid && extra === undefined, 'Destination non autorisée.');
            ids.add(f.id);
        }
        return fields;
    }
    const digits = text => text.replace(/[٠-٩۰-۹]/g, c => (c.charCodeAt(0) & 15).toString())
        .replace(/٫/g, '.').replace(/(\d),(\d)/g, '$1.$2');
    const numbers = text => digits(text).match(/[-+]?\d+(?:\.\d+)?/g) || [];
    const canonical = text => text.normalize('NFC').toLocaleLowerCase('fr').trim();
    // Les tableaux acceptent une traduction vérifiable des matériaux, rôles et unités.
    const variants = new Map();
    for (const [fr, ar] of Object.entries(globalThis.PvVoiceLexique.travaux)) {
        for (const term of ar.split(' / ')) {
            variants.set(term, fr);
            variants.set('ال' + term, fr);
        }
    }
    const escapePattern = text => text.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const terms = [...variants.keys()].sort((a,b) => b.length - a.length).map(escapePattern).join('|');
    const boundary = '[^\\p{L}\\p{N}\\p{M}]';
    const translation = new RegExp('(^|' + boundary + ')(' + terms + ')(?=$|' + boundary + ')', 'gu');
    function grounded(source, value) {
        const phrase = canonical(digits(value));
        const quote = canonical(digits(source));
        const whole = new RegExp('(^|' + boundary + ')' + escapePattern(phrase) + '(?=$|' + boundary + ')', 'u');
        return whole.test(quote) || whole.test(quote.replace(translation, (_,prefix,term) => prefix + variants.get(term)));
    }
    function validateResult(result, fields, transcript) {
        validateFields(fields);
        requireValue(isText(transcript, 12000), 'La transcription doit contenir entre 1 et 12 000 caractères.');
        requireValue(result && Object.keys(result).length === 1 && Array.isArray(result.changes) && result.changes.length <= 120,
            'Format des propositions invalide.');
        const byId = new Map(fields.map(f => [f.id, f]));
        const seen = new Set();
        for (const c of result.changes) {
            requireValue(c && Object.keys(c).sort().join(',') === 'evidence,fieldId,rowLabel,value',
                'Proposition incomplète.');
            const field = byId.get(c.fieldId);
            requireValue(field && isText(c.evidence, 2500) && transcript.includes(c.evidence)
                && typeof c.value === 'string' && c.value.length <= 2500 && typeof c.rowLabel === 'string',
                'Champ inconnu ou extrait absent de la transcription.');
            const newRow = field.type.startsWith('new-');
            requireValue(newRow ? isText(c.rowLabel, 150) && grounded(c.evidence, c.rowLabel)
                : c.rowLabel === '', 'Intitulé de ligne non justifié.');
            const key = JSON.stringify([field.id, canonical(c.rowLabel)]);
            requireValue(!seen.has(key), 'Deux propositions visent le même champ.');
            seen.add(key);
            requireValue((newRow && c.value === '') || isText(c.value, 2500), 'Valeur vide.');
            const proof = numbers(c.evidence);
            requireValue(numbers(c.value).every(n => proof.includes(n)), 'Un nombre proposé est absent de son extrait.');
            if (field.type !== 'note' && c.value !== '') {
                const uncertain = /inconnu|indéterminé|non (?:précis|renseign|communiqu|compt|confirm)|à (?:confirmer|vérifier|compter)|غير (?:معروف|محدد|مؤكد)|لم (?:يحدد|يُحدد|يذكر)|ما نعرف/iu;
                requireValue(!uncertain.test(c.evidence), 'Une valeur incertaine doit rester vide.');
            }
            if (['count','new-person'].includes(field.type) && c.value !== '') {
                requireValue(/^(0|[1-9]\d*)$/.test(c.value) && Number.isSafeInteger(Number(c.value)),
                    'Un effectif doit être un entier positif ou nul explicitement dicté en chiffres.');
            }
            if (['quantity','new-stock'].includes(field.type) && c.value !== '') {
                requireValue(grounded(c.evidence, c.value),
                    'La quantité et son unité doivent être reprises ensemble dans l’extrait.');
            }
        }
        return result.changes;
    }
    const responseSchema = {type:'object', additionalProperties:false, required:['changes'], properties:{
        changes:{type:'array', items:{type:'object', additionalProperties:false,
            required:['fieldId','rowLabel','value','evidence'], properties:{
                fieldId:{type:'string'}, rowLabel:{type:'string'}, value:{type:'string'}, evidence:{type:'string'}
            }}}
    }};
    globalThis.PvVoiceContract = Object.freeze({validateFields, validateResult, responseSchema, canonical, grounded});
})();
