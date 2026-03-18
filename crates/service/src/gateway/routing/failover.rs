use codexmanager_core::storage::Storage;

use crate::account_availability::{evaluate_snapshot, Availability};

#[allow(dead_code)]
pub(crate) fn should_failover_after_refresh(
    storage: &Storage,
    account_id: &str,
    refresh_result: Result<(), String>,
) -> bool {
    match refresh_result {
        Ok(_) => should_failover_by_snapshot(storage, account_id, true),
        Err(err) => {
            if err.starts_with("usage endpoint status") {
                true
            } else {
                false
            }
        }
    }
}

pub(crate) fn should_failover_from_cached_snapshot(storage: &Storage, account_id: &str) -> bool {
    should_failover_by_snapshot(storage, account_id, false)
}

fn should_failover_by_snapshot(storage: &Storage, account_id: &str, fail_on_missing: bool) -> bool {
    let snap = storage
        .latest_usage_snapshot_for_account(account_id)
        .ok()
        .flatten();
    match snap.as_ref().map(evaluate_snapshot) {
        Some(Availability::Unavailable(_reason)) => true,
        Some(Availability::Available) => false,
        None if fail_on_missing => true,
        None => false,
    }
}
