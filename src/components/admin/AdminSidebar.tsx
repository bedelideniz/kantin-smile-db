import {
  LayoutDashboard, School, Users, Megaphone, Image as ImageIcon, HandCoins,
  CreditCard, MessageSquare, BellRing, Wallet, ScrollText, UserCog, Server, Sparkles,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { MODULE_LABELS, type AppModule } from "@/lib/adminApi";

const ICONS: Record<AppModule, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  schools: School,
  students: Users,
  marketers: Megaphone,
  splashes: ImageIcon,
  stories: Sparkles,
  announcements: Megaphone,
  donations: HandCoins,
  payments: CreditCard,
  sms: MessageSquare,
  alarms: BellRing,
  payouts: Wallet,
  logs: ScrollText,
  staff: UserCog,
  infrastructure: Server,
};

interface Props {
  modules: AppModule[];
  active: AppModule;
  onSelect: (m: AppModule) => void;
  openAlarms: number;
}

export default function AdminSidebar({ modules, active, onSelect, openAlarms }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-3">
        <div className="text-sm font-semibold tracking-tight">
          {collapsed ? "KP" : "KantinPay"}
        </div>
        {!collapsed && <div className="text-[11px] text-muted-foreground">SüperAdmin</div>}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Modüller</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {modules.map((m) => {
                const Icon = ICONS[m];
                const isActive = active === m;
                return (
                  <SidebarMenuItem key={m}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => onSelect(m)}
                      tooltip={MODULE_LABELS[m]}
                      className="hover:bg-muted/50"
                    >
                      <Icon className="h-4 w-4" />
                      {!collapsed && <span className="flex-1 truncate">{MODULE_LABELS[m]}</span>}
                      {m === "alarms" && openAlarms > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                          {openAlarms}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
