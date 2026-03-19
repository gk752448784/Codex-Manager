"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle
} from "@/components/ui/dialog";
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { accountClient } from "@/lib/api/account-client";
import { appClient } from "@/lib/api/app-client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauriRuntime } from "@/lib/api/transport";
import { FileUp, Info, LogIn, Clipboard, ExternalLink, Hash } from "lucide-react";

interface AddAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_LABELS: Record<string, string> = {
  TEAM: "团队 (TEAM)",
  PERSONAL: "个人 (PERSONAL)",
};

function normalizeWorkspaceId(value: string): string {
  return String(value || "").trim();
}

function isLikelyPlaceholderWorkspaceId(value: string): boolean {
  const normalized = normalizeWorkspaceId(value);
  if (!normalized) return false;
  if (!normalized.startsWith("org-")) return true;
  const suffix = normalized.slice(4);
  if (suffix.length < 6) return true;
  if (/^\d+$/.test(suffix)) return true;
  return false;
}

function workspaceIdValidationMessage(value: string): string | null {
  const normalized = normalizeWorkspaceId(value);
  if (!normalized) return null;
  if (!normalized.startsWith("org-")) {
    return "Business / 工作空间 ID 需要使用真实的 org-... 标识。";
  }
  if (normalized.length <= 8 || /^\d+$/.test(normalized.slice(4))) {
    return "请输入真实的 Business / 工作空间 ID，不要使用 org-1 这类占位值。";
  }
  return null;
}

function workspaceOptionTitle(input: {
  workspaceId?: string | null;
  label?: string | null;
  groupName?: string | null;
}): string {
  const groupName = String(input.groupName || "").trim();
  if (groupName && groupName.toUpperCase() !== "IMPORT") {
    return groupName;
  }
  const label = String(input.label || "").trim();
  if (label) return label;
  return normalizeWorkspaceId(input.workspaceId || "");
}

function pickImportTokenField(record: unknown, keys: string[]): string {
  const source = record && typeof record === "object" && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : null;
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeSingleImportRecord(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }
  const source = record as Record<string, unknown>;
  const tokens = source.tokens;
  if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
    return record;
  }

  const accessToken = pickImportTokenField(record, ["access_token", "accessToken"]);
  const idToken = pickImportTokenField(record, ["id_token", "idToken"]);
  const refreshToken = pickImportTokenField(record, ["refresh_token", "refreshToken"]);
  if (!accessToken || !idToken || !refreshToken) {
    return record;
  }

  const accountIdHint = pickImportTokenField(record, [
    "account_id",
    "accountId",
    "chatgpt_account_id",
    "chatgptAccountId",
  ]);
  const normalizedTokens: Record<string, string> = {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
  };
  if (accountIdHint) {
    normalizedTokens.account_id = accountIdHint;
  }

  return {
    ...source,
    tokens: normalizedTokens,
  };
}

function normalizeImportContentForCompatibility(rawContent: string): string {
  const text = String(rawContent || "").trim();
  if (!text) return text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed.map(normalizeSingleImportRecord));
    }
    if (parsed && typeof parsed === "object") {
      return JSON.stringify(normalizeSingleImportRecord(parsed));
    }
    return text;
  } catch {
    return text;
  }
}

function buildBulkImportContents(rawContent: string): string[] {
  const text = String(rawContent || "").trim();
  if (!text) return [];

  if (text.startsWith("{") || text.startsWith("[")) {
    return [normalizeImportContentForCompatibility(text)];
  }

  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeImportContentForCompatibility(item));
}

function getBulkImportErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("invalid JSON object stream")) {
    return "导入内容格式不正确。JSON 账号内容请整段粘贴；普通 Token 才按每行一个导入。";
  }
  if (message.includes("invalid JSON array")) {
    return "JSON 数组格式不正确，请检查括号和逗号后重试。";
  }
  return message;
}

