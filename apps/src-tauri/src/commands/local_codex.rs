use std::fs;
use std::path::{Path, PathBuf};

use codexmanager_core::auth::{extract_chatgpt_account_id, extract_workspace_id};
use codexmanager_core::storage::Storage;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::app_storage::{apply_runtime_storage_env, resolve_db_path_with_legacy_migration};
use crate::commands::shared::rpc_call_in_background;

const LOCAL_CODEX_DIR_NAME: &str = ".codex";
const LOCAL_CODEX_AUTH_FILE: &str = "auth.json";
const LOCAL_CODEX_CONFIG_FILE: &str = "config.toml";
const LOCAL_CODEX_STATE_DB_FILE: &str = "state_5.sqlite";
const OPENAI_AUTH_CLAIMS_KEY: &str = "https://api.openai.com/auth";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalCodexProject {
    path: String,
    trust_level: String,
    is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalCodexWorkspaceAccount {
    account_id: String,
    label: String,
    group_name: Option<String>,
    status: String,
    workspace_id: Option<String>,
    chatgpt_account_id: Option<String>,
    is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalCodexStatus {
    codex_dir: String,
    auth_file_exists: bool,
    config_file_exists: bool,
    current_auth_mode: String,
    current_workspace_id: Option<String>,
    current_chatgpt_account_id: Option<String>,
    current_account_hint: Option<String>,
    matched_account_id: Option<String>,
    current_project_path: Option<String>,
    projects: Vec<LocalCodexProject>,
    workspace_accounts: Vec<LocalCodexWorkspaceAccount>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalCodexImportResult {
    auth_file_exists: bool,
    total: i64,
    created: i64,
    updated: i64,
    failed: i64,
}

#[derive(Debug, Clone)]
struct LocalCodexWorkspaceOption {
    workspace_id: String,
    title: Option<String>,
    is_default: bool,
}

fn local_codex_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE").filter(|value| !value.is_empty())?;
            let path = std::env::var_os("HOMEPATH").filter(|value| !value.is_empty())?;
            let mut combined = PathBuf::from(drive);
            combined.push(path);
            Some(combined.into_os_string())
        })
        .ok_or_else(|| "HOME/USERPROFILE is not set".to_string())?;
    Ok(PathBuf::from(home).join(LOCAL_CODEX_DIR_NAME))
}

fn auth_file_path() -> Result<PathBuf, String> {
    Ok(local_codex_dir()?.join(LOCAL_CODEX_AUTH_FILE))
}

fn config_file_path() -> Result<PathBuf, String> {
    Ok(local_codex_dir()?.join(LOCAL_CODEX_CONFIG_FILE))
}

fn state_db_path() -> Result<PathBuf, String> {
    Ok(local_codex_dir()?.join(LOCAL_CODEX_STATE_DB_FILE))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("read json failed ({}): {err}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|err| format!("parse json failed ({}): {err}", path.display()))
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let decoded =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, payload).ok()?;
    serde_json::from_slice::<Value>(&decoded).ok()
}

