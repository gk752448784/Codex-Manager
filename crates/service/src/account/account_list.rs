use codexmanager_core::{
    rpc::types::{AccountListParams, AccountListResult, AccountSummary},
    storage::Account,
};
use std::collections::HashMap;

use crate::storage_helpers::open_storage;

const DEFAULT_ACCOUNT_PAGE_SIZE: i64 = 5;
const MAX_ACCOUNT_PAGE_SIZE: i64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AccountFilter {
    All,
    Active,
    Low,
}

pub(crate) fn read_accounts(
    params: AccountListParams,
    pagination_requested: bool,
) -> Result<AccountListResult, String> {
    // 中文注释：账号页需要后端分页，但仪表盘/日志等全局功能仍依赖全量账号列表；
    // 因此这里兼容“无分页参数时返回全量，有分页参数时返回当前页”两种模式。
    let params = params.normalized();
    let storage = open_storage().ok_or_else(|| "open storage failed".to_string())?;
    let query = normalize_optional_text(params.query);
    let group_filter = normalize_optional_text(params.group_filter);
    let filter = normalize_filter(params.filter);

    if filter == AccountFilter::All {
        if pagination_requested {
            let page_size = normalize_page_size(params.page_size);
            let total = storage
                .account_count_filtered(query.as_deref(), group_filter.as_deref())
                .map_err(|err| format!("count accounts failed: {err}"))?;
            let page = clamp_page(params.page, total, page_size);
            let offset = (page - 1) * page_size;
            let accounts = storage
                .list_accounts_paginated(
                    query.as_deref(),
                    group_filter.as_deref(),
                    offset,
                    page_size,
                )
                .map_err(|err| format!("list accounts failed: {err}"))?;
            let items = to_account_summaries(&storage, accounts)?;
            return Ok(AccountListResult {
                items,
                total,
                page,
                page_size,
            });
        }

        let accounts = storage
            .list_accounts_filtered(query.as_deref(), group_filter.as_deref())
            .map_err(|err| format!("list accounts failed: {err}"))?;
        let total = accounts.len() as i64;
        let items = to_account_summaries(&storage, accounts)?;
        return Ok(AccountListResult {
            items,
            total,
            page: 1,
            page_size: if total > 0 {
                total
            } else {
                DEFAULT_ACCOUNT_PAGE_SIZE
            },
        });
    }

    if pagination_requested {
        let total =
            filtered_account_count(&storage, filter, query.as_deref(), group_filter.as_deref())?;
        let page_size = normalize_page_size(params.page_size);
        let page = clamp_page(params.page, total, page_size);
        let offset = (page - 1) * page_size;
        let paged = filtered_accounts(
            &storage,
            filter,
            query.as_deref(),
            group_filter.as_deref(),
            Some((offset, page_size)),
        )?;
        let items = to_account_summaries(&storage, paged)?;
        return Ok(AccountListResult {
            items,
            total,
            page,
            page_size,
        });
    }

    let accounts = filtered_accounts(
        &storage,
        filter,
        query.as_deref(),
        group_filter.as_deref(),
        None,
    )?;
    let total = accounts.len() as i64;
    let items = to_account_summaries(&storage, accounts)?;

    Ok(AccountListResult {
        items,
        total,
        page: 1,
        page_size: if total > 0 {
            total
        } else {
            DEFAULT_ACCOUNT_PAGE_SIZE
        },
    })
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value.unwrap_or_default().trim().to_string();
    if trimmed.is_empty() || trimmed == "all" {
        return None;
    }
    Some(trimmed)
}

fn normalize_filter(value: Option<String>) -> AccountFilter {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "active" => AccountFilter::Active,
        "low" => AccountFilter::Low,
        _ => AccountFilter::All,
    }
}

fn normalize_page_size(value: i64) -> i64 {
    value.clamp(1, MAX_ACCOUNT_PAGE_SIZE)
}

fn clamp_page(page: i64, total: i64, page_size: i64) -> i64 {
    let normalized_page = page.max(1);
    let total_pages = if total <= 0 {
        1
    } else {
        ((total + page_size - 1) / page_size).max(1)
    };
    normalized_page.min(total_pages)
}

fn filtered_account_count(
    storage: &codexmanager_core::storage::Storage,
    filter: AccountFilter,
    query: Option<&str>,
    group_filter: Option<&str>,
) -> Result<i64, String> {
    match filter {
        AccountFilter::All => storage
            .account_count_filtered(query, group_filter)
            .map_err(|err| format!("count accounts failed: {err}")),
        AccountFilter::Active => storage
            .account_count_active_available(query, group_filter)
            .map_err(|err| format!("count active accounts failed: {err}")),
        AccountFilter::Low => storage
            .account_count_low_quota(query, group_filter)
            .map_err(|err| format!("count low quota accounts failed: {err}")),
    }
}

fn filtered_accounts(
    storage: &codexmanager_core::storage::Storage,
    filter: AccountFilter,
    query: Option<&str>,
    group_filter: Option<&str>,
    pagination: Option<(i64, i64)>,
) -> Result<Vec<Account>, String> {
    match filter {
        AccountFilter::All => match pagination {
            Some((offset, limit)) => storage
                .list_accounts_paginated(query, group_filter, offset, limit)
                .map_err(|err| format!("list accounts failed: {err}")),
            None => storage
                .list_accounts_filtered(query, group_filter)
                .map_err(|err| format!("list accounts failed: {err}")),
        },
        AccountFilter::Active => storage
            .list_accounts_active_available(query, group_filter, pagination)
            .map_err(|err| format!("list active accounts failed: {err}")),
        AccountFilter::Low => storage
            .list_accounts_low_quota(query, group_filter, pagination)
            .map_err(|err| format!("list low quota accounts failed: {err}")),
    }
}

fn to_account_summary_with_reason(acc: Account, status_reason: Option<String>) -> AccountSummary {
    AccountSummary {
        id: acc.id,
        label: acc.label,
        group_name: acc.group_name,
        sort: acc.sort,
        status: acc.status,
        status_reason,
    }
}

fn to_account_summaries(
    storage: &codexmanager_core::storage::Storage,
    accounts: Vec<Account>,
) -> Result<Vec<AccountSummary>, String> {
    let account_ids = accounts
        .iter()
        .map(|account| account.id.clone())
        .collect::<Vec<_>>();
    let status_reasons = storage
        .latest_account_status_reasons(&account_ids)
        .map_err(|err| format!("load account status reasons failed: {err}"))?;
    Ok(accounts
        .into_iter()
        .map(|account| map_account_summary(account, &status_reasons))
        .collect())
}

fn map_account_summary(
    account: Account,
    status_reasons: &HashMap<String, String>,
) -> AccountSummary {
    let status_reason = status_reasons.get(&account.id).cloned();
    to_account_summary_with_reason(account, status_reason)
}
