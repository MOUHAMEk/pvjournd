// Un brouillon par journée du rapport. Les morceaux MediaRecorder sont écrits
// séparément pour ne pas recopier tout l’enregistrement à chaque seconde.
const voiceDrafts = (() => {
    let database;
    function open() {
        if (!database) database = new Promise((resolve,reject)=>{
            const req=indexedDB.open('pvvc-dictee',1);
            req.onupgradeneeded=()=>{
                req.result.createObjectStore('draft');
                req.result.createObjectStore('audio');
            };
            req.onsuccess=()=>resolve(req.result);
            req.onerror=()=>reject(req.error);
        });
        return database;
    }
    const pieces = day => IDBKeyRange.bound([day,0],[day,Number.MAX_SAFE_INTEGER]);
    async function transaction(mode,work) {
        const db=await open();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction(['draft','audio'],mode);
            const read=work(tx.objectStore('draft'),tx.objectStore('audio'));
            tx.oncomplete=()=>resolve(read?.());
            tx.onabort=tx.onerror=()=>reject(tx.error);
        });
    }
    return {
        load:day=>transaction('readonly',(draft,audio)=>{
            const d=draft.get(day),a=audio.getAll(pieces(day));
            return ()=>({...d.result,parts:a.result});
        }),
        save:(day,state,{reset=false,chunk,index}={})=>transaction('readwrite',(draft,audio)=>{
            draft.put(state,day);
            if (reset) audio.delete(pieces(day));
            if (chunk) audio.put(chunk,[day,index]);
        })
    };
})();
async function compatibleVoiceAudio(blob) {
    // Décoder avec le navigateur qui a enregistré le son, puis transmettre du PCM mono.
    const Context=window.AudioContext || window.webkitAudioContext;
    if (!Context) return blob;
    const ctx=new Context();
    try {
        const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
        const sampleRate=12000, frames=Math.ceil(decoded.duration*sampleRate);
        if (!frames || frames*2+44>8*1024**2) throw Error('Enregistrement trop long pour la conversion.');
        const offline=new OfflineAudioContext(1,frames,sampleRate);
        const source=offline.createBufferSource(); source.buffer=decoded; source.connect(offline.destination); source.start();
        const samples=(await offline.startRendering()).getChannelData(0);
        const data=new ArrayBuffer(44+frames*2), view=new DataView(data);
        function ascii(offset,s) { for(let i=0;i<s.length;i++) view.setUint8(offset+i,s.charCodeAt(i)); }
        ascii(0,'RIFF');view.setUint32(4,data.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');
        view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
        view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);
        view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,frames*2,true);
        for(let i=0;i<frames;i++) view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*(samples[i]<0?32768:32767),true);
        return new Blob([data],{type:'audio/wav'});
    } finally { await ctx.close(); }
}
