import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, MessageSquare, Paperclip, Send, Users, UserRound, X } from "lucide-react";
import { getTeamMessages, postTeamMessage, getConversations, getDmMessages, postDmMessage, attachmentUrl } from "../services/api";
import { getSocket } from "../services/socket";

// Renders NET-xxxx incident IDs inline as clickable links that open the same
// IncidentDetails view every other page in the app uses - the "incident-
// aware chat" differentiator's frontend half (the backend half is the two
// system auto-posts in chatService.js).
const INCIDENT_ID_PATTERN = /\b(NET-[A-Z0-9-]+)\b/g;
function linkifyIncidentIds(text, onOpenIncident) {
  const parts = String(text || "").split(INCIDENT_ID_PATTERN);
  return parts.map((part, i) => i % 2 === 1
    ? <button key={i} type="button" onClick={() => onOpenIncident({ incidentId: part })} className="font-mono font-semibold text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300">{part}</button>
    : <span key={i}>{part}</span>);
}

function Attachment({ attachment, messageId }) {
  if (!attachment) return null;
  if (attachment.kind === "image") return <img src={attachmentUrl(messageId)} alt={attachment.filename} className="mt-2 max-h-64 max-w-xs rounded-lg border border-slate-800" />;
  return <a href={attachmentUrl(messageId)} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-blue-400 hover:bg-slate-900"><Paperclip size={13} />{attachment.filename}</a>;
}

function MessageBubble({ message, mine, openIncident }) {
  if (message.systemGenerated) return <div className="flex justify-center"><span className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-[11px] text-slate-400">{linkifyIncidentIds(message.text, openIncident)}</span></div>;
  return <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm sm:max-w-md ${mine ? "bg-blue-600 text-white" : "bg-slate-800/80 text-slate-200"}`}>
      {!mine && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{message.senderName}</p>}
      {message.text && <p className="leading-snug">{linkifyIncidentIds(message.text, openIncident)}</p>}
      <Attachment attachment={message.attachment} messageId={message._id} />
      <p className={`mt-1 text-[10px] ${mine ? "text-blue-200/70" : "text-slate-500"}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
    </div>
  </div>;
}

