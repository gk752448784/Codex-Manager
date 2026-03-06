import * as api from "../../api.js";
import { calcAvailability } from "../../utils/format.js";

const EMPTY_REFRESH_PROGRESS = Object.freeze({
  active: false,
  manual: false,
  completed: 0,
  total: 0,
  remaining: 0,
  lastTaskLabel: "",
});

let refreshAllProgress = { ...EMPTY_REFRESH_PROGRESS };

function pickImportTokenField(record, keys) {
  const source = record && typeof record === "object" ? record : null;
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeSingleImportRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }
  const tokens = record.tokens;
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
  const normalizedTokens = {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
  };
  if (accountIdHint) {
    normalizedTokens.account_id = accountIdHint;
  }

  return {
    ...record,
    tokens: normalizedTokens,
  };
}

function normalizeImportContentForCompatibility(rawContent) {
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

function nextPaintTick() {
  return new Promise((resolve) => {
    const raf = typeof globalThis !== "undefined" ? globalThis.requestAnimationFrame : null;
    if (typeof raf === "function") {
      raf(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function normalizeProgress(next) {
  const total = Math.max(0, Number(next?.total || 0));
  const completed = Math.min(total, Math.max(0, Number(next?.completed || 0)));
  return {
    active: Boolean(next?.active) && total > 0,
    manual: Boolean(next?.manual),
    total,
    completed,
    remaining: Math.max(0, total - completed),
    lastTaskLabel: String(next?.lastTaskLabel || "").trim(),
  };
}

export function setRefreshAllProgress(progress) {
  refreshAllProgress = normalizeProgress(progress);
  return { ...refreshAllProgress };
}

export function clearRefreshAllProgress() {
  refreshAllProgress = { ...EMPTY_REFRESH_PROGRESS };
  return { ...refreshAllProgress };
}

export function getRefreshAllProgress() {
  return { ...refreshAllProgress };
}

export function createAccountActions({
  state,
  ensureConnected,
  refreshAccountsAndUsage,
  renderAccountsView,
  renderCurrentPageView,
  showToast,
  showConfirmDialog,
}) {
  let accountOpsQueue = Promise.resolve();
  let refreshSectionInFlight = null;

  function enqueueAccountOp(task) {
    const run = accountOpsQueue.then(task, task);
    accountOpsQueue = run.catch(() => {});
    return run;
  }

  const refreshAccountsSection = async () => {
    if (refreshSectionInFlight) {
      return refreshSectionInFlight;
    }
    refreshSectionInFlight = (async () => {
      const ok = await refreshAccountsAndUsage();
      if (!ok) {
        showToast("账号数据刷新失败，请稍后重试", "error");
        return false;
      }
      renderAccountsView();
      return true;
    })();
    try {
      return await refreshSectionInFlight;
    } finally {
      refreshSectionInFlight = null;
    }
  };

  async function updateAccountSort(accountId, sort, previousSort) {
    if (Number.isFinite(previousSort) && previousSort === sort) {
      return;
    }
    const ok = await ensureConnected();
    if (!ok) return;
    const res = await api.serviceAccountUpdate(accountId, sort);
    if (res && res.ok === false) {
      showToast(res.error || "排序更新失败", "error");
      return;
    }
    const refreshed = await refreshAccountsAndUsage({ includeUsage: false });
    if (!refreshed) {
      showToast("账号排序已更新，但列表刷新失败，请稍后重试", "error");
      return;
    }
    renderAccountsView();
  }

  async function deleteAccount(account) {
    if (!account || !account.id) return;
    const confirmed = await showConfirmDialog({
      title: "删除账号",
      message: `确定删除账号 ${account.label} 吗？删除后不可恢复。`,
      confirmText: "删除",
      cancelText: "取消",
    });
    if (!confirmed) return;
    await enqueueAccountOp(async () => {
      const ok = await ensureConnected();
      if (!ok) return;
      const res = await api.serviceAccountDelete(account.id);
      if (res && res.error === "unknown_method") {
        const fallback = await api.localAccountDelete(account.id);
        if (fallback && fallback.ok) {
          await refreshAccountsSection();
          return;
        }
        const msg = fallback && fallback.error ? fallback.error : "删除失败";
        showToast(msg, "error");
        return;
      }
      if (res && res.ok) {
        await refreshAccountsSection();
        showToast("账号已删除");
      } else {
        const msg = res && res.error ? res.error : "删除失败";
        showToast(msg, "error");
      }
    });
  }

  async function setManualPreferredAccount(account) {
    if (!account || !account.id) return;
    const ok = await ensureConnected();
    if (!ok) return;
    await enqueueAccountOp(async () => {
      const usageList = Array.isArray(state?.usageList) ? state.usageList : [];
      const usage = usageList.find((item) => item && item.accountId === account.id) || null;
      const status = calcAvailability(usage);
      if (status.level === "warn" || status.level === "bad") {
        showToast(`账号当前不可用（${status.text}），无法锁定`, "error");
        return;
      }
      const res = await api.serviceGatewayManualAccountSet(account.id);
      if (res && res.ok === false) {
        showToast(res.error || "锁定当前账号失败", "error");
        return;
      }
      if (state && typeof state === "object") {
        state.manualPreferredAccountId = account.id;
      }
      showToast(`已锁定 ${account.label || account.id}，异常前将持续优先使用`);
      renderAccountsView?.();
      renderCurrentPageView?.();
    });
  }

  async function deleteUnavailableFreeAccounts() {
    const confirmed = await showConfirmDialog({
      title: "一键移除不可用免费账号",
      message: "将删除当前不可用且识别为免费计划的账号，此操作不可恢复。是否继续？",
      confirmText: "立即移除",
      cancelText: "取消",
    });
    if (!confirmed) return;

    await enqueueAccountOp(async () => {
      const ok = await ensureConnected();
      if (!ok) return;
      const result = await api.serviceAccountDeleteUnavailableFree();
      const scanned = Number(result?.scanned || 0);
      const deleted = Number(result?.deleted || 0);
      const skippedAvailable = Number(result?.skippedAvailable || 0);
      const skippedNonFree = Number(result?.skippedNonFree || 0);
      const skippedMissingUsage = Number(result?.skippedMissingUsage || 0);
      const skippedMissingToken = Number(result?.skippedMissingToken || 0);

      await refreshAccountsSection();

      if (deleted > 0) {
        showToast(
          `已移除 ${deleted} 个不可用免费账号（扫描${scanned}，可用跳过${skippedAvailable}，非免费跳过${skippedNonFree}）`,
        );
        return;
      }
      showToast(
        `未移除账号（扫描${scanned}，可用${skippedAvailable}，非免费${skippedNonFree}，缺用量${skippedMissingUsage}，缺令牌${skippedMissingToken}）`,
      );
    });
  }

  async function exportAccountsByFile() {
    await enqueueAccountOp(async () => {
      const ok = await ensureConnected();
      if (!ok) return;
      const result = await api.serviceAccountExportByAccountFiles();
      if (result?.canceled) {
        showToast("已取消导出");
        return;
      }
      const exported = Number(result?.exported || 0);
      const skippedMissingToken = Number(result?.skippedMissingToken || 0);
      const outputDir = String(result?.outputDir || "").trim();
      const outputHint = outputDir ? `，目录：${outputDir}` : "";
      showToast(`导出完成：${exported} 个账号${skippedMissingToken > 0 ? `，跳过${skippedMissingToken}个` : ""}${outputHint}`);
    });
  }

  async function submitImportedContents(contents, sourceLabel = "") {
    const normalizedContents = Array.from(contents || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .map((item) => normalizeImportContentForCompatibility(item));
    if (!normalizedContents.length) {
      showToast("未读取到可导入内容", "error");
      return;
    }

    await enqueueAccountOp(async () => {
      await nextPaintTick();
      let res = null;
      try {
        res = await api.serviceAccountImport(normalizedContents);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
        return;
      }
      if (res && res.error) {
        showToast(res.error || "导入失败", "error");
        return;
      }
      const total = Number(res?.total || 0);
      const created = Number(res?.created || 0);
      const updated = Number(res?.updated || 0);
      const failed = Number(res?.failed || 0);

      await refreshAccountsSection();
      const sourceSuffix = sourceLabel ? `（${sourceLabel}）` : "";
      showToast(`导入完成${sourceSuffix}：共${total}，新增${created}，更新${updated}，失败${failed}`);
      await nextPaintTick();
      if (failed > 0 && Array.isArray(res?.errors) && res.errors.length > 0) {
        const first = res.errors[0];
        const index = Number(first?.index || 0);
        const message = String(first?.message || "未知错误");
        showToast(`首个失败项 #${index}: ${message}`, "error");
      }
    });
  }

  async function importAccountsFromFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const ok = await ensureConnected();
    if (!ok) return;

    // 中文注释：多文件/大文件读取时，避免 Promise.all 同时触发所有 file.text() 导致 UI 抖动或卡顿。
    // 这里改为顺序读取，并在关键阶段让出一次绘制机会。
    const totalBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file?.size || 0)), 0);
    const shouldShowProgressToast = files.length > 1 || totalBytes >= 2 * 1024 * 1024;
    if (shouldShowProgressToast) {
      showToast(`正在读取并导入账号（${files.length} 个文件）...`);
    }
    await nextPaintTick();

    const contents = [];
    const yieldEvery = files.length > 6 || totalBytes >= 8 * 1024 * 1024 ? 1 : 2;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      let text = "";
      try {
        if (file && typeof file.text === "function") {
          text = await file.text();
        }
      } catch {
        text = "";
      }
      const trimmed = String(text || "").trim();
      if (trimmed) {
        contents.push(trimmed);
      }
      if ((index + 1) % yieldEvery === 0) {
        await nextPaintTick();
      }
    }

    await nextPaintTick();
    await submitImportedContents(contents, `${files.length} 个文件`);
  }

  async function importAccountsFromDirectory() {
    const ok = await ensureConnected();
    if (!ok) return;

    let result = null;
    try {
      result = await api.serviceAccountImportByDirectory();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      return;
    }
    if (result?.canceled) {
      showToast("已取消导入");
      return;
    }
    const contents = Array.isArray(result?.contents) ? result.contents : [];
    const fileCount = Number(result?.fileCount || contents.length || 0);
    const directoryPath = String(result?.directoryPath || "").trim();
    if (!contents.length) {
      const pathHint = directoryPath ? `：${directoryPath}` : "";
      showToast(`所选文件夹下未找到可导入的 JSON 文件${pathHint}`, "error");
      return;
    }

    showToast(`正在导入文件夹（${fileCount} 个 JSON 文件）...`);
    await nextPaintTick();
    await submitImportedContents(contents, `${fileCount} 个 JSON 文件`);
  }

  return {
    updateAccountSort,
    deleteAccount,
    importAccountsFromFiles,
    importAccountsFromDirectory,
    setManualPreferredAccount,
    deleteUnavailableFreeAccounts,
    exportAccountsByFile,
  };
}

