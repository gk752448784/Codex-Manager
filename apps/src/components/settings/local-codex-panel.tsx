"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HardDriveDownload,
  RefreshCw,
  FolderGit2,
  ArrowRightLeft,
  Check,
  ShieldCheck,
  KeyRound,
  ScanSearch,
} from "lucide-react";
import { toast } from "sonner";
import { appClient } from "@/lib/api/app-client";
import { accountClient } from "@/lib/api/account-client";
import { getAppErrorMessage, isTauriRuntime } from "@/lib/api/transport";
import { LocalCodexWorkspaceAccount } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function displayWorkspace(account: LocalCodexWorkspaceAccount): string {
  return (
    account.workspaceId ||
    account.chatgptAccountId ||
    account.accountId
  );
}

function displayWorkspaceTitle(account: LocalCodexWorkspaceAccount): string {
  const groupName = String(account.groupName || "").trim();
  if (groupName && groupName.toUpperCase() !== "IMPORT") {
    return groupName;
  }
  return account.label || displayWorkspace(account);
}

function statusLabel(status: string): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "active") return "可用";
  if (normalized === "disabled") return "已禁用";
  return status || "未知";
}

function shortIdentity(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "--";
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 12)}...${normalized.slice(-8)}`;
}

export function LocalCodexPanel() {
  const queryClient = useQueryClient();
  const isDesktop = isTauriRuntime();
  const { data, isLoading } = useQuery({
    queryKey: ["local-codex-status"],
    queryFn: () => appClient.getLocalCodexStatus(),
    enabled: isDesktop,
  });

  const importCurrentAuth = useMutation({
    mutationFn: async () => {
      const result = await appClient.importCurrentLocalCodexAuth();
      let refreshError: string | null = null;
      if (result.authFileExists && result.total > 0) {
        try {
          await accountClient.refreshUsage();
        } catch (error) {
          refreshError = getAppErrorMessage(error);
        }
      }
      return { result, refreshError };
    },
    onSuccess: ({ result, refreshError }) => {
      if (!result.authFileExists) {
        toast.error("未找到 ~/.codex/auth.json");
        return;
      }
      if (refreshError) {
        toast.warning(
          `扫描完成：共 ${result.total}，新增 ${result.created}，更新 ${result.updated}，失败 ${result.failed}。额度刷新失败：${refreshError}`
        );
      } else {
        toast.success(
          `扫描完成：共 ${result.total}，新增 ${result.created}，更新 ${result.updated}，失败 ${result.failed}`
        );
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["local-codex-status"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["usage"] }),
        queryClient.invalidateQueries({ queryKey: ["usage-aggregate"] }),
        queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["gateway", "manual-account"] }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(`扫描失败: ${getAppErrorMessage(error)}`);
    },
  });

  const switchWorkspace = useMutation({
    mutationFn: (accountId: string) => appClient.switchLocalCodexWorkspace(accountId),
    onSuccess: (nextStatus) => {
      queryClient.setQueryData(["local-codex-status"], nextStatus);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["usage"] }),
        queryClient.invalidateQueries({ queryKey: ["usage-aggregate"] }),
        queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["gateway", "manual-account"] }),
      ]);
      toast.success("本地 Codex 工作空间已切换");
    },
    onError: (error: unknown) => {
      toast.error(`切换失败: ${getAppErrorMessage(error)}`);
    },
  });

  const currentWorkspaceAccount = useMemo(
    () => data?.workspaceAccounts?.find((item) => item.isCurrent) || null,
    [data?.workspaceAccounts]
  );
  const alternativeWorkspaceAccounts = useMemo(
    () => (data?.workspaceAccounts || []).filter((item) => !item.isCurrent),
    [data?.workspaceAccounts]
  );

  if (!isDesktop) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Card className="glass-card overflow-hidden border-none shadow-md">
        <CardHeader className="border-b border-border/40 pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <HardDriveDownload className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">当前本地 Codex 登录态</CardTitle>
              </div>
              <CardDescription>优先展示本机当前正在使用的 OAuth 登录态，切换后这里会直接变化。</CardDescription>
            </div>
            <Button
              className="gap-2 self-start"
              disabled={importCurrentAuth.isPending}
              onClick={() => importCurrentAuth.mutate()}
            >
              <RefreshCw className={cn("h-4 w-4", importCurrentAuth.isPending && "animate-spin")} />
              扫描并导入当前 Codex
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">读取本地 Codex 状态中...</div>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                <div className="rounded-[28px] border border-primary/20 bg-[linear-gradient(145deg,rgba(37,99,235,0.14),rgba(255,255,255,0.82))] p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={data?.authFileExists ? "default" : "secondary"}>
                          {data?.currentAuthMode || "未登录"}
                        </Badge>
                        {currentWorkspaceAccount ? (
                          <Badge className="gap-1">
                            <Check className="h-3 w-3" />
                            当前本地 Codex
                          </Badge>
                        ) : null}
                      </div>
                      <div>
                        <div className="text-xl font-semibold tracking-tight">
                          {currentWorkspaceAccount
                            ? displayWorkspaceTitle(currentWorkspaceAccount)
                            : data?.authFileExists
                              ? "已读取 auth.json，但尚未匹配到账号"
                              : "未发现本地 Codex 登录态"}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {data?.currentWorkspaceId ||
                            data?.currentChatgptAccountId ||
                            data?.currentAccountHint ||
                            "当前未解析出 workspace / account 信息"}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/40 bg-white/60 px-4 py-3 text-right shadow-sm">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        已匹配账号
                      </div>
                      <div className="mt-1 font-mono text-xs text-foreground">
                        {shortIdentity(data?.matchedAccountId)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-border/50 bg-background/55 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                        Workspace
                      </div>
                      <div className="break-all text-sm font-medium">
                        {data?.currentWorkspaceId || "--"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-background/55 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <KeyRound className="h-3.5 w-3.5 text-primary" />
                        ChatGPT Account
                      </div>
                      <div className="break-all text-sm font-medium">
                        {data?.currentChatgptAccountId || "--"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-background/55 p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <ScanSearch className="h-3.5 w-3.5 text-primary" />
                        本地目录
                      </div>
                      <div className="break-all text-sm font-medium">
                        {data?.codexDir || "~/.codex"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                    <div className="text-xs font-medium text-muted-foreground">Auth 文件</div>
                    <div className="mt-2">
                      <Badge variant={data?.authFileExists ? "default" : "secondary"}>
                        {data?.authFileExists ? "auth.json 已发现" : "auth.json 缺失"}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                    <div className="text-xs font-medium text-muted-foreground">Config 文件</div>
                    <div className="mt-2">
                      <Badge variant={data?.configFileExists ? "default" : "secondary"}>
                        {data?.configFileExists ? "config.toml 已发现" : "config.toml 缺失"}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                    <div className="text-xs font-medium text-muted-foreground">切换候选</div>
                    <div className="mt-2 text-sm font-semibold">
                      {data?.workspaceAccounts?.length || 0} 个登录态
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {alternativeWorkspaceAccounts.length
                        ? `可切换 ${alternativeWorkspaceAccounts.length} 个候选`
                        : "当前没有其他候选"}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card border-none shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">工作空间切换</CardTitle>
          </div>
          <CardDescription>这里保留每一套独立 token / 登录态。即使 workspace 相同，只要 token 不同，也都可以单独切换。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data?.workspaceAccounts?.length ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
              还没有可切换的本地 Codex 工作空间。先点击上面的“扫描并导入当前 Codex”，或先导入账号文件。
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.workspaceAccounts.map((account) => {
              const workspace = displayWorkspace(account);
              const title = displayWorkspaceTitle(account);
              return (
                <div
                  key={account.accountId}
                  className={cn(
                    "flex h-full flex-col gap-4 rounded-[24px] border p-5",
                    account.isCurrent
                      ? "border-primary/60 bg-primary/10 shadow-sm"
                      : "border-border/60 bg-background/45"
                  )}
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{title}</span>
                      {account.isCurrent ? (
                        <Badge className="gap-1">
                          <Check className="h-3 w-3" />
                          当前本地 Codex
                        </Badge>
                      ) : null}
                      <Badge variant="secondary">{statusLabel(account.status)}</Badge>
                    </div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Scope
                    </div>
                    <div className="break-all rounded-xl bg-background/55 px-3 py-2 text-xs text-muted-foreground">
                      {workspace}
                    </div>
                    {account.label && account.label !== title ? (
                      <div className="text-xs text-muted-foreground">账号：{account.label}</div>
                    ) : null}
                    {account.groupName && account.groupName !== title ? (
                      <div className="text-xs text-muted-foreground">业务：{account.groupName}</div>
                    ) : null}
                  </div>
                  <Button
                    variant={account.isCurrent ? "secondary" : "outline"}
                    disabled={account.isCurrent || switchWorkspace.isPending}
                    onClick={() => switchWorkspace.mutate(account.accountId)}
                    className="mt-auto"
                  >
                    切换到这个工作空间
                  </Button>
                </div>
              );
            })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card border-none shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">已信任项目</CardTitle>
          </div>
          <CardDescription>这是附属信息区块，只读展示 ~/.codex/config.toml 中登记的项目目录，方便核对本机环境。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data?.projects?.length ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
              当前未读取到已信任项目。
            </div>
          ) : (
            data.projects.map((project) => (
              <div
                key={project.path}
                className={cn(
                  "rounded-2xl border p-4",
                  project.isCurrent
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 bg-background/45"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium break-all">{project.path}</span>
                  {project.isCurrent ? <Badge>当前最近会话目录</Badge> : null}
                  {project.trustLevel ? <Badge variant="secondary">{project.trustLevel}</Badge> : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