export function AddAccountModal({ open, onOpenChange }: AddAccountModalProps) {
  const isDesktop = isTauriRuntime();
  const [activeTab, setActiveTab] = useState("login");
  const [isLoading, setIsLoading] = useState(false);
  const [isPollingLogin, setIsPollingLogin] = useState(false);
  const [loginHint, setLoginHint] = useState("");
  const queryClient = useQueryClient();
  const loginPollTokenRef = useRef(0);

  // Login Form
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [group, setGroup] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [manualCallback, setManualCallback] = useState("");

  // Bulk Import
  const [bulkContent, setBulkContent] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["accounts", "list", "login-modal-workspaces"],
    queryFn: () => accountClient.list(),
    enabled: open,
    retry: 1,
  });

  const localCodexStatusQuery = useQuery({
    queryKey: ["local-codex-status", "login-modal-workspaces"],
    queryFn: () => appClient.getLocalCodexStatus(),
    enabled: open && isDesktop,
    retry: 1,
  });

  const knownWorkspaceOptions = useMemo(() => {
    const options = new Map<string, { workspaceId: string; title: string; subtitle: string }>();
    for (const account of accountsQuery.data?.items || []) {
      const workspace = normalizeWorkspaceId(account.workspaceId || "");
      const title = workspaceOptionTitle({
        workspaceId: workspace,
        label: account.label,
        groupName: account.groupName,
      });
      if (workspace) {
        options.set(workspace, {
          workspaceId: workspace,
          title,
          subtitle: account.label || account.name || "",
        });
      }
    }
    for (const account of localCodexStatusQuery.data?.workspaceAccounts || []) {
      const workspace = normalizeWorkspaceId(account.workspaceId || "");
      if (!workspace) continue;
      if (options.has(workspace)) continue;
      options.set(workspace, {
        workspaceId: workspace,
        title: workspaceOptionTitle(account),
        subtitle: account.label || "",
      });
    }
    return Array.from(options.values()).sort((left, right) =>
      left.title.localeCompare(right.title, "zh-Hans-CN")
    );
  }, [accountsQuery.data?.items, localCodexStatusQuery.data?.workspaceAccounts]);

  const resetModalState = useCallback(() => {
    loginPollTokenRef.current += 1;
    setActiveTab("login");
    setIsLoading(false);
    setIsPollingLogin(false);
    setLoginHint("");
    setTags("");
    setNote("");
    setGroup("");
    setWorkspaceId("");
    setLoginUrl("");
    setManualCallback("");
    setBulkContent("");
  }, []);

  const invalidateLoginQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["usage"] }),
      queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
    ]);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetModalState();
    }
    onOpenChange(nextOpen);
  };

  const completeLoginSuccess = async (message: string) => {
    await invalidateLoginQueries();
    toast.success(message);
    resetModalState();
    onOpenChange(false);
  };

  const waitForLogin = async (loginId: string) => {
    const pollToken = loginPollTokenRef.current + 1;
    loginPollTokenRef.current = pollToken;
    setIsPollingLogin(true);
    setLoginHint("已生成登录链接，正在等待授权完成...");

    const deadline = Date.now() + 2 * 60 * 1000;
    while (pollToken === loginPollTokenRef.current && Date.now() < deadline) {
      try {
        const result = await accountClient.getLoginStatus(loginId);
        if (pollToken !== loginPollTokenRef.current) {
          return;
        }

        const status = String(result.status || "").trim().toLowerCase();
        if (status === "success") {
          await completeLoginSuccess("登录成功");
          return;
        }
        if (status === "failed") {
          const message = result.error || "登录失败，请重试";
          setIsPollingLogin(false);
          setLoginHint(`登录失败：${message}`);
          toast.error(message);
          return;
        }
      } catch {
        if (pollToken !== loginPollTokenRef.current) {
          return;
        }
      }

      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
    }

    if (pollToken === loginPollTokenRef.current) {
      setIsPollingLogin(false);
      setLoginHint("登录超时，请重试或使用下方手动解析回调。");
    }
  };

  const handleStartLogin = async () => {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const validationMessage = workspaceIdValidationMessage(normalizedWorkspaceId);
    if (validationMessage) {
      toast.error(validationMessage);
      setLoginHint(validationMessage);
      return;
    }
    setIsLoading(true);
    setLoginHint("");
    try {
      const result = await accountClient.startLogin({
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        note,
        group: group || null,
        workspaceId: normalizedWorkspaceId || null,
      });
      setLoginUrl(result.authUrl);
      if (result.warning) {
        toast.warning(result.warning);
      }
      toast.success("已生成登录链接，请在浏览器中完成授权");
      if (result.loginId) {
        void waitForLogin(result.loginId);
      } else {
        setLoginHint("未返回登录任务编号，请完成授权后使用手动解析。");
      }
    } catch (err: unknown) {
      toast.error(`启动登录失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualCallback = async () => {
    if (!manualCallback) {
      toast.error("请先粘贴回调链接");
      return;
    }
    setIsLoading(true);
    setLoginHint("正在解析回调...");
    try {
      const url = new URL(manualCallback);
      const state = url.searchParams.get("state") || "";
      const code = url.searchParams.get("code") || "";
      const redirectUri = `${url.origin}${url.pathname}`;
      
      await accountClient.completeLogin(state, code, redirectUri);
      await completeLoginSuccess("登录成功");
    } catch (err: unknown) {
      setLoginHint(`解析失败: ${err instanceof Error ? err.message : String(err)}`);
      toast.error(`解析失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkImport = async () => {
    if (!bulkContent.trim()) return;
    setIsLoading(true);
    try {
      const contents = buildBulkImportContents(bulkContent);
      const result = await accountClient.import(contents);
      const total = Number(result?.total || 0);
      const created = Number(result?.created || 0);
      const updated = Number(result?.updated || 0);
      const failed = Number(result?.failed || 0);
      toast.success(`导入完成：共${total}，新增${created}，更新${updated}，失败${failed}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["usage"] }),
        queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
      ]);
      resetModalState();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(`导入失败: ${getBulkImportErrorMessage(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const copyUrl = () => {
    if (!loginUrl) return;
    navigator.clipboard.writeText(loginUrl);
    toast.success("链接已复制");
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="glass-card max-h-[85vh] overflow-hidden border-none p-0 sm:max-w-[640px]">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="shrink-0 bg-muted/20 px-6 pt-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="flex items-center gap-2">
                <LogIn className="h-5 w-5 text-primary" />
                新增账号
              </DialogTitle>
              <DialogDescription>
                通过登录授权或批量导入文本内容来添加账号。
              </DialogDescription>
            </DialogHeader>
            <TabsList className="grid w-full grid-cols-2 h-10 mb-0">
              <TabsTrigger value="login" className="gap-2">
                <LogIn className="h-3.5 w-3.5" /> 登录授权
              </TabsTrigger>
              <TabsTrigger value="bulk" className="gap-2">
                <FileUp className="h-3.5 w-3.5" /> 批量导入
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="max-h-[calc(85vh-154px)] overflow-y-auto p-6">
            <TabsContent value="login" className="mt-0 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>标签 (逗号分隔)</Label>
                  <Input placeholder="例如：高频, 团队A" value={tags} onChange={e => setTags(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>分组</Label>
                  <Select value={group} onValueChange={(val) => val && setGroup(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择分组">
                        {(value) => {
                          const nextValue = String(value || "").trim();
                          if (!nextValue) return "选择分组";
                          return GROUP_LABELS[nextValue] || nextValue;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEAM">团队 (TEAM)</SelectItem>
                      <SelectItem value="PERSONAL">个人 (PERSONAL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>备注/描述</Label>
                <Input placeholder="例如：主号 / 测试号" value={note} onChange={e => setNote(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Business / 工作空间 ID</Label>
                {knownWorkspaceOptions.length ? (
                  <Select
                    value={workspaceId}
                    onValueChange={(value) => setWorkspaceId(value || "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择已知 Business，或继续手动输入">
                        {(value) => {
                          const normalized = normalizeWorkspaceId(String(value || ""));
                          if (!normalized) return "选择已知 Business，或继续手动输入";
                          const option = knownWorkspaceOptions.find((item) => item.workspaceId === normalized);
                          return option ? `${option.title} (${option.workspaceId})` : normalized;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {knownWorkspaceOptions.map((option) => (
                        <SelectItem key={option.workspaceId} value={option.workspaceId}>
                          {option.title} ({option.workspaceId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Input
                  placeholder="例如：org-xxxxxxxx；每个 business 登录一次，后续即可一键切换"
                  value={workspaceId}
                  onChange={e => setWorkspaceId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  本地 Codex 不会自动记住你历史登录过的所有 business。这里指定 workspace id 登录后，应用会把该 business 单独保存下来。
                </p>
                {isLikelyPlaceholderWorkspaceId(workspaceId) ? (
                  <p className="text-xs text-destructive">
                    当前输入看起来像占位值。请使用真实的 `org-...` business id，否则上游授权页可能一直验证失败。
                  </p>
                ) : null}
              </div>

              <div className="pt-2">
                <Button onClick={handleStartLogin} disabled={isLoading || isPollingLogin} className="w-full gap-2">
                  <ExternalLink className="h-4 w-4" /> 登录授权
                </Button>
                {loginUrl && (
                  <div className="mt-3 p-2 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                    <Input value={loginUrl} readOnly className="font-mono text-[10px] h-8 border-none bg-transparent" />
                    <Button variant="ghost" size="sm" onClick={copyUrl} className="h-8 w-8 p-0">
                      <Clipboard className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {loginHint ? (
                  <p className="mt-2 text-xs text-muted-foreground">{loginHint}</p>
                ) : null}
              </div>

              <div className="space-y-3 pt-4 border-t">
                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
                    <Hash className="h-3 w-3" /> 手动解析回调 (当本地 48760 端口占用时)
                  </Label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="粘贴浏览器跳转后的完整回调 URL (包含 state 和 code)" 
                      value={manualCallback}
                      onChange={e => setManualCallback(e.target.value)}
                      className="font-mono text-[10px] h-9" 
                    />
                    <Button 
                      variant="secondary" 
                      onClick={handleManualCallback} 
                      disabled={isLoading} 
                      className="h-9 px-4 shrink-0"
                    >
                      解析
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="bulk" className="mt-0 space-y-4">
              <div className="space-y-2">
                <Label>账号数据 (Token 可每行一个，JSON 可整段粘贴)</Label>
                <Textarea 
                  placeholder="粘贴账号数据。普通 Token 可每行一个；完整 JSON / JSON 数组请整段粘贴。"
                  className="min-h-[250px] resize-none overflow-auto whitespace-pre-wrap break-all [overflow-wrap:anywhere] font-mono text-[10px] leading-4"
                  value={bulkContent}
                  onChange={(e) => setBulkContent(e.target.value)}
                />
              </div>
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                <Info className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
                支持格式：ChatGPT 账号（Refresh Token）、 Claude Session 等。系统将自动识别格式并导入。
              </div>
              <Button onClick={handleBulkImport} disabled={isLoading} className="w-full">
                开始导入
              </Button>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
