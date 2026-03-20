"use client";

import { Search, ArrowRightLeft, FolderGit2 } from "lucide-react";
import { LocalCodexPanel } from "@/components/settings/local-codex-panel";

export default function CodexPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="glass-card overflow-hidden border-none p-6 shadow-md">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Search className="h-3.5 w-3.5" />
              本地 Codex 工作台
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">切换本机 Codex 的 OAuth 登录态</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                这里不负责系统级设置，只处理本地 Codex 的扫描、工作空间切换和信任项目展示。把它拆成独立页面后，语义会比塞在“系统设置”里更清晰。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-3 lg:w-[420px]">
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Search className="h-3.5 w-3.5 text-primary" />
                扫描本地登录态
              </div>
              <p>读取 `~/.codex/auth.json` 和 `config.toml`，识别当前工作空间。</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                切换不同登录态
              </div>
              <p>把已保存账号的一套 token 写回本机 Codex，切换当前使用的 business。</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                展示项目范围
              </div>
              <p>只读展示当前本地 Codex 已信任的项目路径，方便核对环境。</p>
            </div>
          </div>
        </div>
      </section>

      <LocalCodexPanel />
    </div>
  );
}
