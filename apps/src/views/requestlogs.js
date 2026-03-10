import { dom } from "../ui/dom.js";
import { state } from "../state.js";
import { copyText } from "../utils/clipboard.js";
import {
  createRequestLogRow,
  createTopSpacerRow,
  renderEmptyRequestLogs,
} from "./requestlogs/row-render.js";
import {
  buildRequestRouteMeta,
  collectFilteredRequestLogs,
  ensureAccountLabelMap,
  fallbackAccountDisplayFromKey,
  isAppendOnlyResult,
  resolveAccountDisplayName,
  resolveDisplayRequestPath,
} from "./requestlogs/selectors.js";
import {
  appendAtLeastOneBatch,
  appendNearBottomBatches,
  appendRequestLogBatch,
  isNearBottom,
} from "./requestlogs/virtual-list.js";
import { createRequestLogBindings } from "./requestlogs/events.js";

const REQUEST_LOG_BATCH_SIZE = 80;
const REQUEST_LOG_DOM_LIMIT = 240;
const REQUEST_LOG_DOM_RECYCLE_TO = 180;
const REQUEST_LOG_SCROLL_BUFFER = 180;
const REQUEST_LOG_FALLBACK_ROW_HEIGHT = 54;
const REQUEST_LOG_COLUMN_COUNT = 9;
const REQUEST_LOG_NEAR_BOTTOM_MAX_BATCHES = 1;

const requestLogWindowState = {
  filter: "all",
  filtered: [],
  filteredKeys: [],
  nextIndex: 0,
  topSpacerHeight: 0,
  recycledRowHeight: REQUEST_LOG_FALLBACK_ROW_HEIGHT,
  accountListRef: null,
  accountLabelById: new Map(),
  topSpacerRow: null,
  topSpacerCell: null,
  boundRowsEl: null,
  boundScrollerEl: null,
  scrollTickHandle: null,
  scrollTickMode: "",
  hasRendered: false,
};

function createRowRenderer() {
  const accountLabelById = requestLogWindowState.accountLabelById;
  const rowRenderHelpers = {
    resolveAccountDisplayName: (item) =>
      resolveAccountDisplayName(item, accountLabelById),
    fallbackAccountDisplayFromKey,
    resolveDisplayRequestPath,
    buildRequestRouteMeta,
  };
  return (item, index) => createRequestLogRow(item, index, rowRenderHelpers);
}

function appendRequestLogBatchLocal() {
  return appendRequestLogBatch({
    rowsEl: dom.requestLogRows,
    windowState: requestLogWindowState,
    batchSize: REQUEST_LOG_BATCH_SIZE,
    createRow: createRowRenderer(),
    domLimit: REQUEST_LOG_DOM_LIMIT,
    domRecycleTo: REQUEST_LOG_DOM_RECYCLE_TO,
    fallbackRowHeight: REQUEST_LOG_FALLBACK_ROW_HEIGHT,
  });
}

const requestLogBindings = createRequestLogBindings({
  dom,
  windowState: requestLogWindowState,
  copyText,
  resolveDisplayRequestPath,
  isNearBottom,
  appendNearBottomBatches,
  scrollBuffer: REQUEST_LOG_SCROLL_BUFFER,
  nearBottomMaxBatches: REQUEST_LOG_NEAR_BOTTOM_MAX_BATCHES,
  appendRequestLogBatch: appendRequestLogBatchLocal,
});

export function renderRequestLogs() {
  if (!dom.requestLogRows) {
    return;
  }
  requestLogBindings.ensureRequestLogBindings();
  ensureAccountLabelMap(state.accountList, requestLogWindowState);
  const filter = state.requestLogStatusFilter || "all";
  const { filtered, filteredKeys } = collectFilteredRequestLogs(
    state.requestLogList,
    filter,
  );
  const sameFilter = filter === requestLogWindowState.filter;
  const appendOnly = sameFilter && isAppendOnlyResult(
    requestLogWindowState.filteredKeys,
    filteredKeys,
  );
  const unchanged = appendOnly && filteredKeys.length === requestLogWindowState.filteredKeys.length;
  const canReuseRenderedDom = filtered.length > 0
    ? Boolean(
      requestLogWindowState.topSpacerRow &&
      dom.requestLogRows.contains(requestLogWindowState.topSpacerRow),
    )
    : dom.requestLogRows.children.length > 0;

  if (requestLogWindowState.hasRendered && canReuseRenderedDom && unchanged) {
    requestLogWindowState.filtered = filtered;
    requestLogWindowState.filteredKeys = filteredKeys;
    return;
  }

  if (
    requestLogWindowState.hasRendered &&
    appendOnly &&
    requestLogWindowState.topSpacerRow &&
    dom.requestLogRows.contains(requestLogWindowState.topSpacerRow)
  ) {
    const previousLength = requestLogWindowState.filtered.length;
    requestLogWindowState.filtered = filtered;
    requestLogWindowState.filteredKeys = filteredKeys;
    requestLogWindowState.filter = filter;
    if (
      requestLogWindowState.nextIndex >= previousLength ||
      isNearBottom(requestLogWindowState.boundScrollerEl, REQUEST_LOG_SCROLL_BUFFER)
    ) {
      appendAtLeastOneBatch({
        scroller: requestLogWindowState.boundScrollerEl,
        scrollBuffer: REQUEST_LOG_SCROLL_BUFFER,
        nearBottomMaxBatches: REQUEST_LOG_NEAR_BOTTOM_MAX_BATCHES,
        appendRequestLogBatch: appendRequestLogBatchLocal,
      });
    }
    return;
  }

  dom.requestLogRows.innerHTML = "";
  requestLogWindowState.filtered = filtered;
  requestLogWindowState.filteredKeys = filteredKeys;
  requestLogWindowState.filter = filter;
  requestLogWindowState.nextIndex = 0;
  requestLogWindowState.topSpacerHeight = 0;
  requestLogWindowState.recycledRowHeight = REQUEST_LOG_FALLBACK_ROW_HEIGHT;
  requestLogWindowState.topSpacerRow = null;
  requestLogWindowState.topSpacerCell = null;
  requestLogWindowState.hasRendered = true;
  if (!filtered.length) {
    renderEmptyRequestLogs(dom.requestLogRows, REQUEST_LOG_COLUMN_COUNT);
    return;
  }
  dom.requestLogRows.appendChild(
    createTopSpacerRow({
      columnCount: REQUEST_LOG_COLUMN_COUNT,
      windowState: requestLogWindowState,
    }),
  );
  appendAtLeastOneBatch({
    scroller: requestLogWindowState.boundScrollerEl,
    extraMaxBatches: 1,
    scrollBuffer: REQUEST_LOG_SCROLL_BUFFER,
    nearBottomMaxBatches: REQUEST_LOG_NEAR_BOTTOM_MAX_BATCHES,
    appendRequestLogBatch: appendRequestLogBatchLocal,
  });
}