fn current_codex_tokens(source: &Map<String, Value>) -> Map<String, Value> {
    source
        .get("tokens")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn current_codex_account_hint(tokens: &Map<String, Value>) -> Option<String> {
    tokens
        .get("account_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn current_codex_workspace_options(
    source: &Map<String, Value>,
    current_workspace_id: Option<&str>,
) -> Vec<LocalCodexWorkspaceOption> {
    let tokens = current_codex_tokens(source);
    let id_token = tokens
        .get("id_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let mut options: Vec<LocalCodexWorkspaceOption> = Vec::new();

    for token in [id_token, access_token] {
        let Some(payload) = decode_jwt_payload(token) else {
            continue;
        };
        let Some(auth) = payload
            .get(OPENAI_AUTH_CLAIMS_KEY)
            .and_then(Value::as_object)
        else {
            continue;
        };
        let Some(orgs) = auth.get("organizations").and_then(Value::as_array) else {
            continue;
        };

        for item in orgs {
            let Some(workspace_id) = item.get("id").and_then(Value::as_str).map(str::trim) else {
                continue;
            };
            if workspace_id.is_empty() || options.iter().any(|org| org.workspace_id == workspace_id)
            {
                continue;
            }
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let is_default = item
                .get("is_default")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || current_workspace_id.is_some_and(|value| value == workspace_id);
            options.push(LocalCodexWorkspaceOption {
                workspace_id: workspace_id.to_string(),
                title,
                is_default,
            });
        }

        if !options.is_empty() {
            break;
        }
    }

    options
}

fn current_codex_auth_summary() -> Result<
    (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Map<String, Value>,
    ),
    String,
> {
    let path = auth_file_path()?;
    let value = read_json_file(&path)?;
    let source = value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("invalid auth file format: {}", path.display()))?;

    let auth_mode = source
        .get("auth_mode")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    let tokens = source
        .get("tokens")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let id_token = tokens
        .get("id_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let account_hint = tokens
        .get("account_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let workspace_id = account_hint
        .clone()
        .or_else(|| extract_workspace_id(id_token))
        .or_else(|| extract_workspace_id(access_token));
    let chatgpt_account_id =
        extract_chatgpt_account_id(id_token).or_else(|| extract_chatgpt_account_id(access_token));

    Ok((
        auth_mode,
        workspace_id,
        chatgpt_account_id,
        account_hint,
        source,
    ))
}

fn parse_projects_from_config(
    path: &Path,
    current_project_path: Option<&str>,
) -> Result<Vec<LocalCodexProject>, String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("read config failed ({}): {err}", path.display()))?;
    let mut projects = Vec::new();
    let mut current_path: Option<String> = None;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with("[projects.\"") && line.ends_with("\"]") {
            let prefix = "[projects.\"";
            let path_value = &line[prefix.len()..line.len() - 2];
            current_path = Some(path_value.to_string());
            projects.push(LocalCodexProject {
                path: path_value.to_string(),
                trust_level: String::new(),
                is_current: current_project_path.is_some_and(|value| value == path_value),
            });
            continue;
        }

        if let Some(path_value) = current_path.as_ref() {
            if let Some(project) = projects.iter_mut().find(|item| item.path == *path_value) {
                if let Some(rest) = line.strip_prefix("trust_level") {
                    if let Some(value) = rest.split('=').nth(1) {
                        project.trust_level = value.trim().trim_matches('"').to_string();
                    }
                }
            }
        }
    }

    Ok(projects)
}

fn read_current_project_path() -> Option<String> {
    let path = state_db_path().ok()?;
    if !path.is_file() {
        return None;
    }

    let conn = rusqlite::Connection::open(path).ok()?;
    conn.query_row(
        "SELECT cwd FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn open_app_storage(db_path: &Path) -> Result<Storage, String> {
    let storage = Storage::open(db_path).map_err(|err| format!("open storage failed: {err}"))?;
    storage
        .init()
        .map_err(|err| format!("init storage failed: {err}"))?;
    Ok(storage)
}

fn read_workspace_accounts(
    storage: &Storage,
    current_workspace_id: Option<&str>,
    current_chatgpt_account_id: Option<&str>,
) -> Result<(Option<String>, Vec<LocalCodexWorkspaceAccount>), String> {
    let accounts = storage
        .list_accounts()
        .map_err(|err| format!("list accounts failed: {err}"))?;
    let mut matched_account_id = None;
    let mut items = Vec::new();

    for account in accounts {
        if storage
            .find_token_by_account_id(&account.id)
            .map_err(|err| format!("find token failed: {err}"))?
            .is_none()
        {
            continue;
        }

        let workspace_id = account.workspace_id.clone();
        let chatgpt_account_id = account.chatgpt_account_id.clone();
        let workspace_matches = current_workspace_id
            .zip(workspace_id.as_deref())
            .is_some_and(|(lhs, rhs)| lhs == rhs);
        let chatgpt_matches = current_chatgpt_account_id
            .zip(chatgpt_account_id.as_deref())
            .is_some_and(|(lhs, rhs)| lhs == rhs);
        let is_current = if workspace_matches {
            current_chatgpt_account_id.is_none() || chatgpt_matches
        } else {
            current_workspace_id.is_none() && chatgpt_matches
        };
        if is_current && matched_account_id.is_none() {
            matched_account_id = Some(account.id.clone());
        }

        items.push(LocalCodexWorkspaceAccount {
            account_id: account.id,
            label: account.label,
            group_name: account.group_name,
            status: account.status,
            workspace_id,
            chatgpt_account_id,
            is_current,
        });
    }

    items.sort_by(|left, right| {
        right
            .is_current
            .cmp(&left.is_current)
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left.account_id.cmp(&right.account_id))
    });

    Ok((matched_account_id, items))
}

fn build_local_codex_import_items(source: &Map<String, Value>) -> Vec<Value> {
    let tokens = current_codex_tokens(source);
    let account_hint = current_codex_account_hint(&tokens);
    let id_token = tokens
        .get("id_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let chatgpt_account_id = extract_chatgpt_account_id(id_token)
        .or_else(|| extract_chatgpt_account_id(access_token))
        .or_else(|| account_hint.clone());
    let email = decode_jwt_payload(id_token).and_then(|payload| {
        payload
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let current_workspace_id = account_hint
        .clone()
        .or_else(|| extract_workspace_id(id_token))
        .or_else(|| extract_workspace_id(access_token));
    let workspace_options =
        current_codex_workspace_options(source, current_workspace_id.as_deref());

    if workspace_options.is_empty() {
        return vec![Value::Object(source.clone())];
    }

    let mut workspace_options = workspace_options;
    workspace_options.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.workspace_id.cmp(&right.workspace_id))
    });

    workspace_options
        .into_iter()
        .map(|workspace| {
            let mut item = source.clone();
            item.insert("tokens".to_string(), Value::Object(tokens.clone()));
            let label = match (email.as_deref(), workspace.title.as_deref()) {
                (Some(email), Some(title)) => format!("{email} ({title})"),
                (Some(email), None) => email.to_string(),
                (None, Some(title)) => title.to_string(),
                (None, None) => workspace.workspace_id.clone(),
            };
            let mut meta = Map::new();
            meta.insert("label".to_string(), Value::String(label));
            meta.insert(
                "workspace_id".to_string(),
                Value::String(workspace.workspace_id.clone()),
            );
            if let Some(chatgpt_account_id) = chatgpt_account_id.clone() {
                meta.insert(
                    "chatgpt_account_id".to_string(),
                    Value::String(chatgpt_account_id),
                );
            }
            if let Some(title) = workspace.title.clone() {
                meta.insert("group_name".to_string(), Value::String(title));
            }
            item.insert("meta".to_string(), Value::Object(meta));
            Value::Object(item)
        })
        .collect()
}

fn write_local_codex_auth(account_id: &str, db_path: &Path) -> Result<(), String> {
    let storage = open_app_storage(db_path)?;
    let accounts = storage
        .list_accounts()
        .map_err(|err| format!("list accounts failed: {err}"))?;
    let account = accounts
        .into_iter()
        .find(|item| item.id == account_id)
        .ok_or_else(|| format!("account not found: {account_id}"))?;
    let token = storage
        .find_token_by_account_id(account_id)
        .map_err(|err| format!("find token failed: {err}"))?
        .ok_or_else(|| format!("token not found for account: {account_id}"))?;

    let path = auth_file_path()?;
    let mut root = if path.is_file() {
        read_json_file(&path)?
            .as_object()
            .cloned()
            .unwrap_or_default()
    } else {
        Map::new()
    };

    root.insert(
        "auth_mode".to_string(),
        Value::String("chatgpt".to_string()),
    );
    if !root.contains_key("OPENAI_API_KEY") {
        root.insert("OPENAI_API_KEY".to_string(), Value::Null);
    }

    let mut tokens = Map::new();
    tokens.insert("id_token".to_string(), Value::String(token.id_token));
    tokens.insert(
        "access_token".to_string(),
        Value::String(token.access_token),
    );
    tokens.insert(
        "refresh_token".to_string(),
        Value::String(token.refresh_token),
    );
    tokens.insert(
        "account_id".to_string(),
        Value::String(
            account
                .workspace_id
                .or(account.chatgpt_account_id)
                .unwrap_or(account.id),
        ),
    );
    root.insert("tokens".to_string(), Value::Object(tokens));

    let json = serde_json::to_vec_pretty(&Value::Object(root))
        .map_err(|err| format!("encode auth json failed: {err}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("auth parent path missing: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("create auth dir failed ({}): {err}", parent.display()))?;

    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|err| format!("write auth temp failed ({}): {err}", temp_path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temp_path, &path)
        .map_err(|err| format!("replace auth file failed ({}): {err}", path.display()))?;

    storage
        .set_app_setting("auth.current_account_id", account_id, codexmanager_core::storage::now_ts())
        .map_err(|err| format!("set current auth account failed: {err}"))?;
    storage
        .set_app_setting("auth.current_auth_mode", "chatgpt", codexmanager_core::storage::now_ts())
        .map_err(|err| format!("set current auth mode failed: {err}"))?;
    Ok(())
}

fn load_local_codex_status(app: &tauri::AppHandle) -> Result<LocalCodexStatus, String> {
    apply_runtime_storage_env(app);

    let codex_dir = local_codex_dir()?;
    let auth_path = auth_file_path()?;
    let config_path = config_file_path()?;
    let auth_file_exists = auth_path.is_file();
    let config_file_exists = config_path.is_file();

    let (current_auth_mode, current_workspace_id, current_chatgpt_account_id, current_account_hint) =
        if auth_file_exists {
            let (auth_mode, workspace_id, chatgpt_account_id, account_hint, _) =
                current_codex_auth_summary()?;
            (auth_mode, workspace_id, chatgpt_account_id, account_hint)
        } else {
            (String::new(), None, None, None)
        };

    let current_project_path = read_current_project_path();
    let projects = if config_file_exists {
        parse_projects_from_config(&config_path, current_project_path.as_deref())?
    } else {
        Vec::new()
    };

    let db_path = resolve_db_path_with_legacy_migration(app)?;
    let storage = open_app_storage(&db_path)?;
    let (matched_account_id, workspace_accounts) = read_workspace_accounts(
        &storage,
        current_workspace_id.as_deref(),
        current_chatgpt_account_id.as_deref(),
    )?;

    Ok(LocalCodexStatus {
        codex_dir: codex_dir.display().to_string(),
        auth_file_exists,
        config_file_exists,
        current_auth_mode,
        current_workspace_id,
        current_chatgpt_account_id,
        current_account_hint,
        matched_account_id,
        current_project_path,
        projects,
        workspace_accounts,
    })
}

#[tauri::command]
pub async fn app_local_codex_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || load_local_codex_status(&app))
        .await
        .map_err(|err| format!("app_local_codex_status task failed: {err}"))?
        .and_then(|result| serde_json::to_value(result).map_err(|err| err.to_string()))
}

