use crate::commands::shared::rpc_call_in_background;

fn account_list_payload(
    page: Option<i64>,
    page_size: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    group_filter: Option<String>,
) -> Option<serde_json::Value> {
    let mut params = serde_json::Map::new();
    if let Some(value) = page {
        params.insert("page".to_string(), serde_json::json!(value));
    }
    if let Some(value) = page_size {
        params.insert("pageSize".to_string(), serde_json::json!(value));
    }
    if let Some(value) = query {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            params.insert("query".to_string(), serde_json::json!(trimmed));
        }
    }
    if let Some(value) = filter {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            params.insert("filter".to_string(), serde_json::json!(trimmed));
        }
    }
    if let Some(value) = group_filter {
        let trimmed = value.trim();
        if !trimmed.is_empty() && trimmed != "all" {
            params.insert("groupFilter".to_string(), serde_json::json!(trimmed));
        }
    }
    if params.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(params))
    }
}

fn account_update_payload(
    account_id: String,
    sort: Option<i64>,
    status: Option<String>,
) -> Option<serde_json::Value> {
    let mut params = serde_json::Map::new();
    params.insert("accountId".to_string(), serde_json::json!(account_id));
    if let Some(value) = sort {
        params.insert("sort".to_string(), serde_json::json!(value));
    }
    if let Some(value) = status {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            params.insert("status".to_string(), serde_json::json!(trimmed));
        }
    }
    if params.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(params))
    }
}

#[tauri::command]
pub async fn service_account_list(
    addr: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    group_filter: Option<String>,
) -> Result<serde_json::Value, String> {
    rpc_call_in_background(
        "account/list",
        addr,
        account_list_payload(page, page_size, query, filter, group_filter),
    )
    .await
}

#[tauri::command]
pub async fn service_account_delete(
    addr: Option<String>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let params = serde_json::json!({ "accountId": account_id });
    rpc_call_in_background("account/delete", addr, Some(params)).await
}

#[tauri::command]
pub async fn service_account_delete_many(
    addr: Option<String>,
    account_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let params = serde_json::json!({ "accountIds": account_ids });
    rpc_call_in_background("account/deleteMany", addr, Some(params)).await
}

#[tauri::command]
pub async fn service_account_delete_unavailable_free(
    addr: Option<String>,
) -> Result<serde_json::Value, String> {
    rpc_call_in_background("account/deleteUnavailableFree", addr, None).await
}

#[tauri::command]
pub async fn service_account_update(
    addr: Option<String>,
    account_id: String,
    sort: Option<i64>,
    status: Option<String>,
) -> Result<serde_json::Value, String> {
    rpc_call_in_background(
        "account/update",
        addr,
        account_update_payload(account_id, sort, status),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::account_update_payload;

    #[test]
    fn account_update_payload_supports_status_only_updates() {
        let actual = account_update_payload("acc-1".to_string(), None, Some("active".to_string()))
            .expect("payload");
        let expected = serde_json::json!({
            "accountId": "acc-1",
            "status": "active"
        });
        assert_eq!(actual, expected);
    }

    #[test]
    fn account_update_payload_supports_sort_only_updates() {
        let actual = account_update_payload("acc-1".to_string(), Some(5), None).expect("payload");
        let expected = serde_json::json!({
            "accountId": "acc-1",
            "sort": 5
        });
        assert_eq!(actual, expected);
    }

    #[test]
    fn account_update_payload_omits_blank_status() {
        let actual = account_update_payload("acc-1".to_string(), None, Some("   ".to_string()))
            .expect("payload");
        let expected = serde_json::json!({
            "accountId": "acc-1"
        });
        assert_eq!(actual, expected);
    }
}
