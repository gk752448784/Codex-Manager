use std::collections::HashSet;

use codexmanager_core::rpc::types::ApiKeyModelListResult;
use codexmanager_core::rpc::types::ModelOption;
use codexmanager_core::storage::now_ts;

use crate::gateway;
use crate::storage_helpers;

const MODEL_CACHE_SCOPE_DEFAULT: &str = "default";

pub(crate) fn read_model_options(refresh_remote: bool) -> Result<ApiKeyModelListResult, String> {
    let cached = read_cached_model_options()?;
    if !refresh_remote {
        return Ok(ApiKeyModelListResult { items: cached });
    }

    match gateway::fetch_models_for_picker() {
        Ok(items) => {
            let (merged_items, changed) = merge_model_options(&cached, &items);
            if changed {
                let _ = save_model_options_cache(&merged_items);
            }
            Ok(ApiKeyModelListResult {
                items: merged_items,
            })
        }
        Err(err) => {
            if !cached.is_empty() {
                return Ok(ApiKeyModelListResult { items: cached });
            }
            Err(err)
        }
    }
}

fn save_model_options_cache(items: &[ModelOption]) -> Result<(), String> {
    let storage =
        storage_helpers::open_storage().ok_or_else(|| "storage unavailable".to_string())?;
    let items_json = serde_json::to_string(items).map_err(|e| e.to_string())?;
    storage
        .upsert_model_options_cache(MODEL_CACHE_SCOPE_DEFAULT, &items_json, now_ts())
        .map_err(|e| e.to_string())
}

fn read_cached_model_options() -> Result<Vec<ModelOption>, String> {
    let storage =
        storage_helpers::open_storage().ok_or_else(|| "storage unavailable".to_string())?;
    let Some(cache) = storage
        .get_model_options_cache(MODEL_CACHE_SCOPE_DEFAULT)
        .map_err(|e| e.to_string())?
    else {
        return Ok(Vec::new());
    };
    let items = serde_json::from_str::<Vec<ModelOption>>(&cache.items_json).unwrap_or_default();
    Ok(items)
}

fn merge_model_options(
    cached: &[ModelOption],
    fetched: &[ModelOption],
) -> (Vec<ModelOption>, bool) {
    let mut merged = cached
        .iter()
        .map(|item| ModelOption {
            slug: item.slug.clone(),
            display_name: item.display_name.clone(),
        })
        .collect::<Vec<_>>();
    let mut seen = cached
        .iter()
        .map(|item| item.slug.trim())
        .filter(|slug| !slug.is_empty())
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let mut changed = false;

    for item in fetched {
        let slug = item.slug.trim();
        if slug.is_empty() || !seen.insert(slug.to_string()) {
            continue;
        }

        let display_name = item.display_name.trim();
        merged.push(ModelOption {
            slug: slug.to_string(),
            display_name: if display_name.is_empty() {
                slug.to_string()
            } else {
                display_name.to_string()
            },
        });
        changed = true;
    }

    (merged, changed)
}

#[cfg(test)]
mod tests {
    use codexmanager_core::rpc::types::ModelOption;

    use super::merge_model_options;

    fn as_pairs(items: &[ModelOption]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|item| (item.slug.clone(), item.display_name.clone()))
            .collect()
    }

    #[test]
    fn merge_model_options_appends_only_new_models() {
        let cached = vec![
            ModelOption {
                slug: "gpt-4.1".to_string(),
                display_name: "GPT-4.1".to_string(),
            },
            ModelOption {
                slug: "gpt-5".to_string(),
                display_name: "GPT-5".to_string(),
            },
        ];
        let fetched = vec![
            ModelOption {
                slug: "gpt-5".to_string(),
                display_name: "GPT-5 Latest".to_string(),
            },
            ModelOption {
                slug: "o3".to_string(),
                display_name: "o3".to_string(),
            },
        ];

        let (merged, changed) = merge_model_options(&cached, &fetched);

        assert!(changed);
        assert_eq!(
            as_pairs(&merged),
            vec![
                ("gpt-4.1".to_string(), "GPT-4.1".to_string()),
                ("gpt-5".to_string(), "GPT-5".to_string()),
                ("o3".to_string(), "o3".to_string()),
            ]
        );
    }

    #[test]
    fn merge_model_options_keeps_cache_when_remote_has_no_new_items() {
        let cached = vec![ModelOption {
            slug: "gpt-5".to_string(),
            display_name: "GPT-5".to_string(),
        }];
        let fetched = vec![
            ModelOption {
                slug: "gpt-5".to_string(),
                display_name: "GPT-5 Latest".to_string(),
            },
            ModelOption {
                slug: " ".to_string(),
                display_name: "".to_string(),
            },
        ];

        let (merged, changed) = merge_model_options(&cached, &fetched);

        assert!(!changed);
        assert_eq!(
            as_pairs(&merged),
            vec![("gpt-5".to_string(), "GPT-5".to_string())]
        );
    }
}
