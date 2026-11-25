// Seule l’origine publique figure dans le site statique.
const PVVC_WORKER_URL = 'https://pvvc-dictee.medbahnaji44.workers.dev';

(() => {
    const dialog=$('voiceDialog'), transcript=$('voiceText'), endpoint=PVVC_WORKER_URL.replace(/\/+$/,'');
    const status = message => { $('voiceStatus').textContent=message; };
    const example=['TEST — Coffrage du voile en cours.','Équipe test : 3 personnes présentes.','Livraison de Ciment test : quantité non précisée.'];
    let recorder, stream, timer, blob, url, pending=false, mime='', controller, epoch=0;
    let busy=false, fixture=false, day='', history=[], clarification=null, preview=[], previewRevision, lastBatch;
    let writes=Promise.resolve(), closing=false;
    const edits=new Map();
    const operations={append:'Ajouter',replace:'Remplacer',remove:'Supprimer le passage',move:'Déplacer',set:'Modifier',increment:'Augmenter l’effectif',create:'Créer',removeRow:'Supprimer la ligne'};
    function save(extra) {
        if (!day) return;
        const key=day, state={text:transcript.value,history:[...history],clarification,pending,mime};
        writes=writes.then(()=>voiceDrafts.save(key,state,extra)).catch(()=>{
            $('voiceStorage').textContent='Stockage local indisponible. Gardez cette fenêtre ouverte et téléchargez l’audio.';
        });
    }
    function playback(value) {
        if (url) URL.revokeObjectURL(url);
        blob=value; url=blob ? URL.createObjectURL(blob) : '';
        $('voicePlayback').pause();
        if (url) {
            $('voicePlayback').src=url; $('saveAudio').href=url;
            const ext=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':mime.includes('wav')?'wav':'webm';
            $('saveAudio').download='dictee-'+day+'.'+ext;
        } else { $('voicePlayback').removeAttribute('src'); $('saveAudio').removeAttribute('href'); }
        $('voicePlayback').hidden=$('saveAudio').hidden=!url;
    }
    function controls() {
        const recording=!!recorder;
        $('recordVoice').hidden=recording; $('stopVoice').hidden=!recording;
        dialog.classList.toggle('recording',recording);
        $('recLabel').textContent=recording?'Écoute en cours':'Microphone au repos';
        for(const id of ['analyzeVoice','loadFixture','correctVoice','retryAudio','alternateAudio','replaceAudio','voiceExtended']) $(id).disabled=busy || recording;
        $('recordVoice').disabled=busy || recording || (pending && !!blob);
        transcript.readOnly=busy || recording;
        $('analyzeVoice').disabled ||= !transcript.value.trim() || (!endpoint && !fixture);
        $('retryAudio').hidden=$('alternateAudio').hidden=!endpoint || !pending || !blob;
        $('replaceAudio').hidden=!pending || !blob;
        $('applyVoice').disabled=busy || recording || !$('voiceChanges').querySelector('input:checked');
    }
    function resetPreview() { preview=[]; edits.clear(); $('voiceChanges').replaceChildren(); controls(); }
    function releaseMic() { clearInterval(timer); stream?.getTracks().forEach(t=>t.stop()); stream=null; }
    const remember = item => { history=[...history,item.slice(0,2000)].slice(-6); };
    $('openVoice').onclick=async()=>{
        const session=++epoch, key=$('inspectionDate').value || 'rapport';
        busy=true; closing=false; dialog.showModal(); controls();
        $('voiceMode').textContent=endpoint?'L’audio, le texte des champs autorisés et les derniers échanges sont envoyés à Cloudflare. Vérifiez les propositions avant de les appliquer.':'Mode local · Réécoutez votre dictée ou essayez un exemple.';
        $('loadFixture').hidden=!!endpoint; $('voiceAccessLabel').hidden=!endpoint;
        $('voiceAccessLabel').closest('details').open=!!endpoint && !$('voiceAccess').value;
        status('Ouverture du brouillon…');
        try {
            if (day!==key) {
                await writes;
                const draft=await voiceDrafts.load(key);
                if (session!==epoch) return;
                day=key; transcript.value=draft.text || ''; history=draft.history || []; clarification=draft.clarification || null;
                pending=!!draft.pending; mime=draft.mime || draft.parts[0]?.type || '';
                playback(draft.parts.length ? new Blob(draft.parts,{type:mime}) : null);
            }
            status(pending && blob?'Enregistrement conservé. Vous pouvez le réécouter ou reprendre la transcription.':
                history.length?'Vous pouvez dicter la suite ou préciser la modification souhaitée.':'');
        } catch {
            if (day!==key) { transcript.value='';history=[];clarification=null;pending=false;playback(null); }
            day=key; $('voiceStorage').textContent='Brouillon disponible uniquement dans cette fenêtre.'; status('');
        } finally { if (session===epoch) { busy=false; controls(); } }
    };
    function close() {
        if (recorder) { closing=true; if (recorder.state!=='inactive') recorder.stop(); }
        else dialog.close();
    }
    $('closeVoice').onclick=close;
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('close',()=>{
        epoch++; controller?.abort(); busy=false; fixture=false; resetPreview();
    });
    window.addEventListener('pagehide',()=>{
        closing=true; controller?.abort();
        if (recorder?.state==='recording') { recorder.requestData(); recorder.stop(); }
        releaseMic();
    });
    async function post(path,body,contentType,retry=false) {
        if (!endpoint.startsWith('https://')) throw Error('Adresse HTTPS requise pour le Worker.');
        if (!$('voiceAccess').value) { $('voiceAccessLabel').closest('details').open=true; throw Error('Saisissez le code d’accès au Worker.'); }
        const session=epoch;
        for(let attempt=0;;attempt++) {
            const active=new AbortController(); controller=active;
            const timeout=setTimeout(()=>active.abort(),90000);
            try {
                const res=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':contentType,Authorization:'Bearer '+$('voiceAccess').value},
                    body,signal:active.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
                const data=await res.json().catch(()=>null);
                if (!res.ok || !data) throw Object.assign(Error((data?.error || 'Réponse illisible du service (HTTP '+res.status+').')+
                    (data?.reference?' Réf. '+data.reference:'')),{code:data?.code,temporary:data?.retryable ?? [502,503,504].includes(res.status)});
                return data;
            } catch(e) {
                if (session!==epoch) throw e;
                const network=e instanceof TypeError, timeoutError=e.name==='AbortError';
                const convert=path==='/transcribe' && ['audio_decode','provider_3043'].includes(e.code);
                if (!retry || attempt || !(e.temporary || network || timeoutError || convert)) {
                    if (network || timeoutError) throw Error(timeoutError?'Le délai de réponse est dépassé.':'Connexion impossible. Vérifiez le réseau et l’adresse autorisée du site.');
                    throw e;
                }
                status(convert?'Nouvelle tentative avec un encodage audio compatible…':'Connexion interrompue. Nouvelle tentative de transcription…');
                if (convert) {
                    body=await compatibleVoiceAudio(body).catch(()=>body);
                    contentType=body.type || contentType;
                }
                await new Promise(resolve=>setTimeout(resolve,1200));
                if (session!==epoch) throw e;
            } finally { clearTimeout(timeout); if (controller===active) controller=null; }
        }
    }
    function fixtureResult(fields) {
        // Exemples fixes, indépendants du micro. Une phrase retirée retire sa proposition.
        const changes = [];
        function add(type, evidence, rowLabel, value) {
            if (!transcript.value.includes(evidence)) return;
            let field = fields.find(f => f.type === type);
            if (!field) return;
            if (rowLabel) {
                const existing = fields.find(f => f.type === (type === 'new-person' ? 'count' : 'quantity')
                    && PvVoiceContract.canonical(f.label) === PvVoiceContract.canonical(rowLabel));
                if (existing) { if (!value) return; field = existing; rowLabel = ''; }
            }
            changes.push({fieldId:field.id, evidence, rowLabel, value});
        }
        add('note', example[0], '', example[0]);
        add('new-person', example[1], 'Équipe test', '3');
        add('new-stock', example[2], 'Ciment test', '');
        return {changes};
    }

    function legacy(result,fields,text) {
        PvVoiceContract.validateResult(result,fields.filter(f=>f.scope==='daily' && ['note','count','quantity','new-person','new-stock'].includes(f.type)),text);
        return {question:'',changes:result.changes.map(c=>{
            const type=fields.find(f=>f.id===c.fieldId).type;
            return {...c,action:PvVoiceOps.creation(type)?'create':type==='note'?'append':'set',target:'',destination:''};
        })};
    }
    function draw(plan) {
        preview=plan; previewRevision=revision; $('voiceChanges').replaceChildren();
        for(const {field,change:c,writes:items} of plan) {
            const card=document.createElement('article'),label=document.createElement('label'),check=document.createElement('input'),title=document.createElement('strong');
            check.type='checkbox';check.checked=true;check.onchange=controls;
            title.textContent=operations[c.action]+' · '+field.section+' · '+(c.rowLabel || field.label);
            label.append(check,title);card.append(label);
            for(const w of items.length?items:[{f:field,before:c.action==='create'?'':assistantValue(field),after:c.action==='removeRow'?'':c.value}]) {
                const p=document.createElement('p');
                p.textContent=(items.length>1?w.f.section+'\n':'')+'Avant · '+(assistantText(w.f,w.before)||'Vide')+'\nAprès · '+(assistantText(w.f,w.after)||'Vide');
                card.append(p);
            }
            if (!['remove','move','removeRow'].includes(c.action)) {
                const details=document.createElement('details'),summary=document.createElement('summary'),editor=document.createElement('textarea');
                summary.textContent='Modifier la proposition'; editor.value=c.value; editor.dir='auto';
                editor.setAttribute('aria-label','Valeur proposée pour '+(c.rowLabel || field.label)); editor.maxLength=12000;
                editor.oninput=()=>{edits.set(c,editor.value);const p=card.querySelector('p');
                    try { const [updated]=assistantPlan({question:'',changes:[c]},transcript.value.trim(),$('voiceExtended').checked,edits);
                        const w=updated?.writes[0]; p.textContent='Avant · '+(w?assistantText(w.f,w.before)||'Vide':'Vide')+'\nAprès · '+(w?assistantText(w.f,w.after):editor.value);
                    } catch(e) {p.textContent=e.message;}
                };
                details.append(summary,editor);card.append(details);
            }
            const proof=document.createElement('small');proof.textContent='Dictée · « '+c.evidence+' »';card.append(proof);
            $('voiceChanges').append(card);
        }
        status(plan.length?'Modifications proposées. Sélectionnez celles à appliquer.':'Aucune modification à appliquer. Vérifiez la dictée ou précisez la rubrique.');
        controls();
    }
    async function analyze() {
        const session=epoch,startRevision=revision,text=transcript.value.trim();
        resetPreview(); busy=true;controls();
        try {
            const fields=assistantFields(assistantCatalog($('voiceExtended').checked));
            if (!text) throw Error('Saisissez ou dictez une instruction.');
            PvVoiceOps.fieldsOK(fields);
            status('Analyse de la dictée et du rapport…');
            const context=clarification && text.startsWith(clarification.text) ? [...history.slice(-5),clarification.question] : history;
            let result=fixture?fixtureResult(fields):await post('/analyze',JSON.stringify({version:2,fields,history:context,transcript:text}),'application/json');
            if (epoch!==session) return;
            if (startRevision!==revision) throw Error('Le rapport a changé. Relancez l’analyse.');
            if (!('question' in result)) result=legacy(result,fields,text);
            if (result.question) {
                PvVoiceOps.validate({...result,changes:[]},fields,text);
                status('Précision demandée · '+result.question+' Ajoutez votre réponse à la dictée.');
                clarification={text,question:result.question};save();return;
            }
            status('Organisation des informations…');
            draw(assistantPlan(result,text,$('voiceExtended').checked));
        } catch(e) { if (epoch===session) status(e.message); }
        finally { if (epoch===session) {busy=false;controls();} }
    }
    async function transcribe(compatible=false) {
        const session=epoch;
        if (!blob || !pending) return;
        resetPreview(); busy=true;controls();status('Transcription de l’enregistrement…');
        try {
            const audio=compatible?await compatibleVoiceAudio(blob).catch(()=>blob):blob;
            if (session!==epoch) return;
            const data=await post('/transcribe'+(compatible?'?mode=compatible':''),audio,audio.type || 'application/octet-stream',true);
            if (session!==epoch) return;
            if (typeof data.text!=='string' || !data.text.trim()) throw Error('Aucune parole reconnue.');
            const combined=[transcript.value.trim(),data.text.trim()].filter(Boolean).join('\n');
            if (combined.length>12000) throw Error('La transcription dépasse 12 000 caractères. Raccourcissez le brouillon.');
            transcript.value=combined;pending=false;save();await analyze();
        } catch(e) { if (session===epoch) status(e.message+' Audio conservé. Vous pouvez aussi saisir le texte.'); }
        finally { if(session===epoch) {busy=false;controls();} }
    }
    async function startRecording() {
        if (busy || recorder || (blob && pending)) return;
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status('Microphone indisponible. Utilisez HTTPS ou saisissez le texte.');return; }
        const session=epoch;
        busy=true;controls();status('Autorisez l’accès au microphone.');
        try {
            const media=await navigator.mediaDevices.getUserMedia({audio:true});
            if(session!==epoch) { media.getTracks().forEach(t=>t.stop());return; }
            stream=media;
            const format=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported?.(t));
            const rec=new MediaRecorder(stream,format?{mimeType:format,audioBitsPerSecond:48000}:{audioBitsPerSecond:48000});
            const parts=[],started=Date.now();let size=0,failed=false;
            rec.ondataavailable=e=>{
                if (!e.data.size) return;
                size+=e.data.size;parts.push(e.data);mime=rec.mimeType || e.data.type;
                save({chunk:e.data,index:parts.length});
                if (size>=7.5*1024**2 && rec.state==='recording') rec.stop();
            };
            rec.onerror=()=>{failed=true;if (rec.state!=='inactive') rec.stop();};
            rec.onstop=()=>{
                recorder=null; releaseMic();pending=!!parts.length;
                playback(parts.length?new Blob(parts,{type:mime}):null);save();controls();
                if(closing) {if(dialog.open) dialog.close(); return;}
                if (!blob || failed || size>8*1024**2) {status('Capture interrompue. Les données audio disponibles peuvent être téléchargées.');return;}
                if(endpoint) transcribe(); else status('Enregistrement terminé. Vous pouvez le réécouter.');
            };
            rec.start(1000);recorder=rec;playback(null);pending=true;mime=rec.mimeType;save({reset:true});resetPreview();
            $('recTime').textContent='00:00';
            timer=setInterval(()=>{
                const seconds=Math.floor((Date.now()-started)/1000);
                $('recTime').textContent=[Math.floor(seconds/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
                if(seconds>=300 && rec.state==='recording') rec.stop();
            },250);
            status('Écoute en cours · cinq minutes maximum.');
        } catch { if(session===epoch) {releaseMic();status('Microphone indisponible. Vérifiez son autorisation ou saisissez le texte.');} }
        finally {if (session===epoch) {busy=false;controls();}}
    }
    $('loadFixture').onclick=()=>{fixture=true;transcript.value=example.join('\n');analyze();};
    $('recordVoice').onclick=startRecording;
    $('stopVoice').onclick=()=>{if(recorder?.state==='recording') recorder.stop();};
    $('retryAudio').onclick=()=>transcribe();
    $('alternateAudio').onclick=()=>transcribe(true);
    $('replaceAudio').onclick=()=>{
        if (!confirm('Écarter cet enregistrement du brouillon ? Vous pouvez d’abord le télécharger.')) return;
        pending=false;playback(null);save({reset:true});controls();
    };
    $('analyzeVoice').onclick=analyze;
    $('voiceExtended').onchange=()=>{resetPreview();status('Relancez l’analyse pour utiliser cette sélection de champs.');};
    transcript.oninput=()=>{resetPreview();save();status('Dictée prête à analyser.');};
    $('correctVoice').onclick=()=>{resetPreview();transcript.focus();transcript.setSelectionRange(transcript.value.length,transcript.value.length);status('Complétez le texte, puis relancez l’analyse.');};
    $('applyVoice').onclick=()=>{
        try {
            if (revision!==previewRevision) throw Error('Le rapport a changé. Relancez l’analyse.');
            const selected=[...$('voiceChanges').querySelectorAll('input:checked')].map(el=>preview[[...$('voiceChanges').children].indexOf(el.closest('article'))]);
            if (!selected.length) return;
            const extended=$('voiceExtended').checked;
            const plan=assistantPlan({question:'',changes:selected.map(p=>p.change)},transcript.value.trim(),extended,edits);
            if (plan.length!==selected.length || plan.some((p,i)=>p.field.node!==selected[i].field.node || p.writes.some((w,j)=>w.before!==selected[i].writes[j]?.before))) throw Error('La sélection change le résultat affiché. Précisez ces opérations séparément.');
            lastBatch=applyAssistant(plan,extended);
            remember('Instruction validée : '+transcript.value+'\nChamps appliqués : '+plan.map(p=>p.field.section+' / '+(p.change.rowLabel||p.field.label)+' ('+p.field.id+') '+p.change.value).join(' ; '));
            transcript.value='';clarification=null;save();$('undoVoice').hidden=false;
            $('voiceResult').textContent='Validation réussie · '+plan.length+' modification(s). Vous pouvez dicter la suite.';
            dialog.close();
        } catch(e) {status(e.message);}
    };
    $('undoVoice').onclick=()=>{
        if(!lastBatch) return;
        const total=lastBatch.length, n=lastBatch.reverse().filter(undo=>undo()).length;
        if(n) markChanged(); lastBatch=null;
        remember('Annulation du dernier lot : '+n+' modification(s). Les valeurs actuelles du rapport font foi.');save();
        $('voiceResult').textContent=n+' modification(s) annulée(s) sur '+total+'.';$('undoVoice').hidden=true;
    };
})();
