// Protocole partagé entre le Worker et le formulaire. Chaque modification désigne
// sa source exacte dans la dictée et, pour une correction, dans le rapport.
(() => {
    const actions = ['append','replace','remove','move','set','increment','create','removeRow'];
    const rich = type => ['note','rich-text'].includes(type);
    const creation = type => ['new-person','new-stock','new-section'].includes(type);
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const fold = s => s.normalize('NFKC').toLocaleLowerCase('fr').replace(/[\u064b-\u065f]/g,'')
        .replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) & 15)).replace(/٫/g,'.').replace(/(\d),(?=\d)/g,'$1.')
        .replace(/([\p{L}])[-‑–](?=\p{L})/gu,'$1 ').replace(/\s+/g,' ').trim();
    const units = 'zéro un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize'.split(' ');
    function french(n) {
        if (n < 17) return units[n];
        if (n < 20) return 'dix ' + units[n-10];
        if (n >= 80) return n === 80 ? 'quatre vingts' : 'quatre vingt ' + french(n-80);
        if (n >= 70) return 'soixante ' + (n === 71 ? 'et ' : '') + french(n-60);
        return ['','','vingt','trente','quarante','cinquante','soixante'][Math.floor(n/10)]
            + (n % 10 ? (n % 10 === 1 ? ' et ' : ' ') + units[n%10] : '');
    }
    const words = new Map(Array.from({length:100}, (_,i) => [french(i),String(i)]));
    for (const [i, forms] of ['صفر','واحد واحدة une premier première','اثنان اثنين اثنتان اثنتين زوج ثاني deuxième','ثلاث ثلاثة ثالث troisième','أربعة أربع اربع اربعة رابع quatrième','خمسة خمس خامس cinquième','ستة ست سادس sixième','سبعة سبع سابع septième','ثمانية ثماني ثمان huitième','تسعة تسع neuvième','عشرة عشر dixième'].entries()) {
        for (const term of forms.split(' ')) words.set(term,String(i));
    }
    for (const [fr, values] of Object.entries(PvVoiceLexique.travaux)) {
        for (const ar of values.split(' / ')) for (const prefix of ['','ال']) words.set(fold(prefix + ar),fr);
    }
    for (const [fr, variants] of Object.entries(PvVoiceLexique.variantesFR || {})) {
        for (const term of variants.split(' / ')) words.set(fold(term),fr);
    }
    for (const word of ['طنان','طنين']) words.set(word,'2 tonnes');
    const pattern = new RegExp('(^|[^\\p{L}\\p{N}])(' + [...words.keys()].sort((a,b)=>b.length-a.length).join('|') + ')(?![\\p{L}\\p{N}])','gu');
    function normalized(s) {
        return fold(s).replace(/و[\u0621-\u064a]+/gu,word=>words.has(word.slice(1))?word.slice(1):word).replace(/(^|[^\p{L}])ال(?=خامس|رابع|ثاني)/gu,'$1')
            .replace(pattern, (_,prefix,term) => prefix+words.get(term)).replace(/(\d)(?:ᵉ|ème|eme|e)(?!\p{L})/gu,'$1');
    }
    const numbers = s => normalized(s).match(/[-+]?\d+(?:\.\d+)?/g) || [];
    function fieldsOK(fields) {
        check(Array.isArray(fields) && fields.length && fields.length <= 350,'Catalogue du rapport trop grand ou vide.');
        const ids = new Set();
        for (const f of fields) {
            check(f && ['id','type','label','section','current'].every(k=>typeof f[k] === 'string')
                && f.id && f.id.length <= 500 && f.section.length <= 500 && f.label.length <= 500
                && f.current.length <= 16000 && ['daily','permanent'].includes(f.scope) && !ids.has(f.id)
                && ['note','rich-text','count','quantity','new-person','new-stock','new-section','text','number','select','boolean','date'].includes(f.type),
                'Champ de contexte invalide ou trop long.');
            ids.add(f.id);
        }
    }
    const properties = Object.fromEntries(['fieldId','rowLabel','value','evidence','target','destination'].map(k=>[k,{type:'string'}]));
    properties.action = {type:'string',enum:actions};
    const schema = {type:'object',additionalProperties:false,required:['changes','question'],properties:{
        question:{type:'string'},changes:{type:'array',items:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}
    }};
    function validate(result, fields, transcript) {
        fieldsOK(fields);
        check(result && Array.isArray(result.changes) && result.changes.length <= 120 && typeof result.question === 'string' && result.question.length <= 1000, 'Réponse de l’assistant incomplète.');
        const byId = new Map(fields.map(f=>[f.id,f]));
        const changesSeen=new Set(), scalars=new Set();
        for (const c of result.changes) {
            check(c && Object.keys(properties).every(k=>typeof c[k] === 'string' && c[k].length <= 12000)
                && actions.includes(c.action) && c.evidence.trim() && transcript.includes(c.evidence),'Proposition sans extrait vérifiable.');
            const f = byId.get(c.fieldId);
            check(f && (creation(f.type) === (c.action === 'create')), 'Destination non disponible.');
            const key=JSON.stringify([c.fieldId,c.action,fold(c.rowLabel),c.target,c.destination,fold(c.value)]);
            check(!changesSeen.has(key),'Une même modification est proposée deux fois.');
            changesSeen.add(key);
            if (!creation(f.type) && !rich(f.type)) {
                check(!scalars.has(f.id),'Plusieurs valeurs concernent le même champ. Précisez la valeur finale.');
                scalars.add(f.id);
            }
            check(creation(f.type) ? !!c.rowLabel.trim() && c.rowLabel.length <= 150 : !c.rowLabel,'Intitulé de création invalide.');
            const edit = ['replace','remove','move'].includes(c.action);
            if (edit) check(rich(f.type) && c.target && f.current.includes(c.target) && f.current.indexOf(c.target) === f.current.lastIndexOf(c.target),'Le passage à modifier doit être identifiable une seule fois.');
            else check(!c.target,'Cible inattendue.');
            if (c.action === 'move') check(c.destination !== f.id && rich(byId.get(c.destination)?.type),'Rubrique de déplacement invalide.');
            else check(!c.destination,'Destination supplémentaire inattendue.');
            if (['remove','move','removeRow'].includes(c.action)) check(!c.value,'Suppression ou déplacement invalide.');
            else check(c.value.trim() || ['new-person','new-stock'].includes(f.type),'Valeur proposée vide.');
            if (c.action === 'removeRow') check(['count','quantity'].includes(f.type),'Ligne non disponible.');
            if (c.action === 'append') check(rich(f.type),'Ajout de texte impossible dans ce champ.');
            if (c.action === 'set') check(!rich(f.type),'Précisez le passage à remplacer.');
            if (c.action === 'increment') check(f.type === 'count' && /^\d+$/.test(f.current),'Effectif initial inconnu.');
            if (['count','new-person'].includes(f.type) && c.value) check(/^(0|[1-9]\d{0,8})$/.test(c.value),'Effectif entier attendu.');
            if (['count','new-person','quantity','new-stock'].includes(f.type) && c.value) {
                check(!/inconnu|non (?:précisé|confirmé|compté)|à (?:confirmer|vérifier)|غير (?:معروف|محدد|مؤكد)|ما نعرف/iu.test(c.evidence),'Cette valeur est incertaine. Pouvez-vous la confirmer ?');
            }
            const proof = numbers(c.evidence + ' ' + c.target);
            if (!['boolean','select','date'].includes(f.type)) check(numbers(c.value).every(n=>proof.includes(n)), 'Un nombre proposé demande confirmation. Précisez sa valeur en chiffres.');
            if (['quantity','new-stock'].includes(f.type) && c.value) {
                const quote = normalized(c.evidence);
                check(quote.includes(normalized(c.value)) || PvVoiceContract.grounded(c.evidence,c.value),'Précisez la quantité et son unité ensemble.');
            }
            if (['new-person','new-stock'].includes(f.type)) {
                const label = normalized(c.rowLabel).replace(/s$/,'');
                check(normalized(c.evidence).includes(label) || PvVoiceContract.grounded(c.evidence,c.rowLabel),'Précisez le nom de la nouvelle ligne.');
            }
            if (f.type === 'boolean') check(['true','false'].includes(c.value),'Valeur de case incorrecte.');
            if (f.type === 'select') check(['before','after'].includes(c.value),'Position incorrecte.');
            if (f.type === 'number') {
                const ranges = {pdfFontSize:[7,18],pdfLineSpacing:[1,2],sizeDisplay:[50,200]};
                const range = ranges[f.id];
                check(range && Number.isFinite(+c.value) && +c.value >= range[0] && +c.value <= range[1],'Réglage hors limites.');
            }
            if (f.type === 'date') check(/^\d{4}-\d{2}-\d{2}$/.test(c.value) && new Date(c.value+'T00:00Z').toISOString().startsWith(c.value),'Date incorrecte.');
        }
        return result;
    }
    globalThis.PvVoiceOps = Object.freeze({schema, validate, fieldsOK, rich, creation, normalized});
})();