export default function TeamChat({ user, technicians, openIncident }) {
  const [mode, setMode] = useState("team");
  const [activeDm, setActiveDm] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  // Below sm, the conversation list and the active thread can't fit
  // side-by-side (that's the two-fixed-width-panes layout that's fine on a
  // desktop-sized viewport but unusable on a phone) - this tracks which of
  // the two panes is showing, mobile-only; both always show together at
  // sm: and above regardless of this state.
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  const me = user.technicianId;
  const otherTechnicians = useMemo(() => technicians.filter(t => t.technicianId !== me), [technicians, me]);

  async function loadConversations() { const r = await getConversations(); if (r.success) setConversations(r.conversations); }

  async function loadThread() {
    setLoading(true);
    try {
      if (mode === "team") { const r = await getTeamMessages(); if (r.success) setMessages(r.messages); }
      else if (activeDm) { const r = await getDmMessages(activeDm); if (r.success) setMessages(r.messages); }
    } finally { setLoading(false); }
  }

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { loadThread(); }, [mode, activeDm]);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = message => {
      const belongsToCurrentThread = mode === "team" ? message.channel === "team" : message.channel === "dm" && (message.senderId === activeDm || message.recipientId === activeDm) && (message.senderId === me || message.recipientId === me);
      if (belongsToCurrentThread) setMessages(current => current.some(m => m._id === message._id) ? current : [...current, message]);
      if (message.channel === "dm" && (message.senderId === me || message.recipientId === me)) loadConversations();
    };
    socket.on("chat_message", onMessage);
    return () => socket.off("chat_message", onMessage);
  }, [mode, activeDm, me]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setSending(true);
    try {
      const r = mode === "team" ? await postTeamMessage({ text, attachment: file }) : await postDmMessage(activeDm, { text, attachment: file });
      if (!r.success) throw new Error(r.message || "Failed to send message.");
      setMessages(current => current.some(m => m._id === r.message._id) ? current : [...current, r.message]);
      setText(""); setFile(null); if (fileInputRef.current) fileInputRef.current.value = "";
      if (mode === "dm") loadConversations();
    } catch (err) { alert(err.response?.data?.message || err.message); }
    finally { setSending(false); }
  }

  function openDm(technicianId) { setMode("dm"); setActiveDm(technicianId); setPicker(false); setMobileShowThread(true); }
  function openTeam() { setMode("team"); setMobileShowThread(true); }

  const activeName = mode === "dm" ? (conversations.find(c => c.technicianId === activeDm)?.name || otherTechnicians.find(t => t.technicianId === activeDm)?.name || activeDm) : null;

  // Below lg, App.jsx's fixed bottom mobile nav bar (~3.25rem tall) overlays
  // the viewport's bottom edge - this height calc has to reserve room for it
  // too, or the composer/last messages end up underneath it. That bar is
  // lg:hidden, so the extra reservation drops away at lg: and up.
  return <div className="flex h-[calc(100vh-12.25rem)] flex-col gap-4 lg:h-[calc(100vh-9rem)] lg:flex-row">
    <aside className={`${mobileShowThread ? "hidden" : "flex"} w-full shrink-0 flex-col rounded-2xl border border-slate-800/80 bg-slate-900/60 lg:flex lg:w-64`}>
      <button onClick={openTeam} className={`flex items-center gap-2 rounded-t-2xl px-4 py-3 text-sm font-semibold ${mode === "team" ? "bg-blue-500/10 text-blue-400" : "text-slate-400 hover:bg-slate-800/40"}`}><Users size={15} /> Team channel</button>
      <div className="flex items-center justify-between px-4 pt-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Direct messages</p><button onClick={() => setPicker(p => !p)} className="text-[10px] font-semibold text-blue-400 hover:text-blue-300">+ New</button></div>
      {picker && <div className="mx-3 mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-1">{otherTechnicians.map(t => <button key={t.technicianId} onClick={() => openDm(t.technicianId)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800"><UserRound size={12} />{t.name}</button>)}{!otherTechnicians.length && <p className="px-2 py-1.5 text-xs text-slate-600">No other technicians yet.</p>}</div>}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {conversations.map(c => <button key={c.technicianId} onClick={() => openDm(c.technicianId)} className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left ${mode === "dm" && activeDm === c.technicianId ? "bg-blue-500/10" : "hover:bg-slate-800/40"}`}>
          <span className={`text-sm font-medium ${mode === "dm" && activeDm === c.technicianId ? "text-blue-400" : "text-slate-200"}`}>{c.name}</span>
          <span className="mt-0.5 w-full truncate text-[11px] text-slate-500">{c.lastMessage}</span>
        </button>)}
        {!conversations.length && !picker && <p className="px-3 py-2 text-xs text-slate-600">No conversations yet - click "+ New" to message a teammate.</p>}
      </div>
    </aside>

    <section className={`${mobileShowThread ? "flex" : "hidden"} flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 lg:flex`}>
      <div className="flex items-center gap-2 border-b border-slate-800/80 px-3 py-4 sm:px-5"><button type="button" onClick={() => setMobileShowThread(false)} className="rounded-lg p-1.5 text-slate-400 hover:text-white lg:hidden"><ChevronLeft size={18} /></button><MessageSquare size={16} className="text-blue-400" /><h2 className="font-semibold text-white">{mode === "team" ? "Team channel" : activeName || "Select a conversation"}</h2></div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {loading ? <p className="text-center text-sm text-slate-600">Loading…</p> : mode === "dm" && !activeDm ? <p className="text-center text-sm text-slate-600">Pick a teammate to start messaging.</p> : messages.length ? messages.map(m => <MessageBubble key={m._id} message={m} mine={m.senderId === me} openIncident={openIncident} />) : <p className="text-center text-sm text-slate-600">No messages yet - say hello.</p>}
      </div>
      {(mode === "team" || activeDm) && <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-800/80 p-3">
        <button type="button" onClick={() => fileInputRef.current?.click()} className={`rounded-lg border p-2.5 ${file ? "border-blue-500/40 text-blue-400" : "border-slate-700 text-slate-400 hover:text-white"}`} title="Attach a file"><Paperclip size={16} /></button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
        <input value={text} onChange={e => setText(e.target.value)} placeholder={file ? `${file.name} attached - add a message (optional)` : "Message your team..."} className="form-input flex-1" />
        <button disabled={sending || (!text.trim() && !file)} className="rounded-lg bg-blue-600 p-2.5 text-white disabled:opacity-40"><Send size={16} /></button>
      </form>}
      {file && <div className="flex items-center gap-2 border-t border-slate-800/60 px-5 py-2 text-xs text-slate-500"><Paperclip size={12} />{file.name}<button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}><X size={12} /></button></div>}
    </section>
  </div>;
}
