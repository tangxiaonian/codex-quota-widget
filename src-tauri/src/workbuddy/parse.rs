use super::{Package, Snapshot};
use serde_json::Value;
/// Read finite non-negative billing values while preserving absent numbers.
pub(super) fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|v| v.is_finite() && *v >= 0.)
}
/// Normalize the official resource summary without treating missing data as zero.
pub(super) fn snapshot(data: &Value, session: &Value) -> Result<Snapshot, String> {
    let rows = data["Packages"]
        .as_array()
        .ok_or("WorkBuddy 未返回积分汇总")?;
    let display = data["CreditGroups"].as_array().unwrap_or(rows);
    let packages: Vec<Package> = display
        .iter()
        .enumerate()
        .map(|(index, row)| Package {
            id: format!("group-{index}"),
            name: row["Name"]
                .as_str()
                .or_else(|| row["PackageName"].as_str())
                .unwrap_or("其他积分")
                .to_owned(),
            remaining: number(&row["CycleRemainCapacity"]),
            total: number(&row["CycleTotalCapacity"]),
            expires_at: None,
        })
        .collect();
    let sum = |values: Vec<Option<f64>>| -> Option<f64> {
        values
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .map(|a| a.into_iter().sum())
    };
    let remaining = sum(rows
        .iter()
        .map(|p| number(&p["CycleRemainCapacity"]))
        .collect());
    let used = sum(rows
        .iter()
        .map(|p| number(&p["CycleUsedCapacity"]))
        .collect());
    let total = sum(rows
        .iter()
        .map(|p| number(&p["CycleTotalCapacity"]))
        .collect());
    Ok(Snapshot {
        account_key: identity(session)?,
        name: session["name"].as_str().unwrap_or("WorkBuddy 账号").into(),
        plan: data["SubscriptionPackageName"].as_str().map(str::to_owned),
        remaining,
        total,
        used,
        package_error: None,
        packages,
        fetched_at: crate::model::now(),
    })
}

/// Use the same workspace-scoped identity for the response and stale-data checks.
pub(super) fn identity(session: &Value) -> Result<String, String> {
    Ok(crate::model::account_key(
        session["uid"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("WorkBuddy 未返回账号标识")?,
        session["enterprise"].as_str().unwrap_or(""),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn missing_balance_stays_unknown_and_groups_do_not_double_count() {
        let session = json!({"uid":"local-user","name":"Demo","enterprise":""});
        let mut data = json!({"Packages":[{"CycleRemainCapacity":"25.5","CycleTotalCapacity":"100","CycleUsedCapacity":"50","CycleFrozenCapacity":"24.5"}],"CreditGroups":[{"Name":"套餐积分","CycleRemainCapacity":"25.5","CycleTotalCapacity":"100"}]});
        let snapshot = snapshot(&data, &session).unwrap();
        assert_eq!(snapshot.remaining, Some(25.5));
        assert_eq!(snapshot.total, Some(100.0));
        assert_eq!(snapshot.used, Some(50.0));
        assert_eq!(snapshot.packages[0].name, "套餐积分");
        data["Packages"][0]["CycleRemainCapacity"] = Value::Null;
        assert_eq!(super::snapshot(&data, &session).unwrap().remaining, None);
        assert!(super::snapshot(&json!({}), &session).is_err());
    }
}
