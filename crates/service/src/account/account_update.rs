use codexmanager_core::storage::{now_ts, Event};

use crate::{account_status, storage_helpers::open_storage};

pub(crate) fn update_account(
    account_id: &str,
    sort: Option<i64>,
    status: Option<&str>,
) -> Result<(), String> {
    // 更新账号排序或状态并记录事件
    let normalized_account_id = account_id.trim();
    if normalized_account_id.is_empty() {
        return Err("missing accountId".to_string());
    }

    let normalized_status = status.map(normalize_account_status).transpose()?;
    if sort.is_none() && normalized_status.is_none() {
        return Err("missing account update fields".to_string());
    }

    let storage = open_storage().ok_or_else(|| "storage unavailable".to_string())?;
    if let Some(sort) = sort {
        storage
            .update_account_sort(normalized_account_id, sort)
            .map_err(|e| e.to_string())?;
        let _ = storage.insert_event(&Event {
            account_id: Some(normalized_account_id.to_string()),
            event_type: "account_sort_update".to_string(),
            message: format!("sort={sort}"),
            created_at: now_ts(),
        });
    }

    if let Some(status) = normalized_status {
        let reason = if status == "disabled" {
            "manual_disable"
        } else {
            "manual_enable"
        };
        account_status::set_account_status(&storage, normalized_account_id, status, reason);
    }

    Ok(())
}

fn normalize_account_status(status: &str) -> Result<&'static str, String> {
    let normalized = status.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "active" => Ok("active"),
        "disabled" | "inactive" => Ok("disabled"),
        _ => Err(format!("unsupported account status: {status}")),
    }
}
