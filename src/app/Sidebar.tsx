import { NavLink } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { visibleNav } from "@/app/nav";
import { ROLE_LABELS } from "@/types/database";
import { cn } from "@/lib/cn";

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const items = visibleNav(profile?.role);

  return (
    <aside className="flex h-full w-60 flex-col border-r border-zinc-200 bg-white">
      <div className="flex h-14 items-center gap-2.5 border-b border-zinc-100 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-xs font-semibold text-white">
          S
        </div>
        <div className="text-sm font-semibold tracking-tight text-zinc-900">SOAR Hub</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition",
                    isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  )
                }
              >
                <item.icon className="h-4 w-4" strokeWidth={1.75} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-zinc-100 p-3">
        {profile && (
          <div className="mb-2 px-2.5 py-1.5">
            <div className="truncate text-sm font-medium text-zinc-900">
              {profile.full_name ?? profile.email}
            </div>
            <div className="text-xs text-zinc-500">{ROLE_LABELS[profile.role]}</div>
          </div>
        )}
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
