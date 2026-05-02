import { Outlet } from "react-router-dom";
import { Sidebar } from "@/app/Sidebar";

export function AppShell() {
  return (
    <div className="flex h-full bg-zinc-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