#[tauri::command]
pub async fn app_local_codex_import_current_auth(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    apply_runtime_storage_env(&app);
    let auth_path = auth_file_path()?;
    if !auth_path.is_file() {
        return serde_json::to_value(LocalCodexImportResult {
            auth_file_exists: false,
            total: 0,
            created: 0,
            updated: 0,
            failed: 0,
        })
        .map_err(|err| err.to_string());
    }

    let content = fs::read_to_string(&auth_path)
        .map_err(|err| format!("read auth file failed ({}): {err}", auth_path.display()))?;
    let parsed = serde_json::from_str::<Value>(&content)
        .map_err(|err| format!("parse auth file failed ({}): {err}", auth_path.display()))?;
    let source = parsed
        .as_object()
        .cloned()
        .ok_or_else(|| format!("invalid auth file format: {}", auth_path.display()))?;
    let import_items = build_local_codex_import_items(&source);
    let import_contents = import_items
        .into_iter()
        .map(|item| serde_json::to_string(&item).map_err(|err| err.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let result = rpc_call_in_background(
        "account/import",
        None,
        Some(serde_json::json!({ "contents": import_contents })),
    )
    .await?;
    let source = result
        .get("result")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    serde_json::to_value(LocalCodexImportResult {
        auth_file_exists: true,
        total: source.get("total").and_then(Value::as_i64).unwrap_or(0),
        created: source.get("created").and_then(Value::as_i64).unwrap_or(0),
        updated: source.get("updated").and_then(Value::as_i64).unwrap_or(0),
        failed: source.get("failed").and_then(Value::as_i64).unwrap_or(0),
    })
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn app_local_codex_switch_workspace(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let account_id = account_id.trim().to_string();
    if account_id.is_empty() {
        return Err("account_id is required".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        apply_runtime_storage_env(&app);
        let db_path = resolve_db_path_with_legacy_migration(&app)?;
        write_local_codex_auth(&account_id, &db_path)?;
        load_local_codex_status(&app)
    })
    .await
    .map_err(|err| format!("app_local_codex_switch_workspace task failed: {err}"))?
    .and_then(|result| serde_json::to_value(result).map_err(|err| err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        build_local_codex_import_items, current_codex_auth_summary, current_codex_workspace_options,
    };
    use base64::Engine;
    use serde_json::{json, Map, Value};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn jwt(payload: Value) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&payload).expect("payload json"));
        format!("{header}.{payload}.sig")
    }

    fn sample_auth_source() -> Map<String, Value> {
        let id_token = jwt(json!({
            "sub": "auth0|sample",
            "email": "user@example.com",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "cgpt-1",
                "organizations": [
                    { "id": "org-default", "title": "Default Biz", "is_default": true },
                    { "id": "org-second", "title": "Second Biz", "is_default": false }
                ]
            }
        }));
        let access_token = jwt(json!({
            "sub": "auth0|sample",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "cgpt-1"
            }
        }));
        serde_json::from_value(json!({
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": id_token,
                "access_token": access_token,
                "refresh_token": "rt_123",
                "account_id": "org-second"
            }
        }))
        .expect("auth source")
    }

    #[test]
    fn current_codex_auth_summary_prefers_account_hint_workspace() {
        let root = std::env::temp_dir().join(format!(
            "codexmanager-local-codex-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(root.join(".codex")).expect("create codex dir");
        fs::write(
            root.join(".codex/auth.json"),
            serde_json::to_vec_pretty(&Value::Object(sample_auth_source())).expect("encode auth"),
        )
        .expect("write auth");

        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &root);
        let (_, workspace_id, _, account_hint, _) = current_codex_auth_summary().expect("summary");
        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        assert_eq!(account_hint.as_deref(), Some("org-second"));
        assert_eq!(workspace_id.as_deref(), Some("org-second"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn build_local_codex_import_items_expands_workspace_organizations() {
        let source = sample_auth_source();
        let options = current_codex_workspace_options(&source, Some("org-second"));
        assert_eq!(options.len(), 2);

        let items = build_local_codex_import_items(&source);
        assert_eq!(items.len(), 2);

        let workspaces = items
            .iter()
            .filter_map(|item| item.get("meta"))
            .filter_map(|meta| meta.get("workspace_id"))
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        assert!(workspaces.contains(&"org-default"));
        assert!(workspaces.contains(&"org-second"));
    }
}
