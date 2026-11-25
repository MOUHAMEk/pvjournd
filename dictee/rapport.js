function assistantCatalog(extended) {
    const catalog = voiceCatalog();
    for (const [id,f] of catalog) {
        const excluded = f.node?.closest('.custom-section,.free-section');
        const permission = excluded?.querySelector('.voice-daily');
        if (!f.node || f.type === 'image' || (f.scope !== 'daily' && !extended)
            || (permission && !permission.checked) || (excluded?.querySelector('.section-checkbox:not(:checked)') && !id.endsWith('/included'))) catalog.delete(id);
    }
    catalog.set('sections/new',{id:'sections/new',type:'new-section',label:'Nouvelle rubrique',section:'Rubriques du rapport',scope:'daily',node:$('allSections')});
    return catalog;
}
function richIndex(root) {
    let text = '';
    const ranges = [];
    function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const start = text.length;
            text += node.data;
            ranges.push({start,end:text.length,node});
            return;
        }
        if (node.nodeName === 'BR') { text += '\n'; return; }
        const block = ['P','DIV'].includes(node.nodeName) && node !== root;
        if (block && text && !text.endsWith('\n')) text += '\n';
        node.childNodes.forEach(visit);
        if (block && !text.endsWith('\n')) text += '\n';
    }
    visit(root);
    return {text:text.replace(/\n$/,''),ranges};
}
function assistantValue(f) {
    if (PvVoiceOps.creation(f.type)) return '';
    if (PvVoiceOps.rich(f.type)) return f.node.innerHTML;
    if (f.type === 'boolean') return String(f.node.checked);
    if (f.id === 'sizeDisplay') return String(Math.round(logoScale*100));
    return f.node.value ?? f.node.textContent;
}
function assistantText(f,value) {
    if (!PvVoiceOps.rich(f.type)) return value;
    const div = document.createElement('div');
    div.innerHTML = value;
    return richIndex(div).text;
}
function assistantFields(catalog) {
    return [...catalog.values()].map(({node,...f})=>({...f,current:assistantText(f,assistantValue({...f,node}))}));
}
function assistantPlan(result, transcript, extended, edits = new Map()) {
    const catalog = assistantCatalog(extended), fields = assistantFields(catalog);
    PvVoiceOps.validate(result,fields,transcript);
    const shadow = new Map(), created = new Set(), removed = new Set();
    const norm = s => s.normalize('NFKC').toLocaleLowerCase('fr').replace(/^\s*[-•]\s*/gm,'').replace(/[.\s]+$/,'').replace(/\s+/g,' ').trim();
    function edit(f, fn) {
        if (removed.has(f.id)) throw Error('Cette ligne est déjà supprimée.');
        const before = shadow.has(f.id) ? shadow.get(f.id) : assistantValue(f);
        const after = fn(before);
        shadow.set(f.id,after);
        return {f,before,after};
    }
    function append(div, text, fragment) {
        const old = richIndex(div).text.trim();
        if (text.split('\n').filter(s=>s.trim()).every(s=>old.split('\n').some(line=>norm(line)===norm(s)))) return false;
        if (!fragment && old) text = text.split('\n').filter(s=>!s.trim() || !old.split('\n').some(line=>norm(line)===norm(s))).join('\n');
        if (old && !['BR','P','DIV'].includes(div.lastChild?.nodeName)) div.append(document.createElement('br'));
        if (fragment) div.append(fragment);
        else div.insertAdjacentHTML('beforeend',plainHTML(text));
        return true;
    }
    return result.changes.flatMap(original=>{
        const c = edits.has(original) ? {...original,value:edits.get(original)} : original;
        if (c !== original) {
            const evidence = [c.evidence,c.rowLabel,c.value].join('\n');
            PvVoiceOps.validate({question:'',changes:[{...c,evidence}]},fields,evidence);
        }
        const field = catalog.get(c.fieldId), writes = [];
        let fragment;
        if (PvVoiceOps.creation(field.type)) {
            const key = field.id + '|' + norm(c.rowLabel);
            const existing = field.type === 'new-section' ? [...voiceCatalog().values()].map(f=>f.section)
                : [...field.node.querySelectorAll('.role-input')].map(n=>n.value);
            if (existing.some(v=>norm(v)===norm(c.rowLabel))) throw Error('Cet intitulé existe déjà. Précisez sa modification.');
            if (created.has(key)) throw Error('Deux créations portent le même intitulé.');
            created.add(key);
        } else if (c.action === 'removeRow') {
            if (removed.has(field.id) || shadow.has(field.id)) throw Error('Deux actions incompatibles visent la même ligne.');
            removed.add(field.id);
        } else if (PvVoiceOps.rich(field.type)) {
            writes.push(edit(field, before=>{
                const div = document.createElement('div'); div.innerHTML = before;
                if (c.action === 'append') append(div,c.value);
                else {
                    const {text,ranges} = richIndex(div);
                    const start = text.indexOf(c.target), end = start + c.target.length;
                    if (start < 0 || text.lastIndexOf(c.target)!==start) throw Error('Le passage indiqué est ambigu ou a changé.');
                    const first = ranges.find(r=>r.end>start), last = ranges.findLast(r=>r.start<end);
                    if (!first || !last || start<first.start || end>last.end) throw Error('Précisez le passage à modifier sans saut de ligne extérieur.');
                    const range = document.createRange(); range.setStart(first.node,start-first.start); range.setEnd(last.node,end-last.start);
                    fragment = range.cloneContents(); range.deleteContents();
                    if (c.action==='replace') range.insertNode(range.createContextualFragment(plainHTML(c.value)));
                    else {
                        // Retirer le séparateur devenu vide après la suppression d’une ligne entière.
                        div.normalize();
                        if ((start===0 || text[start-1]==='\n') && (end===text.length || text[end]==='\n')) {
                            const after = range.cloneRange(); after.collapse(true);
                            let p = after.startContainer;
                            if (p.nodeType===Node.TEXT_NODE) p = p.parentNode;
                            if (p!==div && ['DIV','P'].includes(p.nodeName) && !p.textContent.trim()) p.remove();
                            else {
                                const brs = [...div.querySelectorAll('br')];
                                const br = brs.find(b=>{const prefix=document.createRange();prefix.selectNodeContents(div);prefix.setEndBefore(b);
                                    const tmp=document.createElement('div');tmp.append(prefix.cloneContents());return richIndex(tmp).text.length===Math.max(0,start-1);});
                                if (br) br.remove();
                            }
                        }
                    }
                }
                return div.innerHTML;
            }));
            if (c.action === 'move') writes.push(edit(catalog.get(c.destination),before=>{
                const div = document.createElement('div'); div.innerHTML=before;
                append(div,c.target,fragment); return div.innerHTML;
            }));
        } else writes.push(edit(field,before=>c.action==='increment' ? String(Number(before)+Number(c.value)) : c.value));
        if (writes.length && writes.every(w=>w.before===w.after)) return [];
        return [{change:c,field,writes}];
    });
}
function assignAssistant(f,value) {
    if (PvVoiceOps.rich(f.type)) f.node.innerHTML=value;
    else if (f.id==='sizeDisplay') { logoScale=Number(value)/100; updateLogoPreview(); }
    else if (f.type==='boolean') f.node.checked=value==='true';
    else if ('value' in f.node) f.node.value=value;
    else f.node.textContent=value;
    f.node.dispatchEvent(new Event('input',{bubbles:true}));
}
function applyAssistant(plan,extended) {
    const undos=[];
    try {
        for (const {change:c,field:f,writes} of plan) {
            const live = assistantCatalog(extended).get(f.id);
            if (!live || live.node !== f.node) throw Error('La rubrique a changé. Relancez l’analyse.');
            if (PvVoiceOps.creation(f.type)) {
                let row;
                if (f.type==='new-section') {
                    row=createTableSection({title:c.rowLabel,contentHTML:plainHTML(c.value),voiceDaily:true});
                    f.node.append(row);
                } else row=(f.type==='new-person'?addPersonnelField:addStockField)(c.rowLabel,c.value);
                const signature=()=>f.type==='new-section' ? JSON.stringify([row.querySelector('h3').textContent,row.querySelector('.rich-editor').innerHTML,...[...row.querySelectorAll('input')].map(n=>n.checked)])
                    : JSON.stringify([...row.querySelectorAll('input')].map(n=>n.value));
                const saved=signature();
                undos.push(()=>{if (!row.isConnected || signature()!==saved || !assistantCatalog(extended).has(f.id)) return false; row.remove();return true;});
            } else if (c.action==='removeRow') {
                const row=f.node.closest('.personnel-item'), list=row.parentNode, next=row.nextElementSibling;
                row.remove();
                undos.push(()=>{
                    if (!list.isConnected || list.closest('.custom-section').querySelector('.voice-daily:not(:checked),.section-checkbox:not(:checked)') ||
                        [...list.querySelectorAll('.role-input')].some(n=>PvVoiceContract.canonical(n.value)===PvVoiceContract.canonical(f.label))) return false;
                    list.insertBefore(row,next?.parentNode===list?next:null);return true;
                });
            } else {
                if (writes.some(w=>assistantValue(w.f)!==w.before || assistantCatalog(extended).get(w.f.id)?.node!==w.f.node)) throw Error('Les valeurs du rapport ont changé. Relancez l’analyse.');
                writes.forEach(w=>assignAssistant(w.f,w.after));
                undos.push(()=>{
                    if (writes.some(w=>assistantCatalog(extended).get(w.f.id)?.node!==w.f.node || assistantValue(w.f)!==w.after)) return false;
                    writes.forEach(w=>assignAssistant(w.f,w.before)); return true;
                });
            }
        }
    } catch(e) { for (const undo of undos.reverse()) undo(); throw e; }
    markChanged(); return undos;
}
