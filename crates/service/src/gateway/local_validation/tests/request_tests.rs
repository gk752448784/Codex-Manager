use super::*;

fn sample_api_key(
    protocol_type: &str,
    model_slug: Option<&str>,
    reasoning: Option<&str>,
    service_tier: Option<&str>,
) -> ApiKey {
    ApiKey {
        id: "gk_test".to_string(),
        name: Some("test".to_string()),
        model_slug: model_slug.map(|value| value.to_string()),
        reasoning_effort: reasoning.map(|value| value.to_string()),
        service_tier: service_tier.map(|value| value.to_string()),
        client_type: "codex".to_string(),
        protocol_type: protocol_type.to_string(),
        auth_scheme: "authorization_bearer".to_string(),
        upstream_base_url: None,
        static_headers_json: None,
        key_hash: "hash".to_string(),
        status: "active".to_string(),
        created_at: 0,
        last_used_at: None,
    }
}

#[test]
fn anthropic_key_keeps_empty_overrides() {
    let api_key = sample_api_key(
        crate::apikey_profile::PROTOCOL_ANTHROPIC_NATIVE,
        None,
        None,
        None,
    );
    let (model, reasoning, service_tier) = resolve_effective_request_overrides(&api_key);
    assert_eq!(model, None);
    assert_eq!(reasoning, None);
    assert_eq!(service_tier, None);
}

#[test]
fn anthropic_key_applies_custom_model_and_reasoning() {
    let api_key = sample_api_key(
        crate::apikey_profile::PROTOCOL_ANTHROPIC_NATIVE,
        Some("gpt-5.3-codex"),
        Some("extra_high"),
        Some("fast"),
    );
    let (model, reasoning, service_tier) = resolve_effective_request_overrides(&api_key);
    assert_eq!(model.as_deref(), Some("gpt-5.3-codex"));
    assert_eq!(reasoning.as_deref(), Some("xhigh"));
    assert_eq!(service_tier.as_deref(), Some("fast"));
}

#[test]
fn openai_key_keeps_empty_overrides() {
    let api_key = sample_api_key("openai_compat", None, None, None);
    let (model, reasoning, service_tier) = resolve_effective_request_overrides(&api_key);
    assert_eq!(model, None);
    assert_eq!(reasoning, None);
    assert_eq!(service_tier, None);
}
