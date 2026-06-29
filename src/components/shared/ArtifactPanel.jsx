import { useState, useRef } from 'react';
import { FG } from './Overlay.jsx';
import { supabase } from '../../supabase.js';

/* ══════════════════════════════════════════════
   ARTIFACT PANEL (per holding)
   Extracted from App.jsx lines 871–964
══════════════════════════════════════════════ */

// api helper — fetches its own session token from Supabase
async function api(path, opts={}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const isForm = opts.body instanceof FormData;
  const headers = { Authorization:`Bearer ${token}`, ...(isForm?{}:{"Content-Type":"application/json"}), ...(opts.headers||{}) };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.error||res.statusText); }
  return res.json();
}

const fmtSize = b => b>1e6?`${(b/1e6).toFixed(1)}MB`:b>1e3?`${(b/1e3).toFixed(0)}KB`:`${b}B`;
const ago = d => { if(!d)return"Never"; const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return`${s}s ago`; if(s<3600)return`${Math.floor(s/60)}m ago`; if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`; };

export default function ArtifactPanel({ holding, token, onClose }) {
  const [artifacts, setArtifacts] = useState(holding.artifacts || []);
  const [uploading, setUploading] = useState(false);
  const [desc, setDesc]   = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("holdingId", holding.id);
    fd.append("description", desc);
    try {
      const result = await api("/api/artifacts/upload", { method:"POST", body:fd });
      setArtifacts(p => [{
        id: result.id, file_name: result.file_name, description: desc,
        file_size: file.size, file_type: file.type,
        uploaded_at: new Date().toISOString()
      }, ...p]);
      setDesc("");
    } catch(e) { alert("Upload failed: " + e.message); }
    setUploading(false);
  }

  async function download(art) {
    try {
      const { url } = await api(`/api/artifacts/download/${art.id}`, {});
      window.open(url, "_blank");
    } catch(e) { alert("Download failed: " + e.message); }
  }

  async function remove(id) {
    if (!confirm("Delete this file?")) return;
    await api(`/api/artifacts/${id}`, { method:"DELETE" });
    setArtifacts(p => p.filter(a => a.id !== id));
  }

  const fileIcon = t => t?.includes("pdf")?"📄":t?.includes("image")?"🖼️":t?.includes("excel")||t?.includes("sheet")?"📊":"📎";

  return (
    <div className="ovl" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="mod" style={{maxWidth:560}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.2rem"}}>
          <div>
            <div className="modtitle" style={{marginBottom:".15rem"}}>📎 Documents</div>
            <div style={{fontSize:".73rem",color:"var(--text-muted)"}}>{holding.name}</div>
          </div>
          <button className="delbtn" style={{fontSize:"1rem"}} onClick={onClose}>✕</button>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);upload(e.dataTransfer.files[0]);}}
          onClick={()=>fileRef.current?.click()}
          style={{border:dragOver?"2px dashed rgba(201,168,76,.6)":"2px dashed var(--border-mid)",borderRadius:10,padding:"1.4rem",textAlign:"center",cursor:"pointer",transition:"all .2s",background:dragOver?"rgba(201,168,76,.05)":"transparent",marginBottom:"1rem"}}
        >
          <div style={{fontSize:"1.6rem",marginBottom:".4rem"}}>☁</div>
          <div style={{fontSize:".8rem",color:"var(--text-dim)"}}>Drag & drop or click to upload</div>
          <div style={{fontSize:".68rem",color:"var(--text-muted)",marginTop:".25rem"}}>PDF, images, Excel, Word — up to 15 MB</div>
          <input ref={fileRef} type="file" style={{display:"none"}} onChange={e=>upload(e.target.files[0])}/>
        </div>
        <div className="frow" style={{marginBottom:"1rem"}}>
          <FG label="Description (optional)"><input className="fi" placeholder="e.g. Q3 contract note, FD receipt" value={desc} onChange={e=>setDesc(e.target.value)}/></FG>
        </div>
        {uploading&&<div style={{textAlign:"center",padding:".8rem",fontSize:".78rem",color:"#c9a84c"}}>Uploading…</div>}

        {/* File list */}
        {artifacts.length===0
          ? <div className="empty" style={{padding:"1.5rem"}}>No documents attached yet</div>
          : <div style={{display:"flex",flexDirection:"column",gap:".5rem",maxHeight:280,overflowY:"auto"}}>
              {artifacts.map(a=>(
                <div key={a.id} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".75rem .9rem",background:"var(--bg-muted)",border:"1px solid var(--border)",borderRadius:8}}>
                  <div style={{fontSize:"1.2rem",flexShrink:0}}>{fileIcon(a.file_type)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:".82rem",color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.file_name}</div>
                    <div style={{fontSize:".67rem",color:"var(--text-muted)",marginTop:2}}>{a.description?`${a.description} · `:""}{fmtSize(a.file_size||0)} · {ago(a.uploaded_at)}</div>
                  </div>
                  <button className="btn-o" style={{padding:".26rem .6rem",fontSize:".65rem"}} onClick={()=>download(a)}>↓ View</button>
                  <button className="delbtn" onClick={()=>remove(a.id)}>✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}