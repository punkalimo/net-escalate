import { AlertTriangle, LogOut } from "lucide-react";
import { exitRealm } from "../services/platformApi";

export default function EnterRealmBanner({ realmName }) {
  async function doExit() {
    try { await exitRealm(); } finally { window.location.href = "/platform/realms"; }
  }
  return <div className="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-500/95 px-4 py-2 text-sm font-semibold text-black shadow-lg">
    <AlertTriangle size={16} />
    <span>PLATFORM ADMIN MODE &middot; Viewing: {realmName}</span>
    <button onClick={doExit} className="ml-2 flex items-center gap-1.5 rounded-lg bg-black/20 px-3 py-1 text-xs font-bold hover:bg-black/30"><LogOut size={12} />Exit realm</button>
  </div>;
}
