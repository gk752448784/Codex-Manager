pub(crate) fn normalize_service_tier(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "auto" => None,
        "fast" => Some("fast"),
        "flex" => Some("flex"),
        _ => None,
    }
}

pub(crate) fn normalize_service_tier_owned(
    value: Option<String>,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "auto" => Ok(None),
        "fast" => Ok(Some("fast".to_string())),
        "flex" => Ok(Some("flex".to_string())),
        _ => Err(format!("unsupported service tier: {value}")),
    }
}
